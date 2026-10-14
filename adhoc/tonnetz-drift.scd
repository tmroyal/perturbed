// tonnetz-drift — holds a triad that wanders through the Tonnetz by itself: a chord for generators to read (pick it in their `chord` menu, or put it first in the rack).
// made 2026-10-13. It starts on root + quality. Every num/den beats, while it's on and the
// transport plays, it makes one of the moves in `moves` at random, each of which changes one note
// by a step and keeps the other two:
//   P  parallel      C major <-> C minor
//   R  relative      C major <-> A minor
//   L  leading tone  C major <-> E minor
// The three voices move as little as they can and stay within an octave or so of where they
// started. `now` shows the triad it's on; `chance` is how often a move happens at all.
(
params: [
	[\root, 57, \note],
	[\quality, "minor", \choice, "major", "minor"],
	[\moves, "PLR", \text],
	[\chance, 100, \range, 0, 100],
	[\num, 4, \range, 1, 64], [\den, 1, \range, 1, 32],
	[\now, "", \text],                       // written by the generator: the triad it's on
	~clockParam,
],
labels: (num: "a move every", chance: "chance %"),
sections: (root: "Starts on", moves: "Drift", clock: "Clock"),
output: false,
on: true,
restartOn: [\num, \den, \clock],
// a new starting triad: begin again from it
onChange: (
	root: { |g| g[\tri] = nil; ~syncChord.() },
	quality: { |g| g[\tri] = nil; ~syncChord.() },
),

// g[\tri] is [root, third, fifth] as pitches (not in order of height), g[\major] its quality
chord: { |g, p|
	if(g[\tri].isNil) {
		var r = p[\root].asInteger;
		g[\major] = p[\quality].asString == "major";
		g[\tri] = [r, r + (if(g[\major]) { 4 } { 3 }), r + 7];
	};
	g[\tri];
},

run: { |g, p|
	var names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
	~grid.(p[\num] / p[\den], { |k|
		var t = g[\type][\chord].(g, p), r = t[0], third = t[1], fifth = t[2], center = p[\root].asInteger + 3;
		var allowed = p[\moves].asString.toUpper.select { |c| "PLR".includes(c) };
		if(k > 0 and: { allowed.notEmpty } and: { 100.rand < p[\chance] }) {
			switch(allowed.choose,
				$P, { t = if(g[\major]) { [r, third - 1, fifth] } { [r, third + 1, fifth] } },
				$R, { t = if(g[\major]) { [fifth + 2, r, third] } { [third, fifth, r - 2] } },
				$L, { t = if(g[\major]) { [third, fifth, r - 1] } { [fifth + 1, r, third] } });
			g[\major] = g[\major].not;
			// a voice that has wandered more than an octave from where it started comes back by an octave
			g[\tri] = t.collect { |n| if(n > (center + 12)) { n - 12 } { if(n < (center - 12)) { n + 12 } { n } } };
			~syncChord.();
		};
		~setGen.(g, \now, "% % (%)".format(names[g[\tri][0] % 12], if(g[\major]) { "major" } { "minor" },
			g[\tri].copy.sort.collect(~noteName).join(" ")));
	});
},
)
