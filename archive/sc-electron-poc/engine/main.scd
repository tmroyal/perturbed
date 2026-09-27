// main.scd — transport, tracks (a VSTi per track) and generators that play into tracks.
// Entry point: sclang engine/main.scd
//
// The app is authoritative: on /engine/ready it resends its whole state.
//
// Signal flow per track, inside the track's Group:
//   [instrument synth] -> track bus -> (effects go here, later) -> [trackOut synth] -> hardware out
//
// OSC in (sclang port 57120):
//   /engine/hello                   reply with /engine/ready once the plugin scan is done
//   /engine/reset                   remove all tracks and generators, stop transport
//   /transport/play   1|0           play restarts beat 0, the shared grid origin
//   /transport/tempo  <bpm>
//   /track/add     <id> <pluginKey>
//   /track/plugin  <id> <pluginKey> swap the track's instrument
//   /track/volume  <id> <amp>
//   /track/editor  <id>             open the instrument's GUI
//   /track/remove  <id>
//   /gen/add     <id> <type>        type = a file in engine/types/
//   /gen/remove  <id>
//   /gen/set     <id> <param> <value>   `active` 1|0, `track` <trackId> (0 = none), or a type param
// OSC out (app on 127.0.0.1:57130); note/beat messages are delayed by s.latency to match the audio:
//   /engine/ready
//   /plugins/instruments  (<key> <name>)...
//   /track/ready   <id> <ok>        instrument finished loading
//   /gen/note      <id>
//   /transport/beat <beat>

