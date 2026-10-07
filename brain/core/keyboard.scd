// keyboard.scd — MIDI input from the performer's keyboard and controllers: which devices count,
// where each key goes (learn, the chord, key-driven generators), and learn itself.
//
// Every source is connected; only the chosen inputs' messages are kept. The candidates are config
// `inputs`, or by default every source but the devices the brain sends to (so it never hears its
// own output, even if the IAC Driver is renamed) and Max's virtual "from Max" ports (they appear
// when Live runs a Max for Live device). The performer switches candidates off and on from the
// surface (/inputs/set); what's off is remembered in local/inputs.json (this machine's rig, not in
// git; not in test mode). /inputs/rescan finds devices plugged in since.
(
~inputsOff = Set[];  // "device name" of the candidates switched off
~inputsPath = { ~root.dirname +/+ "local" +/+ "inputs.json" };
~inputKey = { |e| if(e.device == e.name) { e.name } { e.device + e.name } };  // "MiniLab", or "IAC Driver Bus 2"

~inputCandidates = {
	var own = (~config[\ports] ++ (~config[\control] ? [])).collect(_[0]);
	MIDIClient.sources.select { |e|
		~config[\inputs] !? { |ins| ins.any { |pair| e.device == pair[0] and: { e.name == pair[1] } } }
		?? { own.includesEqual(e.device).not and: { e.device.beginsWith("from Max").not } };
	};
};

// Which sources are listened to now, and the list for surfaces.
~applyInputs = {
	~inputUids = ~inputCandidates.().reject { |e| ~inputsOff.includes(~inputKey.(e)) }.collect(_.uid);
	~sendInputs.();
};

~sendInputs = {
	~send.('/inputs', *~inputCandidates.().collect { |e| [~inputKey.(e), ~inputsOff.includes(~inputKey.(e)).not.binaryValue] }.flatten);
};

~setInput = { |name, on|
	if(on.asInteger == 1) { ~inputsOff.remove(name.asString) } { ~inputsOff.add(name.asString) };
	if(~testMode.not) { File.mkdir(~inputsPath.().dirname); ~writeJSON.(~inputsPath.(), (off: ~inputsOff.asArray.sort)) };
	~applyInputs.();
};

// Devices plugged in since the brain started: refresh the list and connect them.
~rescanInputs = {
	MIDIClient.list;
	try { MIDIIn.connectAll } { |e| "MIDI rescan: %".format(e.errorString).warn };
	~applyInputs.();
};

// Call after ~midiInit.
~keyboardInit = {
	if(~testMode.not and: { File.exists(~inputsPath.()) }) {
		~inputsOff = ((File.readAllString(~inputsPath.()).parseJSON ? ())["off"] ? []).asSet;
	};
	MIDIIn.connectAll;
	MIDIdef.noteOn(\keyOn, { |vel, note, ch, src| if(~inputUids.includes(src)) { ~key.(note, vel) } });
	MIDIdef.noteOff(\keyOff, { |vel, note, ch, src| if(~inputUids.includes(src)) { ~key.(note, 0) } });
	// knobs and faders: control changes from the same inputs drive globals (core/globals.scd)
	MIDIdef.cc(\knob, { |val, num, ch, src| if(~inputUids.includes(src)) { ~knob.(ch + 1, num, val) } });
	~applyInputs.();
	"MIDI inputs: %".format(MIDIClient.sources.select { |e| ~inputUids.includes(e.uid) }.collect(~inputKey)).postln;
};

// Keyboard input (vel 0 = key up). A key pressed while a param is learning only sets that param;
// otherwise keys go to the chord (core/chord.scd) and to key-driven generators (passthrough).
~key = { |note, vel|
	case
	{ vel > 0 and: { ~learning.notNil } } { ~learnNote.(note) }
	{ vel > 0 } { ~keyDown.(note); ~genKey.(note, vel) }
	{ ~keyUp.(note); ~genKey.(note, 0) };
};

// Learn: the next key played sets a generator's (note) param.
~learning = nil;  // [genId, param]

~learnGen = { |id, param, on|
	~learning !? { |l| ~send.('/gen/learn', l[0], l[1], 0) };
	~learning = if(on and: { ~gens[id].notNil }) { [id, param.asSymbol] };
	~learning !? { |l| ~send.('/gen/learn', l[0], l[1], 1) };
};

~learnNote = { |note|
	var l = ~learning;
	~learning = nil;
	~send.('/gen/learn', l[0], l[1], 0);
	~gens[l[0]] !? { |g| ~setGen.(g, l[1], note) };
};
)
