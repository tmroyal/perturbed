// progression — holds a chord progression and steps through it in time: a chord for generators to read (pick it in their `chord` menu, or put it first in the rack).
// made 2026-10-13. `chords` is the progression, chords separated by |, as note names
// (A2 C3 E3 | F2 A2 C3). It moves to the next chord every num/den beats while it's on and the
// transport plays; `now` shows the chord it's on. Generators hear it moved by octaves + semitones.
(
params: [
	[\chords, "A2 C3 E3 | F2 A2 C3 | C3 E3 G3 | G2 B2 D3", \text],
	[\num, 4, \range, 1, 64], [\den, 1, \range, 1, 32],
	[\order, "forward", \choice, "forward", "backward", "back and forth", "random"],
	[\now, "", \text],                       // written by the generator: the chord it's on
	[\octave, 0, \range, -4, 4],
	[\semitone, 0, \range, -12, 12],
	~clockParam,
],
labels: (num: "each lasts", octave: "octaves", semitone: "semitones"),
sections: (chords: "Progression", octave: "Transpose", clock: "Clock"),
output: false,
on: true,
restartOn: [\num, \den, \clock],
onChange: (
	chords: { |g| ~syncChord.() },
	octave: { |g| ~syncChord.() },
	semitone: { |g| ~syncChord.() },
),

// the chord it's on: chord number g[\at] of the progression, transposed
chord: { |g, p|
	var list = p[\chords].asString.split($|).collect(~parseNotes).reject(_.isEmpty);
	if(list.isEmpty) { [] } {
		list.wrapAt(g[\at] ? 0) + (12 * p[\octave].asInteger) + p[\semitone].asInteger;
	};
},

run: { |g, p|
	~grid.(p[\num] / p[\den], { |k|
		var n = p[\chords].asString.split($|).collect(~parseNotes).reject(_.isEmpty).size.max(1);
		g[\at] = switch(p[\order].asSymbol,
			\backward, { (n - 1) - (k % n) },
			'back and forth', { k.fold(0, (n - 1).max(1)).min(n - 1) },
			\random, { n.rand },
			{ k % n });
		~setGen.(g, \now, "% of %: %".format(g[\at] + 1, n, g[\type][\chord].(g, p).collect(~noteName).join(" ")));
		~syncChord.();
	});
},
)