(
var root = thisProcess.nowExecutingPath.dirname;

~ui = NetAddr("127.0.0.1", 57130);
~types = ();
(root +/+ "types/*.scd").pathMatch.do { |path| ~types[path.basename.splitext[0].asSymbol] = path.load };

~tracks = ();
~gens = ();
~instruments = [];  // [key, name] pairs, filled by the plugin scan
~bpm = 120;
~playing = false;
~clock = nil;
~ready = false;

~toUI = { |...msg| SystemClock.sched(s.latency, { ~ui.sendMsg(*msg); nil }) };

// --- plugins ---

// One entry per instrument, preferring the VST3 version when both are installed.
~scanPlugins = { |done|
	VSTPlugin.search(s, verbose: false, action: {
		var byName = ();
		VSTPlugin.pluginList(s, true).select(_.synth).do { |d|
			var name = d.name.asSymbol;
			if(byName[name].isNil or: { d.path.endsWith(".vst3") }) { byName[name] = d.key };
		};
		~instruments = byName.keys.asArray.sort.collect { |name| [byName[name], name] };
		done.value;
	});
};

~sendInstruments = { ~ui.sendMsg('/plugins/instruments', *~instruments.flatten) };

// --- tracks ---

~addTrack = { |id, key|
	var tr = (id: id, group: Group(), bus: Bus.audio(s, 2));
	tr[\out] = Synth(\trackOut, [in: tr[\bus]], tr[\group], \addToTail);
	~tracks[id] = tr;
	~loadInstrument.(tr, key);
};

~loadInstrument = { |tr, key|
	var inst;
	~unhookTrack.(tr);
	tr[\inst] !? { |syn| s.bind { syn.free } };
	inst = Synth(\vsti, [out: tr[\bus]], tr[\group], \addToHead);
	tr[\inst] = inst;
	VSTPluginController(inst).open(key, editor: true, action: { |c, ok|
		if(tr[\inst] === inst and: { tr[\removed].isNil }) {
			if(ok) { tr[\ctl] = c } { "track %: failed to load %".format(tr[\id], key).warn };
			~ui.sendMsg('/track/ready', tr[\id], ok.binaryValue);
		};
	});
};

// Forget notes sounding on a track's instrument before it goes away.
~unhookTrack = { |tr|
	tr[\ctl] !? { |c| ~gens.do { |g| if(g[\sounding] !? (_[0]) === c) { g[\sounding] = nil } } };
	tr[\ctl] = nil;
};

~removeTrack = { |id|
	~tracks.removeAt(id) !? { |tr|
		~unhookTrack.(tr);
		tr[\removed] = true;
		// timestamped, so notes already queued s.latency ahead reach the synths before they go
		s.bind { tr[\group].free };
		SystemClock.sched(s.latency * 2, { tr[\bus].free; nil });
	};
};

// --- notes (bundled, so the server plays them at the clock's logical time + s.latency) ---

// Releases the generator's previous note and plays a new one at the same instant.
~strike = { |g, note, vel|
	var ctl = ~tracks[g[\track]] !? (_[\ctl]);
	s.bind {
		g[\sounding] !? { |sn| sn[0].midi.noteOff(0, sn[1], 0) };
		ctl !? { ctl.midi.noteOn(0, note, vel) };
	};
	g[\sounding] = ctl !? { [ctl, note] };
	~toUI.('/gen/note', g[\id]);
};

~release = { |g|
	g[\sounding] !? { |sn| s.bind { sn[0].midi.noteOff(0, sn[1], 0) } };
	g[\sounding] = nil;
};

// --- generators ---

// (Re)starts the type's routine if it should be running. A sounding note is left to ring
// until the next strike, so restarts don't cut notes short.
~startGen = { |g|
	g[\task].stop;
	g[\task] = nil;
	if(~playing and: { g[\active] }) {
		g[\task] = Routine { g[\type][\run].value(g, g[\p]) }.play(~clock);
	};
};

~stopGen = { |g|
	g[\task].stop;
	g[\task] = nil;
	~release.(g);
};

~addGen = { |id, typeName|
	var type = ~types[typeName];
	if(type.isNil) { "unknown generator type %".format(typeName).warn } {
		~gens[id] = (id: id, type: type, p: type[\params].copy, active: false, track: 0);
	};
};

~removeGen = { |id| ~gens.removeAt(id) !? { |g| ~stopGen.(g) } };

~setGen = { |g, key, val|
	case
	{ key == \active } {
		g[\active] = val.asInteger == 1;
		if(g[\active]) { ~startGen.(g) } { ~stopGen.(g) };
	}
	{ key == \track } {
		~release.(g);
		g[\track] = val.asInteger;
	}
	{
		g[\p][key] = val;
		if(g[\task].notNil and: { g[\type][\restartOn].includes(key) }) { ~startGen.(g) };
	};
};

// --- transport ---

~setPlaying = { |on|
	~gens.do { |g| ~stopGen.(g) };
	~clock !? { ~clock.stop };
	~clock = nil;
	~playing = on;
	if(on) {
		~clock = TempoClock(~bpm / 60);
		Routine { loop { ~toUI.('/transport/beat', thisThread.beats.round.asInteger); 1.wait } }.play(~clock);
		~gens.do { |g| ~startGen.(g) };
	};
};

~setTempo = { |bpm|
	~bpm = bpm.clip(20, 400);
	~clock !? { ~clock.tempo = ~bpm / 60 };
};

~reset = {
	~setPlaying.(false);
	~gens.keys.copy.do { |id| ~removeGen.(id) };
	~tracks.keys.copy.do { |id| ~removeTrack.(id) };
};

// --- boot ---

s.latency = 0.05;
s.waitForBoot {
	SynthDef(\vsti, { |out| Out.ar(out, VSTPlugin.ar(nil, 2)) }).add;
	SynthDef(\trackOut, { |in, out = 0, amp = 1| Out.ar(out, In.ar(in, 2) * amp.lag(0.05)) }).add;
	s.sync;

	OSCdef(\hello, { if(~ready) { ~ui.sendMsg('/engine/ready'); ~sendInstruments.() } }, '/engine/hello');
	OSCdef(\reset, { ~reset.() }, '/engine/reset');
	OSCdef(\play, { |msg| ~setPlaying.(msg[1].asInteger == 1) }, '/transport/play');
	OSCdef(\tempo, { |msg| ~setTempo.(msg[1]) }, '/transport/tempo');

	OSCdef(\trackAdd, { |msg| ~addTrack.(msg[1], msg[2]) }, '/track/add');
	OSCdef(\trackPlugin, { |msg| ~tracks[msg[1]] !? { |tr| ~loadInstrument.(tr, msg[2]) } }, '/track/plugin');
	OSCdef(\trackVolume, { |msg| ~tracks[msg[1]] !? { |tr| tr[\out].set(\amp, msg[2]) } }, '/track/volume');
	OSCdef(\trackEditor, { |msg| ~tracks[msg[1]] !? { |tr| tr[\ctl] !? { |c| c.editor } } }, '/track/editor');
	OSCdef(\trackRemove, { |msg| ~removeTrack.(msg[1]) }, '/track/remove');

	OSCdef(\genAdd, { |msg| ~addGen.(msg[1], msg[2]) }, '/gen/add');
	OSCdef(\genRemove, { |msg| ~removeGen.(msg[1]) }, '/gen/remove');
	OSCdef(\genSet, { |msg| ~gens[msg[1]] !? { |g| ~setGen.(g, msg[2], msg[3]) } }, '/gen/set');

	"Scanning plugins...".postln;
	~scanPlugins.({
		~ready = true;
		"Engine ready: % instruments".format(~instruments.size).postln;
		~ui.sendMsg('/engine/ready');
		~sendInstruments.();
	});
};
)
