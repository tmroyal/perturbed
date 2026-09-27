// midi.scd — MIDI outputs (one MIDIOut per configured port) and note on/off.
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
