// basic — the basic generator: one note at a time on a grid of num/den beats; each note is
// released by the next, or after its own length (a percentage of the grid step). Which grid steps play comes from core/rhythm.scd, the note from
// core/pitch.scd (a set note or the current chord), the velocity from core/velocity.scd. When the
// chord source is empty it rests (the previous note is released) and keeps its place on the grid.
// `chance` drops notes without disturbing the pattern (an arpeggio keeps its place).
//
// Beats are those of its clock (main by default). Onsets sit on multiples of num/den beats counted
// from transport start, so generators keep their ratios with each other (3/4 and 1/1 meet every
// 3 beats). Changing clock or num/den restarts on the next point of the new grid.
(
params: ~pitchParams ++ ~rhythmParams ++ ~velocityParams ++ [~clockParam],
showWhen: ~pitchShow ++ ~rhythmShow ++ ~velocityShow,
labels: ~pitchLabels ++ ~rhythmLabels ++ ~velocityLabels,
sections: (source: "Pitch", num: "Rhythm", velMode: "Velocity", clock: "Clock"),
restartOn: [\clock, \num, \den],

run: { |g, p|
	var dur = p[\num].asInteger.max(1) / p[\den].asInteger.max(1);
	var step = 0;  // the rhythm's notes so far, for arpeggio and permute
	~grid.(dur, { |k|
		var note;
		if(~rhythmGate.(p, k)) {
			note = ~pitch.(p, step);
			step = step + 1;
			case
			{ note.isNil } { ~release.(g) }
			{ ~rhythmChance.(p) } { ~strikeFor.(g, note, ~velocity.(g, p, k), ~noteBeats.(p, dur)) };
		};
	});
}
)
