// midi.scd — MIDI outputs (one MIDIOut per configured port) and note on/off.
//
// Every message is timestamped `latency` after the calling thread's logical time, so CoreMIDI
// delivers it on time regardless of sclang jitter. Channels and ports are 1-based everywhere
// outside this file.
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
};

~noteOn = { |dest, note, vel| ~outs[dest[\port] - 1] !? { |o| o.noteOn(dest[\channel] - 1, note, vel) } };
~noteOff = { |dest, note| ~outs[dest[\port] - 1] !? { |o| o.noteOff(dest[\channel] - 1, note, 0) } };
)
