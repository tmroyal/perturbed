// sources.scd — named slots of pitches that generators read from, filled from the keyboard.
//
// Capture: arm a slot, play a chord. Every note pressed until all keys are up again is stored,
// sorted low to high, and the slot disarms. Only one slot is armed at a time.
(
~sources = ();
~config[\slots].do { |name| ~sources[name.asSymbol] = (name: name.asSymbol, pitches: [], armed: false) };

~held = Set[];
~gesture = Set[];

~setSource = { |slot, pitches|
	~sources[slot.asSymbol] !? { |s|
		s[\pitches] = pitches.collect(_.asInteger).asSet.asArray.sort;
		~sendSource.(s);
	};
};

~armSource = { |slot, on|
	~sources[slot.asSymbol] !? { |s|
		~sources.do { |o| if(o[\armed] and: { o !== s }) { o[\armed] = false; ~sendSource.(o) } };
		s[\armed] = on;
		~sendSource.(s);
	};
};

~sendSource = { |s| ~send.('/source', s[\name], s[\armed].binaryValue, *s[\pitches]) };

// Pitch at index (0 = lowest, negative counts from the top, wraps), or nil if the slot is empty.
~sourcePitch = { |slot, index|
	~sources[slot.asSymbol] !? { |s| if(s[\pitches].notEmpty) { s[\pitches].wrapAt(index.asInteger) } };
};

~keyDown = { |note|
	~held.add(note);
	~gesture.add(note);
};

~keyUp = { |note|
	~held.remove(note);
	if(~held.isEmpty and: { ~gesture.notEmpty }) {
		~sources.detect(_[\armed]) !? { |s|
			s[\armed] = false;
			~setSource.(s[\name], ~gesture.asArray);
		};
		~gesture = Set[];
	};
};
)
