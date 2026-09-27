// repeat — plays one note over and over; each note lasts num/den beats and is released by the next.
//
// Onsets sit on a grid of multiples of num/den beats counted from transport start, so generators
// stay in their ratios with each other. Changing num/den restarts on the next point of the new grid.
//
// A type file evaluates to an Event:
//   params:    defaults; the app sends /gen/set for each
//   restartOn: params whose change restarts `run`
//   run:       { |g, p| } routine body, on the transport clock (waits are in beats)
(
params: (note: 60, velocity: 80, num: 1, den: 1),

restartOn: [\num, \den],

run: { |g, p|
	var dur = p[\num].max(1) / p[\den].max(1);
	var k = (thisThread.beats / dur - 1e-9).ceil;  // next grid index at or after now
	loop {
		(k * dur - thisThread.beats).max(0).wait;
		~strike.(g, p[\note].asInteger.clip(0, 127), p[\velocity].asInteger.clip(1, 127));
		k = k + 1;
	};
}
)
