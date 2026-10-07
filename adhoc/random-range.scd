// random-range — on each step plays a random note between `base` and `base` + `span` semitones with a chance of `chance` %, otherwise rests.
// made 2026-10-05
(
params: [
	[\base, 60, \note],
	[\span, 12, \range, -48, 48],                            // semitones from base, inclusive; negative = below
	[\chance, 50, \range, 0, 100],
	[\num, 1, \range, 1, 32], [\den, 4, \range, 1, 32],      // grid step = num/den beats
	[\interval, 1, \range, 1, 32], [\offset, 0, \range, 0, 31],  // basic's "every": every interval-th step from offset
	[\velocity, 80, \range, 1, 127],
	[\velRandom, 0, \range, 0, 64],
	~clockParam,
],
labels: (span: "span (semitones)", chance: "chance %", interval: "every", velRandom: "random ±"),
sections: (base: "Pitch", num: "Rhythm", velocity: "Velocity", clock: "Clock"),
restartOn: [\clock, \num, \den],

run: { |g, p|
	~grid.(p[\num].asInteger.max(1) / p[\den].asInteger.max(1), { |k|
		// a step that isn't its turn lets the previous note ring on, as in basic
		if((k - p[\offset].asInteger) % p[\interval].asInteger.max(1) == 0) {
			if((p[\chance].asFloat / 100).coin) {
				var base = p[\base].asInteger;
				var note = rrand(base, base + p[\span].asInteger).clip(0, 127);
				var vel = (p[\velocity].asFloat + p[\velRandom].asFloat.rand2).round.asInteger.clip(1, 127);
				~strike.(g, note, vel);
			} { ~release.(g) };
		};
	});
}
)
