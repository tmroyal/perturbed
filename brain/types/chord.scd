// chord — listens to the keyboard and holds a chord for generators to read (their `chord` setting).
// It makes no sound. While it's On it listens; Off, it keeps what it has.
//   take    every chord: each chord played replaces the one held
//           next chord: only the next one (Arm), then it holds
//           hold: playing changes nothing
//   taken   on release: the chord (every key pressed until all are up) replaces the old one when
//           the last key comes up
//           as played: the first key starts a new chord and each further key adds to it at once,
//           until the last key comes up
// `holding` is the chord itself, as note names; it can be typed. Generators hear it moved by
// octaves + semitones. It can listen to one input only, and to a range of keys only, so two chord
// strips can split a keyboard or take a keyboard each.
(
params: [
	[\take, "every chord", \choice, "every chord", "next chord", "hold"],
	[\build, "on release", \choice, "on release", "as played"],
	[\notes, "", \text],
	[\octave, 0, \range, -4, 4],
	[\semitone, 0, \range, -12, 12],
	[\input, "any", \input],
	[\lo, 0, \note],
	[\hi, 127, \note],
],

labels: (build: "taken", notes: "holding", octave: "octaves", semitone: "semitones", input: "from", lo: "lowest key", hi: "highest key"),
sections: (take: "Chord", octave: "Transpose", input: "Listens to"),
output: false,
on: true,  // listening from the start
chord: { |g, p| ~heldChord.(g, p) },  // what generators hear: its notes, transposed

actions: (
	Arm: { |g, p| ~setGen.(g, \take, "next chord") },
	Clear: { |g, p| ~setGen.(g, \notes, "") },
),
onChange: (
	notes: { |g| ~syncChord.() },
	octave: { |g| ~syncChord.() },
	semitone: { |g| ~syncChord.() },
),

key: { |g, p, note, vel, src|
	var mine = note.inclusivelyBetween(p[\lo].asInteger, p[\hi].asInteger)
		and: { p[\input].asString == "any" or: { p[\input].asString == src.asString } };
	var store = { ~setGen.(g, \notes, g[\gesture].asArray.sort.collect(~noteName).join(" ")) };
	// whether it takes a chord is decided when the chord is stored (not when its first key went down),
	// so setting `take` or the notes while a key is still down does what it says
	var taking = { p[\take].asString != "hold" };
	g[\down] = (g[\down] ? Set[]) & ~held;  // keys released while it was off are forgotten
	g[\gesture] = g[\gesture] ? Set[];
	if(vel > 0) {
		if(mine) {
			if(g[\down].isEmpty) { g[\gesture] = Set[] };
			g[\down].add(note);
			g[\gesture].add(note);
			if(taking.() and: { p[\build].asString == "as played" }) { store.(); ~send.('/note', g[\id], note, vel) };
		};
	} {
		if(g[\gesture].includes(note) and: { g[\down].isEmpty }) {
			if(taking.()) {
				if(p[\build].asString == "on release") { store.(); ~send.('/note', g[\id], note, 64) };
				if(p[\take].asString == "next chord") { ~setGen.(g, \take, "hold") };
			};
			g[\gesture] = Set[];
		};
	};
},
)
