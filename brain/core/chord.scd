// chord.scd — the current chord, played on the keyboard; generators read it (core/pitch.scd).
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

// A key pressed while a generator param is learning sets that param instead of joining a chord.
~keyDown = { |note|
	~held.add(note);
	if(~learning.notNil) { ~learnNote.(note) } { ~gesture.add(note) };
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
)
