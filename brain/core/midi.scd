// midi.scd — MIDI outputs (one MIDIOut per configured port) and note on/off.
//
// Every message is timestamped `latency` after the calling thread's logical time, so CoreMIDI
// delivers it on time regardless of sclang jitter. MIDIOut.latency counts from the moment of
// sending, not from logical time, so ~out subtracts how late the thread is running.
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
};

~out = { |dest|
	~outs[dest[\port] - 1] !? { |o|
		o.latency = (~config[\latency] - (Main.elapsedTime - thisThread.seconds)).max(0);
		o;
	};
};

~noteOn = { |dest, note, vel| ~out.(dest) !? { |o| o.noteOn(dest[\channel] - 1, note, vel) } };
~noteOff = { |dest, note| ~out.(dest) !? { |o| o.noteOff(dest[\channel] - 1, note, 0) } };
)
