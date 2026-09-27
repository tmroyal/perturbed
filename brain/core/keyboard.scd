// keyboard.scd — MIDI input from the performer's keyboard: which devices count, where each key
// goes (learn, the chord, key-driven generators), and learn itself.
(
// Connect every source, keep only the chosen inputs' messages (config `inputs`; default: all
// but the IAC Driver, whose buses carry the brain's own output). Call after ~midiInit.
~keyboardInit = {
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
