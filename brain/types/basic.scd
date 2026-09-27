// basic — the basic generator: one note at a time on a grid of num/den beats; each note is
// released by the next. Which grid steps play comes from core/rhythm.scd, the note from
// core/pitch.scd (a set note or the current chord), the velocity from core/velocity.scd. When the
// chord source is empty it rests (the previous note is released) and keeps its place on the grid.
//
// Onsets sit on multiples of num/den beats counted from transport start, so generators keep
// their ratios with each other (3/4 and 1/1 meet every 3 beats). Changing num/den restarts on
// the next point of the new grid.
(
params: ~pitchParams ++ [
	[\num, 1, \range, 1, 32],
	[\den, 1, \range, 1, 32],
] ++ ~rhythmParams ++ ~velocityParams,

showWhen: ~pitchShow ++ ~rhythmShow ++ ~velocityShow,

sections: [\source, \num, \velMode],

restartOn: [\num, \den],

run: { |g, p|
	var dur = p[\num].asInteger.max(1) / p[\den].asInteger.max(1);
	var k = (thisThread.beats / dur - 1e-9).ceil.asInteger;  // next grid index at or after now
	var step = 0;  // notes played, for arpeggio and permute
	loop {
		var note;
		(k * dur - thisThread.beats).max(0).wait;
		if(~rhythmGate.(p, k)) {
			note = ~pitch.(p, step);
			if(note.notNil) { ~strike.(g, note, ~velocity.(g, p, k)) } { ~release.(g) };
			step = step + 1;
		};
		k = k + 1;
	};
}
)
