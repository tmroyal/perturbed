// basic — the basic generator: one note at a time, each lasting num/den beats and released by
// the next. The note comes from core/pitch.scd (a set note or the current chord), the velocity
// from core/velocity.scd. When the chord source is empty it rests (the previous note is released)
// and keeps its place on the grid.
//
// Onsets sit on multiples of num/den beats counted from transport start, so generators keep
// their ratios with each other (3/4 and 1/1 meet every 3 beats). Changing num/den restarts on
// the next point of the new grid.
(
params: ~pitchParams ++ [
	[\num, 1, \range, 1, 32],
	[\den, 1, \range, 1, 32],
] ++ ~velocityParams,

showWhen: ~pitchShow ++ ~velocityShow,

sections: [\source, \num, \velMode],

restartOn: [\num, \den],

run: { |g, p|
	var dur = p[\num].asInteger.max(1) / p[\den].asInteger.max(1);
	var k = (thisThread.beats / dur - 1e-9).ceil;  // next grid index at or after now
	var step = 0;
	loop {
		var note;
		(k * dur - thisThread.beats).max(0).wait;
		note = ~pitch.(p, step);
		if(note.notNil) { ~strike.(g, note, ~velocity.(g, p, k)) } { ~release.(g) };
		k = k + 1;
		step = step + 1;
	};
}
)
