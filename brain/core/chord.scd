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

// Note for a generator's `source` from the current chord, or nil (rest) when it is empty.
// p holds the source's params; step counts the generator's strikes (for arpeggio and permute).
//   index     chord[index], wrapping; -1 = highest
//   lowest, highest
//   arpeggio  one chord note per strike: direction up, down or updown
//   permute   one note per strike through chord.permute(n); n starts at `permutation` and moves
//             ahead by `advance` after each pass through the chord
~chordNote = { |p, step|
	var c = ~chord, n = ~chord.size;
	if(n > 0) {
		switch(p[\source].asSymbol,
			\index, { c.wrapAt(p[\index].asInteger) },
			\lowest, { c.first },
			\highest, { c.last },
			\arpeggio, {
				switch(p[\direction].asSymbol,
					\down, { c.reverse.wrapAt(step) },
					\updown, { c.foldAt(step) },
					{ c.wrapAt(step) });
			},
			\permute, {
				c.permute(p[\permutation].asInteger + (step div: n * p[\advance].asInteger)).wrapAt(step);
			},
		);
	};
};
)
