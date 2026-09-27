// midi.scd — MIDI outputs (one MIDIOut per configured port), note on/off, keyboard input.
//
// Every message is timestamped `latency` ahead of when it is sent, so CoreMIDI delivers it
// on time (within sclang's scheduling jitter, typically < 1 ms, occasionally ~5 ms).
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
	MIDIdef.noteOn(\keyOn, { |vel, note, ch, src|
		if(~inputUids.includes(src)) { if(vel > 0) { ~keyDown.(note) } { ~keyUp.(note) } };
	});
	MIDIdef.noteOff(\keyOff, { |vel, note, ch, src| if(~inputUids.includes(src)) { ~keyUp.(note) } });
	"MIDI inputs: %".format(MIDIClient.sources.select { |e| ~inputUids.includes(e.uid) }
		.collect { |e| e.device + e.name }).postln;
};

~noteOn = { |dest, note, vel| ~outs[dest[\port] - 1] !? { |o| o.noteOn(dest[\channel] - 1, note, vel) } };
~noteOff = { |dest, note| ~outs[dest[\port] - 1] !? { |o| o.noteOff(dest[\channel] - 1, note, 0) } };
)
