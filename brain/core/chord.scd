// chord.scd — the current chord, played on the keyboard; generators read it.
//
// A chord played (every note pressed until all keys are up again) replaces the current chord
// when the last key is released, if the brain is armed. The chord stays until replaced or cleared.
//   auto  always armed
//   arm   /chord/arm arms for one chord, then disarms; playing while disarmed changes nothing
(
~chord = [];
~chordMode = \auto;
~armed = false;
~held = Set[];
~gesture = Set[];

~setChord = { |pitches|
	~chord = pitches.collect(_.asInteger).asSet.asArray.sort;
	~sendChord.();
};

~setChordMode = { |mode|
	if([\auto, \arm].includes(mode.asSymbol)) { ~chordMode = mode.asSymbol };
	~armed = false;
	~sendChord.();
};

~arm = { |on|
	~armed = on;
	~sendChord.();
};

~sendChord = { ~send.('/chord', ~chordMode, ~armed.binaryValue, *~chord) };

~keyDown = { |note|
	~held.add(note);
	~gesture.add(note);
};

~keyUp = { |note|
	~held.remove(note);
	if(~held.isEmpty and: { ~gesture.notEmpty }) {
		if(~chordMode == \auto or: { ~armed }) {
			~armed = false;
			~setChord.(~gesture.asArray);
		};
		~gesture = Set[];
	};
};

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
