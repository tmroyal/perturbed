// chord.scd — chords: what the generators' pitch sources read (core/pitch.scd).
//
// A chord is held by a chord strip, a generator of type `chord` (types/chord.scd): it listens to the
// keyboard, keeps the last chord played and offers it, transposed, to the generators. There can be
// several; a generator picks one with its `chord` setting (a `chord` param: ~chordParam), 0 meaning
// the main chord: the first chord strip in the rack.
//
// ~chord is always the main chord (MIDI pitches, sorted; empty: rest), for types that read it
// directly. With no chord strip at all it is whatever /chord/set last put there.
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

// --- chord strips ---
~chordGens = { ~gensInOrder.().select { |g| g[\typeName] == \chord } };
~mainChordGen = { ~chordGens.().first };

// A chord strip's chord as generators hear it: its notes, transposed.
~chordOf = { |g|
	var p = g[\p], str = p[\notes].asString, shift = (12 * p[\octave].asInteger) + p[\semitone].asInteger;
	if(g[\parsed].isNil or: { g[\parsed][0] != str }) { g[\parsed] = [str, ~parseNotes.(str)] };
	(g[\parsed][1] + shift).select(_.inclusivelyBetween(0, 127));
};

// The chord a generator reads: its `chord` setting's strip, or the main chord (0, or a strip that's gone).
~chordParam = [\chord, 0, \chord];
~chordFor = { |p|
	var g = ~gens[(p[\chord] ? 0).asInteger];
	if(g.notNil and: { g[\typeName] == \chord }) { ~chordOf.(g) } { ~chord };
};

// Keeps ~chord the main chord and tells everyone; called whenever a chord strip changes, comes or goes.
~syncChord = {
	~mainChordGen.() !? { |g| ~chord = ~chordOf.(g) };
	~sendChord.();
};
~sendChord = { ~send.('/chord', *~chord) };

// Sets the main chord from outside (/chord/set: the CLI, Claude auditioning a chord): on the main
// chord strip if there is one (its transposition still applies on top).
~setChord = { |pitches|
	var notes = pitches.collect(_.asInteger).asSet.asArray.sort;
	var g = ~mainChordGen.();
	if(g.notNil) { ~setGen.(g, \notes, notes.collect(~noteName).join(" ")) } { ~chord = notes };
	~syncChord.();  // answered even when nothing changed
};
)
