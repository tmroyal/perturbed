// rhythm.scd — which grid steps play; shared by generator types. A type adds ~rhythmParams to its
// params and ~rhythmShow to its showWhen, then plays grid step k (counted from transport start)
// when ~rhythmGate.(p, k) is true. A skipped step lets the previous note ring on.
//   every   every `interval`th step, starting at `offset`
//   euclid  `pulses` spread evenly over `steps`, rotated by `offset`
//   random  each step plays with probability `prob` %
//   phrase  gaps between notes in steps, typed as "1 2 1 1 2", cycling; invalid → every 1
(
~rhythmParams = [
	[\rhythm, "every", \choice, "every", "euclid", "random", "phrase"],
	[\interval, 1, \range, 1, 32],
	[\pulses, 3, \range, 1, 19],
	[\steps, 8, \range, 2, 19],
	[\offset, 0, \range, 0, 31],
	[\prob, 50, \range, 0, 100],
	[\phrase, "1 2 1 1 2", \text],
];

~rhythmShow = (
	interval: [\rhythm, "every"],
	pulses: [\rhythm, "euclid"],
	steps: [\rhythm, "euclid"],
	offset: [\rhythm, "every", "euclid"],
	prob: [\rhythm, "random"],
	phrase: [\rhythm, "phrase"],
);

// Onset positions within one cycle of a phrase, and the cycle length: "1 2" → [[0, 1], 3].
~phraseCycle = { |text|
	var gaps = text.asString.split($ ).reject(_.isEmpty);
	gaps = if(gaps.notEmpty and: { gaps.every { |s| s.every(_.isDecDigit) and: { s.asInteger > 0 } } }) {
		gaps.collect(_.asInteger)
	} { [1] };
	[([0] ++ gaps.integrate).drop(-1), gaps.sum];
};

~rhythmGate = { |p, k|
	var offset = p[\offset].asInteger;
	switch(p[\rhythm].asSymbol,
		\euclid, {
			var steps = p[\steps].asInteger.clip(2, 19), pulses = p[\pulses].asInteger.clip(1, steps);
			((k - offset) % steps * pulses % steps) < pulses;
		},
		\random, { (p[\prob].asFloat / 100).coin },
		\phrase, {
			var cycle = ~phraseCycle.(p[\phrase]);
			cycle[0].includes(k % cycle[1]);
		},
		{ (k - offset) % p[\interval].asInteger.max(1) == 0 });
};
)
