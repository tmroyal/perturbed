// midi.scd — MIDI outputs (one MIDIOut per configured port, plus the control bus), note on/off
// and control changes.
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
	// the control bus is optional: without it LFOs and /cc are silent
	~ctl = nil;
	~config[\control] !? { |pair|
		try { ~ctl = MIDIOut.newByName(*pair); ~ctl.latency = ~config[\latency] } {
			"MIDI control bus % not found: LFOs and /cc are silent (add it in Audio MIDI Setup → IAC Driver)"
			.format(pair.join(" ")).warn;
		};
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

// A control change on the control bus; channel 1-based.
~cc = { |channel, num, val, now = false|
	~ctl !? { |o|
		if(now) { o.latency = 0 };
		o.control(channel.asInteger.clip(1, 16) - 1, num.asInteger.clip(0, 127), val.asInteger.clip(0, 127));
		o.latency = ~config[\latency];
	};
};
)
