// velocity.scd — how loud; shared by generator types. A type adds ~velocityParams to its params
// (with ~velocityShow and ~velocityLabels), then calls ~velocity.(g, p, k) for each note
// (k = the note's grid index since transport start).
//   set     velocity
//   accent  accent on every `every`th grid step (k = 0, every, 2·every, ...), velocity otherwise
//   random  uniform in low..high, per note
//   drift   smooth random wander in low..high; `rate` new targets per beat
//   ramp    low→high over `attack` beats, high→low over `decay` beats, repeating from beat 0
//   pattern velocities typed as "110 60 80 60", one per grid step, cycling from k = 0
// humanize adds a random ±amount on top of any mode.
(
~velocityParams = [
	[\velMode, "set", \choice, "set", "accent", "random", "drift", "ramp", "pattern"],
	[\velocity, 80, \range, 1, 127],
	[\accent, 110, \range, 1, 127],
	[\every, 4, \range, 1, 32],
	[\low, 40, \range, 1, 127],
	[\high, 100, \range, 1, 127],
	[\rate, 0.5, \range, 0.05, 8, 0.05],
	[\attack, 4, \range, 0, 64],
	[\decay, 4, \range, 0, 64],
	[\pattern, "110 60 80 60", \text],
	[\humanize, 0, \range, 0, 32],
];

~velocityShow = (
	velocity: [\velMode, "set", "accent"],
	accent: [\velMode, "accent"],
	every: [\velMode, "accent"],
	low: [\velMode, "random", "drift", "ramp"],
	high: [\velMode, "random", "drift", "ramp"],
	rate: [\velMode, "drift"],
	attack: [\velMode, "ramp"],
	decay: [\velMode, "ramp"],
	pattern: [\velMode, "pattern"],
);

~velocityLabels = (
	velMode: "mode", velocity: "value", every: "every", rate: "rate / beat",
	attack: "rise beats", decay: "fall beats", pattern: "values", humanize: "humanize ±",
);

~velocity = { |g, p, k|
	var low = p[\low].asFloat, high = p[\high].asFloat, beats = ~beats.();
	var vel = switch(p[\velMode].asSymbol,
		\accent, { if(k % p[\every].asInteger.max(1) == 0) { p[\accent] } { p[\velocity] } },
		\random, { rrand(low, high) },
		\drift, {
			// cosine interpolation between random targets, one per 1/rate beats
			var t = beats * p[\rate].asFloat.max(0.001), seg = t.floor;
			if(seg != g[\driftSeg]) {
				g[\driftA] = if(seg == ((g[\driftSeg] ? -2) + 1)) { g[\driftB] } { 1.0.rand };
				g[\driftB] = 1.0.rand;
				g[\driftSeg] = seg;
			};
			low + ((high - low) * (g[\driftA] + ((g[\driftB] - g[\driftA]) * (0.5 - (0.5 * cos(pi * (t - seg)))))));
		},
		\ramp, {
			var a = p[\attack].asFloat, d = p[\decay].asFloat, pos = beats % (a + d).max(0.001);
			if(pos < a) { low + ((high - low) * pos / a) } { high - ((high - low) * (pos - a) / d.max(0.001)) };
		},
		\pattern, {
			var steps = p[\pattern].asString.split($ ).reject(_.isEmpty).collect(_.asInteger);
			if(steps.notEmpty) { steps.wrapAt(k) } { p[\velocity] };
		},
		{ p[\velocity] });
	(vel.asFloat + p[\humanize].asFloat.rand2).round.asInteger.clip(1, 127);
};
)
