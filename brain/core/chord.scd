// chord.scd — the current chord, played on the keyboard; generators read it.
//
// The chord is latched: it stays after the keys are released. Modes:
//   auto  a new chord (first key after all keys were up) replaces the current one
//   add   notes played are added to the current chord; /chord/clear empties it
(
~chord = [];
~chordMode = \auto;
~held = Set[];

~setChord = { |pitches|
	~chord = pitches.collect(_.asInteger).asSet.asArray.sort;
	~sendChord.();
};

~setChordMode = { |mode|
	if([\auto, \add].includes(mode.asSymbol)) { ~chordMode = mode.asSymbol };
	~sendChord.();
};

~sendChord = { ~send.('/chord', ~chordMode, *~chord) };

~keyDown = { |note|
	if(~chordMode == \auto and: { ~held.isEmpty }) { ~chord = [] };
	~held.add(note);
	~setChord.(~chord ++ [note]);
};

~keyUp = { |note| ~held.remove(note) };

// Note for a generator's `source` choice, or nil (rest) when the chord is empty.
// step counts the generator's strikes, for arpeggio.
~chordNote = { |source, index, step|
	if(~chord.notEmpty) {
		switch(source.asSymbol,
			\index, { ~chord.wrapAt(index.asInteger) },
			\arpeggio, { ~chord.wrapAt(step) },
			\lowest, { ~chord.first },
			\highest, { ~chord.last },
		);
	};
};
)
