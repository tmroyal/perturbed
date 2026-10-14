// progression — holds a chord progression and steps through it in time: a chord for generators to read (pick it in their `chord` menu, or put it first in the rack).
// made 2026-10-13. Two ways to give it chords:
//   play them   press Record and play the chords one after another; press Done
//   type them   A2 C3 E3 | F2 A2 C3   (note names, chords separated by |)
// It moves to the next chord every num/den beats while it's on and the transport plays; `now` shows
// the chord it's on. Generators hear it moved by octaves + semitones.
(
params: [
	[\chords, "A2 C3 E3 | F2 A2 C3 | C3 E3 G3 | G2 B2 D3", \text],
	[\record, "off", \choice, "off", "on"],
	[\num, 4, \range, 1, 64], [\den, 1, \range, 1, 32],
	[\order, "forward", \choice, "forward", "backward", "back and forth", "random"],
	[\now, "", \text],                       // written by the generator: the chord it's on
	[\octave, 0, \range, -4, 4],
	[\semitone, 0, \range, -12, 12],
	~clockParam,
],
labels: (record: "recording", num: "each lasts", octave: "octaves", semitone: "semitones"),
sections: (chords: "Progression", num: "Time", octave: "Transpose", clock: "Clock"),
output: false,
on: true,
restartOn: [\num, \den, \clock],
actions: (
	// start over and take chords from the keyboard: each chord played (until all keys are up) is the next one
	Record: { |g, p| ~setGen.(g, \chords, ""); g[\at] = 0; ~setGen.(g, \record, "on"); ~setGen.(g, \now, "play the chords, then Done") },
	Done: { |g, p| ~setGen.(g, \record, "off"); g[\at] = 0; ~setGen.(g, \now, ""); ~syncChord.() },
),
onChange: (
	chords: { |g| ~syncChord.() },
	octave: { |g| ~syncChord.() },
	semitone: { |g| ~syncChord.() },
),

// the progression as a list of chords (pitches), from the text; kept until the text changes
list: { |g, p|
	var text = p[\chords].asString;
	if(g[\cache].isNil or: { g[\cache][0] != text }) {
		g[\cache] = [text, text.split($|).collect(~parseNotes).reject(_.isEmpty)];
	};
	g[\cache][1];
},

// the chord it's on: chord number g[\at] of the progression, transposed
chord: { |g, p|
	var list = g[\type][\list].(g, p);
	if(list.isEmpty) { [] } { list.wrapAt(g[\at] ? 0) + (12 * p[\octave].asInteger) + p[\semitone].asInteger };
},

// recording: each chord played becomes the next chord of the progression
key: { |g, p, note, vel|
	if(p[\record].asString == "on") {
		g[\down] = (g[\down] ? Set[]) & ~held;
		g[\gesture] = g[\gesture] ? Set[];
		if(vel > 0) {
			if(g[\down].isEmpty) { g[\gesture] = Set[] };
			g[\down].add(note);
			g[\gesture].add(note);
		} {
			if(g[\gesture].includes(note) and: { g[\down].isEmpty }) {
				var played = g[\gesture].asArray.sort.collect(~noteName).join(" "), old = p[\chords].asString;
				g[\gesture] = Set[];
				~setGen.(g, \chords, if(old.isEmpty) { played } { old ++ " | " ++ played });
				g[\at] = g[\type][\list].(g, p).size - 1;  // generators hear the chord just played
				~setGen.(g, \now, "% recorded: play the next, or Done".format(g[\at] + 1));
				~syncChord.();
			};
		};
	};
},

run: { |g, p|
	~grid.(p[\num] / p[\den], { |k|
		var n = g[\type][\list].(g, p).size.max(1);
		if(p[\record].asString != "on") {  // it waits while its chords are being played in
			g[\at] = switch(p[\order].asSymbol,
				\backward, { (n - 1) - (k % n) },
				'back and forth', { k.fold(0, (n - 1).max(1)).min(n - 1) },
				\random, { n.rand },
				{ k % n });
			~setGen.(g, \now, "% of %: %".format(g[\at] + 1, n, g[\type][\chord].(g, p).collect(~noteName).join(" ")));
			~syncChord.();
		};
	});
},
)
