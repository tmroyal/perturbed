// prime-durations — plays on a grid whose step is the prime ratio n/m (n and m prime) nearest to a point between its shortest and longest step.
// made 2026-10-05. Move `point` by hand, or map an LFO or a global to it, to wander through the
// prime rhythms; `playing` shows the ratio in use. Pitch and velocity work as in basic.
(
params: [
	[\shortest, 0.25, \range, 0.05, 8, 0.05],   // beats: the range the point moves in
	[\longest, 2, \range, 0.05, 8, 0.05],
	[\point, 0.5, \range, 0, 1, 0.001],         // 0 = shortest, 1 = longest; the nearest prime ratio plays
	[\maxPrime, 13, \range, 2, 31],             // primes up to here make the ratios
	[\playing, "", \text],                      // written by the generator: the ratio in use
] ++ ~pitchParams ++ ~velocityParams ++ [~clockParam],
showWhen: ~pitchShow ++ ~velocityShow,
labels: ~pitchLabels ++ ~velocityLabels ++ (shortest: "shortest (beats)", longest: "longest (beats)", maxPrime: "primes up to"),
sections: (shortest: "Prime durations", source: "Pitch", velMode: "Velocity", clock: "Clock"),
sliders: (point: \lin),
restartOn: [\clock],

run: { |g, p|
	var step = 0;
	// every n/m with n, m prime up to `top`, as [beats, "n/m"]
	var ratios = { |top|
		var primes = (2..top.asInteger.max(2)).select(_.isPrime);
		primes.collect { |n| primes.collect { |m| [n / m, "%/%".format(n, m)] } }.flatten(1);
	};
	// the ratio nearest the point, among those within shortest..longest (if none fits: among all)
	var nearest = {
		var lo = min(p[\shortest], p[\longest]), hi = max(p[\shortest], p[\longest]);
		var x = lo + (p[\point] * (hi - lo));
		var inRange = ratios.(p[\maxPrime]).select { |r| r[0] >= (lo - 1e-9) and: { r[0] <= (hi + 1e-9) } };
		(if(inRange.isEmpty) { ratios.(31) } { inRange }).minItem { |r| (r[0] - x).abs };
	};
	~grid.({
		var r = nearest.();
		if(p[\playing].asString != r[1]) { ~setGen.(g, \playing, r[1]) };
		r[0];
	}, { |k|
		var note = ~pitch.(p, step);
		step = step + 1;
		if(note.isNil) { ~release.(g) } { ~strike.(g, note, ~velocity.(g, p, k)) };
	});
},
)
