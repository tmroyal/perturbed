// chord.scd — chords: what the generators' pitch sources read (core/pitch.scd).
//
// A chord is provided by a generator whose type has a `chord` function ({ |g, p| pitches }): the
// built-in chord strip (types/chord.scd: it listens to the keyboard and holds what was played), or
// any AdHoc type (a progression, a chord that drifts by itself). There can be several; a generator
// picks one with its `chord` setting (a `chord` param: ~chordParam), 0 meaning the main chord: the
// first chord provider in the rack.
//
// ~chord is the main chord (MIDI pitches, sorted; empty: rest), for types that read it directly;
// a provider whose chord changes by itself calls ~syncChord.() to keep it (and /chord) current.
// With no provider there is no chord: it's empty and generators that read one rest.
(
~chord = [];
~held = Set[];  // the keys down now (chord strips build their gestures from it)

~keyDown = { |note| ~held.add(note) };
~keyUp = { |note| ~held.remove(note) };

// --- note names: "C4" = 60, sharps as #, flats as b; plain numbers pass ---
~noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
~noteName = { |n| ~noteNames[n.asInteger % 12] ++ ((n.asInteger div: 12) - 1) };
~parseNote = { |token|
	var t = token.asString.replace("♯", "#").replace("♭", "b"), m;
	if("^-?[0-9]+$".matchRegexp(t)) { t.asInteger } {
		m = t.findRegexp("^([A-Ga-g])([#b]?)(-?[0-9]+)$");
		if(m.isEmpty) { nil } {
			[0, 2, 4, 5, 7, 9, 11]["CDEFGAB".indexOf(m[1][1].toUpper[0])]
			+ (if(m[2][1] == "#") { 1 } { if(m[2][1] == "b") { -1 } { 0 } }) + ((m[3][1].asInteger + 1) * 12);
		};
	};
};
// "A2 C3 E3" (or numbers, commas) -> pitches, sorted, each once; what doesn't parse is dropped
~parseNotes = { |str|
	str.asString.split($ ).collect { |t| t.split($,) }.flatten(1).reject(_.isEmpty)
		.collect(~parseNote).reject(_.isNil).select(_.inclusivelyBetween(0, 127)).asSet.asArray.sort;
};

// --- chord providers ---
~providesChord = { |g| g[\type][\chord].notNil };
~chordGens = { ~gensInOrder.().select(~providesChord) };
~mainChordGen = { ~chordGens.().first };

// A provider's chord as generators hear it: what its type's `chord` function returns, as MIDI
// pitches in range, sorted, each once. A failing function stops that generator and gives no chord.
~chordOf = { |g|
	var notes = try { g[\type][\chord].(g, g[\p]) } { |e| ~genFailed.(g, e); [] };
	(notes ? []).asArray.select(_.isNumber).collect(_.asInteger).select(_.inclusivelyBetween(0, 127)).asSet.asArray.sort;
};

// For the built-in chord strip (and any type built like it): the chord in a text setting of note
// names, cached while the text stays the same, moved by its octave and semitone settings.
~heldChord = { |g, p|
	var str = p[\notes].asString;
	if(g[\parsed].isNil or: { g[\parsed][0] != str }) { g[\parsed] = [str, ~parseNotes.(str)] };
	g[\parsed][1] + (12 * (p[\octave] ? 0).asInteger) + (p[\semitone] ? 0).asInteger;
};

// The chord a generator reads, now: its `chord` setting's provider, or the main one (0, or one that's gone).
~chordParam = [\chord, 0, \chord];
~chordFor = { |p|
	var g = ~gens[(p[\chord] ? 0).asInteger];
	if(g.isNil or: { ~providesChord.(g).not }) { g = ~mainChordGen.() };
	g !? ~chordOf ? [];
};

// Keeps ~chord the main chord (empty when the last chord strip is gone) and tells everyone; called
// whenever a chord strip changes, comes or goes.
~syncChord = {
	~chord = ~mainChordGen.() !? { |g| ~chordOf.(g) } ? [];
	~sendChord.();
};
~sendChord = { ~send.('/chord', *~chord) };

// Sets the main chord from outside (/chord/set: the CLI, Claude auditioning a chord): on the main
// chord strip (its transposition still applies on top), adding one if there is none, so the chord is
// always somewhere it can be seen. Clearing with no chord strip adds nothing. If the main chord comes
// from a type that makes its own (no `notes` setting), it can't be set: that is reported.
~setChord = { |pitches|
	var notes = pitches.collect(_.asInteger).asSet.asArray.sort;
	var g = ~mainChordGen.();
	if(g.isNil and: { notes.notEmpty }) {
		if(~types[\chord].isNil) { ~loadType.(\chord) };
		g = ~addGen.(\chord) !? { |id| ~gens[id] };
	};
	g !? {
		if(g[\p].includesKey(\notes)) { ~setGen.(g, \notes, notes.collect(~noteName).join(" ")) } {
			~report.("the main chord comes from % (%), which makes its own: set it there, or put a chord strip first".format(g[\id], g[\typeName]));
		};
	};
	~syncChord.();  // answered even when nothing changed
};
)
