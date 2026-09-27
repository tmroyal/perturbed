// fractionalRepeat — plays one note over and over; each note lasts num/den beats and is
// released by the next. `source` picks the note: `note`, or one of the current-chord sources in
// core/chord.scd. With an empty chord, chord sources rest (the previous note is released) and
// keep their place on the grid.
//
// Onsets sit on multiples of num/den beats counted from transport start, so generators keep
// their ratios with each other (3/4 and 1/1 meet every 3 beats). Changing num/den restarts on
// the next point of the new grid.
(
params: [
	[\source, "note", \choice, "note", "index", "lowest", "highest", "arpeggio", "permute"],
	[\note, 60, \note],
	[\index, 0, \range, -16, 16],
	[\direction, "up", \choice, "up", "down", "updown"],
	[\permutation, 0, \range, 0, 719],
	[\advance, 1, \range, 0, 32],
	[\velocity, 80, \range, 1, 127],
	[\num, 1, \range, 1, 32],
	[\den, 1, \range, 1, 32],
],

// params the surface shows only for some values of another param
showWhen: (
	note: [\source, "note"],
	index: [\source, "index"],
	direction: [\source, "arpeggio"],
	permutation: [\source, "permute"],
	advance: [\source, "permute"],
),

restartOn: [\num, \den],

run: { |g, p|
	var dur = p[\num].asInteger.max(1) / p[\den].asInteger.max(1);
	var k = (thisThread.beats / dur - 1e-9).ceil;  // next grid index at or after now
	var step = 0;
	loop {
		var note;
		(k * dur - thisThread.beats).max(0).wait;
		note = if(p[\source].asSymbol == \note) { p[\note].asInteger } { ~chordNote.(p, step) };
		if(note.notNil) { ~strike.(g, note.clip(0, 127), p[\velocity].asInteger.clip(1, 127)) } { ~release.(g) };
		k = k + 1;
		step = step + 1;
	};
}
)
