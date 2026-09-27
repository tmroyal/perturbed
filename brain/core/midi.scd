// midi.scd — MIDI outputs (one MIDIOut per configured port), note on/off, keyboard input.
//
// Every message is timestamped `latency` ahead of when it is sent, so CoreMIDI delivers it
// on time (within sclang's scheduling jitter, typically < 1 ms, occasionally ~5 ms). `now`
// sends immediately instead, for live keyboard notes (passthrough).
// Channels and ports are 1-based everywhere outside this file.
(
~midiInit = {
	MIDIClient.init(verbose: false);
	~outs = ~config[\ports].collect { |pair|
		var out;
		try { out = MIDIOut.newByName(*pair) } {
			Error("MIDI port % not found; add it in Audio MIDI Setup → IAC Driver".format(pair.join(" "))).throw;
		};
		out.latency = ~config[\latency];
		out;
	};

	// Inputs: connect everything, keep only the chosen inputs' messages.
	~inputUids = MIDIClient.sources.select { |e|
		~config[\inputs] !? { |ins| ins.any { |pair| e.device == pair[0] and: { e.name == pair[1] } } }
		?? { e.device != "IAC Driver" };
	}.collect(_.uid);
	MIDIIn.connectAll;
	MIDIdef.noteOn(\keyOn, { |vel, note, ch, src| if(~inputUids.includes(src)) { ~key.(note, vel) } });
	MIDIdef.noteOff(\keyOff, { |vel, note, ch, src| if(~inputUids.includes(src)) { ~key.(note, 0) } });
	"MIDI inputs: %".format(MIDIClient.sources.select { |e| ~inputUids.includes(e.uid) }
		.collect { |e| e.device + e.name }).postln;
};

// Keyboard input (vel 0 = key up). A key pressed while a param is learning only sets that param;
// otherwise keys go to the chord (core/chord.scd) and to key-driven generators (passthrough).
~key = { |note, vel|
	case
	{ vel > 0 and: { ~learning.notNil } } { ~learnNote.(note) }
	{ vel > 0 } { ~keyDown.(note); ~genKey.(note, vel) }
	{ ~keyUp.(note); ~genKey.(note, 0) };
};

~withOut = { |dest, now, fn|
	~outs[dest[\port] - 1] !? { |o|
		if(now) { o.latency = 0 };
		fn.(o);
		o.latency = ~config[\latency];
	};
};
~noteOn = { |dest, note, vel, now = false| ~withOut.(dest, now, { |o| o.noteOn(dest[\channel] - 1, note, vel) }) };
~noteOff = { |dest, note, now = false| ~withOut.(dest, now, { |o| o.noteOff(dest[\channel] - 1, note, 0) }) };
)
