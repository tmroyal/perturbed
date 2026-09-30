// lfo — a low-frequency oscillator sent as MIDI control changes on the control bus (config
// `control`), not to an output. In Live, map it with MIDI Map mode (⌘M, click a parameter, let the
// LFO move) or a plugin's MIDI learn; `/cc` sends one value, for mapping while it's off.
//
// Rate is like Ableton's LFO: sync = one cycle per num/den beats of its clock, counted from the
// grid origin (so it lines up with Live's bars); free = cycles per second from play. It sends about
// 50 values a second, only when the value changes, timestamped like notes.
(
params: [
	[\shape, "sine", \choice, "sine", "triangle", "saw up", "saw down", "square", "random", "smooth random"],
	[\rate, "sync", \choice, "sync", "free"],
	[\num, 4, \range, 1, 64],
	[\den, 1, \range, 1, 32],
	[\hz, 0.25, \range, 0.01, 20, 0.01],
	[\phase, 0, \range, 0, 1, 0.01],
	[\low, 0, \range, 0, 127],
	[\high, 127, \range, 0, 127],
	[\channel, 1, \range, 1, 16],
	[\cc, 1, \range, 0, 127],
	~clockParam,
],
output: false,
showWhen: (num: [\rate, "sync"], den: [\rate, "sync"], clock: [\rate, "sync"], hz: [\rate, "free"]),
labels: (rate: "rate", num: "cycle", hz: "Hz", low: "from", high: "to"),
sections: (shape: "Wave", low: "Range", channel: "MIDI CC", clock: "Clock"),
restartOn: [\clock],

run: { |g, p|
	var t0 = thisThread.seconds, last = nil;
	// a repeatable random value in 0..1 per cycle (a shader-style hash), so a restart replays the same steps
	var rnd = { |n| ((n * 12.9898 + (g[\id] * 78.233)).sin * 43758.5453).frac };
	loop {
		var x = p[\phase].asFloat + if(p[\rate].asString == "free") { (thisThread.seconds - t0) * p[\hz].asFloat } {
			~beats.() / (p[\num].asInteger.max(1) / p[\den].asInteger.max(1))
		};
		var c = x.floor, f = x - c;
		var u = switch(p[\shape].asString,
			"triangle", { 1 - ((2 * f) - 1).abs },
			"saw up", { f },
			"saw down", { 1 - f },
			"square", { if(f < 0.5) { 1 } { 0 } },
			"random", { rnd.(c) },
			"smooth random", { rnd.(c) + ((rnd.(c + 1) - rnd.(c)) * (0.5 - (0.5 * cos(pi * f)))) },
			{ 0.5 + (0.5 * sin(2pi * f)) });
		var v = (p[\low].asFloat + ((p[\high].asFloat - p[\low].asFloat) * u)).round.asInteger;
		if(v != last) { ~cc.(p[\channel], p[\cc], v); last = v };
		(0.02 * thisThread.clock.tempo).wait;
	};
},
)
