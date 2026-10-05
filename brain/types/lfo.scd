// lfo — a low-frequency oscillator that moves settings of other generators (Map, then click them:
// each target has its own from → to; another lfo's Hz or range can be a target), and/or is sent as
// MIDI control changes on a control bus (config `control`, picked by name). Not to an output. In Live, map it with MIDI Map mode (⌘M, click a parameter, let the
// LFO move) or a plugin's MIDI learn. The card's Send button sends one value (from/to in turn),
// for mapping without playing.
//
// Rate is like Ableton's LFO: sync = one cycle per num/den beats of its clock, counted from the
// grid origin (so it lines up with Live's bars); free = cycles per second from play. It sends about
// 50 values a second, only when the value changes, timestamped like notes.
// One value on its bus, channel and cc (a bus not in config `control` is silent).
~lfoCC = { |p, v, now = false|
	~cc.(~controlNames.indexOfEqual(p[\port].asString) !? (_ + 1) ? 0, p[\channel].asString.asInteger, p[\cc], v, now);
};
(
params: [
	[\shape, "sine", \choice, "sine", "triangle", "saw up", "saw down", "square", "random", "smooth random"],
	[\rate, "sync", \choice, "sync", "free"],
	[\num, 4, \range, 1, 64],
	[\den, 1, \range, 1, 32],
	[\hz, 0.25, \range, 0.01, 20, 0.01],
	[\phase, 0, \range, 0, 1, 0.01],
	[\sendCC, "on", \choice, "on", "off"],
	[\port, ~controlNames.first ? "", \choice] ++ ~controlNames,
	[\channel, "1", \choice] ++ (1..16).collect(_.asString),
	[\cc, 1, \range, 0, 127],
	[\low, 0, \range, 0, 127],
	[\high, 127, \range, 0, 127],
	~clockParam,
],
output: false,
maps: true,
sliders: (hz: \log, phase: \lin),
showWhen: (num: [\rate, "sync"], den: [\rate, "sync"], clock: [\rate, "sync"], hz: [\rate, "free"],
	low: [\sendCC, "on"], high: [\sendCC, "on"], port: [\sendCC, "on"], channel: [\sendCC, "on"], cc: [\sendCC, "on"]),
labels: (rate: "rate", num: "cycle", hz: "Hz", low: "from", high: "to", port: "bus", sendCC: "send CC"),
sections: (shape: "Wave", sendCC: "MIDI CC", clock: "Clock"),
restartOn: [\clock],
actions: (
	// one value now, alternating from/to so a mapped parameter visibly moves
	Send: { |g, p|
		g[\sendTo] = (g[\sendTo] ? false).not;
		~lfoCC.(p, if(g[\sendTo]) { p[\high] } { p[\low] }, true);
	},
),

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
		if(~sounds.(g).not) { last = nil } {  // muted by its group: silent, and resends when back
			~drive.(g, u);  // the settings mapped to it (each over its own range)
			if(p[\sendCC].asString == "on") { if(v != last) { ~lfoCC.(p, v); last = v } } { last = nil };
		};
		(0.02 * thisThread.clock.tempo).wait;
	};
},
)
