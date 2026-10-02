// fibonacci — repeats one note with durations following the Fibonacci series (1 1 2 3 5 8 ... units of num/den beats), cycling after `terms` of them.
// made 2026-10-01
(
params: [
	[\note, 60, \note],
	[\num, 1, \range, 1, 32], [\den, 4, \range, 1, 32],      // unit = num/den beats
	[\terms, 6, \range, 1, 12],                             // how many of the series before it cycles
	[\order, "up", \choice, "up", "down", "up-down"],       // short to long, long to short, or both
] ++ ~velocityParams ++ [~clockParam],
showWhen: ~velocityShow,
labels: ~velocityLabels,
sections: (note: "Pitch", num: "Durations", velMode: "Velocity", clock: "Clock"),
restartOn: [\clock, \num, \den],

run: { |g, p|
	var unit = p[\num].asInteger.max(1) / p[\den].asInteger.max(1);
	var k = (~beats.() / unit - 1e-9).ceil.asInteger;  // next unit grid index at or after now
	var i = 0;  // notes played
	var fib = { |n| var a = 1, b = 1; n.do { var t = a + b; a = b; b = t }; a };
	loop {
		var terms = p[\terms].asInteger.max(1);
		var order = p[\order].asString;
		var idx;
		(k * unit - ~beats.()).max(0).wait;
		idx = case
			{ order == "down" } { terms - 1 - (i % terms) }
			{ order == "up-down" } { (i % ((terms * 2) - 2).max(1)).fold(0, terms - 1) }
			{ i % terms };
		~strike.(g, p[\note].asInteger.clip(0, 127), ~velocity.(g, p, k));
		k = k + fib.(idx);  // the note rings until the next one
		i = i + 1;
	};
}
)
