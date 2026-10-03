// basic — the basic generator: one note at a time on a grid of num/den beats; each note is
// released by the next. Which grid steps play comes from core/rhythm.scd, the note from
// core/pitch.scd (a set note or the current chord), the velocity from core/velocity.scd. When the
// chord source is empty it rests (the previous note is released) and keeps its place on the grid.
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
	var step = 0;  // notes played, for arpeggio and permute
	~grid.(p[\num].asInteger.max(1) / p[\den].asInteger.max(1), { |k|
		var note;
		if(~rhythmGate.(p, k)) {
			note = ~pitch.(p, step);
			if(note.notNil) { ~strike.(g, note, ~velocity.(g, p, k)) } { ~release.(g) };
			step = step + 1;
		};
	});
}
)
