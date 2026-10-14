// progression — holds a chord progression and steps through it in time: a chord for generators to read (pick it in their `chord` menu, or put it first in the rack).
// made 2026-10-13. Three ways to give it chords:
//   play them   press Record and play the chords one after another; press Done
//   symbols     Am F C G7   (m, 7, m7, maj7, 6, m6, 9, m9, maj9, add9, sus2, sus4, dim, dim7, m7b5, aug;
//               voiced upward from octave 3)
//   notes       A2 C3 E3 | F2 A2 C3   (chords separated by |; a symbol can stand for a chord here too)
// It moves to the next chord every num/den beats while it's on and the transport plays; `now` shows
// the chord it's on. Generators hear it moved by octaves + semitones.
(
params: [
	[\chords, "Am F C G", \text],
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
	var steps = [0, 2, 4, 5, 7, 9, 11];
	var shapes = (maj: [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
		'6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '9': [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14],
		add9: [0, 4, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10],
		aug: [0, 4, 8]);
	// "Am7" -> pitches, or nil if it isn't a chord symbol
	var symbol = { |tok|
		var m = tok.asString.findRegexp("^([A-G])([#b]?)(maj7|maj9|m7b5|dim7|sus2|sus4|add9|dim|aug|m7|m9|m6|m|7|9|6)?$");
		if(m.isEmpty) { nil } {
			var acc = (m[2] !? (_[1])) ? "", kind = (m[3] !? (_[1])) ? "";
			var root = steps["CDEFGAB".indexOf(m[1][1][0])] + (if(acc == "#") { 1 } { if(acc == "b") { -1 } { 0 } }) + 48;
			root + shapes[if(kind.isEmpty) { \maj } { kind.asSymbol }];
		};
	};
	var words = { |s| s.asString.split($ ).reject(_.isEmpty) };
	var parts;
	if(g[\cache].isNil or: { g[\cache][0] != text }) {
		parts = if(text.includes($|)) { text.split($|) } {
			// no bars: a row of symbols is a chord each; anything else is one chord of notes
			if(words.(text).notEmpty and: { words.(text).every { |t| symbol.(t).notNil } }) { words.(text) } { [text] };
		};
		g[\cache] = [text, parts.collect { |s|
			var w = words.(s);
			if(w.size == 1 and: { symbol.(w[0]).notNil }) { symbol.(w[0]) } { ~parseNotes.(s) };
		}.reject(_.isEmpty)];
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
