// midi.scd — MIDI outputs (one MIDIOut per configured port, plus the control bus), note on/off
// and control changes.
//
// Every message is timestamped `latency` ahead of when it is sent, so CoreMIDI delivers it
// on time (within sclang's scheduling jitter, typically < 1 ms, occasionally ~5 ms). `now`
// sends immediately instead, for live keyboard notes (passthrough).
// Channels and ports are 1-based everywhere outside this file.
(
~openOut = { |pair| var o = MIDIOut.newByName(*pair); o.latency = ~config[\latency]; o };

~midiInit = {
	MIDIClient.init(verbose: false);
	~outs = ~config[\ports].collect { |pair|
		try { ~openOut.(pair) } {
			Error("MIDI port % not found; add it in Audio MIDI Setup → IAC Driver".format(pair.join(" "))).throw;
		};
	};
	// control buses are optional: a missing one is silent (nil)
	~ctls = (~config[\control] ? []).collect { |pair|
		try { ~openOut.(pair) } {
			"MIDI control bus % not found: LFOs on it are silent (add it in Audio MIDI Setup → IAC Driver)"
			.format(pair.join(" ")).warn;
			nil;
		};
	};
};

// Sends on `out` (nil: nothing), at once if `now`, else `latency` ahead.
~withOut = { |out, now, fn|
	out !? {
		if(now) { out.latency = 0 };
		fn.(out);
		out.latency = ~config[\latency];
	};
};
~noteOn = { |dest, note, vel, now = false| ~withOut.(~outs[dest[\port] - 1], now, { |o| o.noteOn(dest[\channel] - 1, note, vel) }) };
~noteOff = { |dest, note, now = false| ~withOut.(~outs[dest[\port] - 1], now, { |o| o.noteOff(dest[\channel] - 1, note, 0) }) };

// The control buses by name (as LFOs show and save them): port n = ~controlNames[n-1].
~controlNames = (~config[\control] ? []).collect(_[1]);

// A control change on control bus `port`; port and channel 1-based.
~cc = { |port, channel, num, val, now = false|
	~withOut.(~ctls[port.asInteger - 1], now,
		{ |o| o.control(channel.asInteger.clip(1, 16) - 1, num.asInteger.clip(0, 127), val.asInteger.clip(0, 127)) });
};
)
