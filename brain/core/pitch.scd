// pitch.scd — where a generator's note comes from; shared by generator types. A type adds
// ~pitchParams to its params (with ~pitchShow and ~pitchLabels), then calls ~pitch.(p, step) for each
// note (step counts the generator's notes since it started). nil means rest: the chord is empty.
// The chord is the one its `chord` setting picks (a chord strip; 0 = the main chord: core/chord.scd).
//   note      the `note` param
//   index     chord[index], wrapping; -1 = highest
//   lowest, highest
//   arpeggio  one chord note per step: direction up, down or up-down
//   permute   one note per step through chord.permute(n); n starts at `permutation` and moves
//             ahead by `advance` after each pass through the chord
(
~pitchParams = [
	[\source, "note", \choice, "note", "index", "lowest", "highest", "arpeggio", "permute"],
	[\note, 60, \note],
	[\index, 0, \range, -16, 16],
	[\direction, "up", \choice, "up", "down", "up-down"],
	[\permutation, 0, \range, 0, 719],
	[\advance, 1, \range, 0, 32],
	~chordParam,
];

~pitchShow = (
	note: [\source, "note"],
	index: [\source, "index"],
	direction: [\source, "arpeggio"],
	permutation: [\source, "permute"],
	advance: [\source, "permute"],
	chord: [\source, "index", "lowest", "highest", "arpeggio", "permute"],
);

~pitchLabels = (source: "from", index: "chord note", permutation: "start at", advance: "advance by");

~pitch = { |p, step|
	var c = ~chordFor.(p), n = c.size, source = p[\source].asSymbol;
	case
	{ source == \note } { p[\note].asInteger.clip(0, 127) }
	{ n == 0 } { nil }
	{
		switch(source,
			\index, { c.wrapAt(p[\index].asInteger) },
			\lowest, { c.first },
			\highest, { c.last },
			\arpeggio, {
				switch(p[\direction].asSymbol,
					\down, { c.reverse.wrapAt(step) },
					'up-down', { c.foldAt(step) },
					{ c.wrapAt(step) });
			},
			\permute, { c.permute(p[\permutation].asInteger + ((step div: n) * p[\advance].asInteger)).wrapAt(step) },
		);
	};
};
)
