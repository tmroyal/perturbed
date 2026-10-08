// clock.scd — transport and clocks. The main clock is a LinkClock (Ableton Link), so tempo and
// bar phase are shared with Live: tempo changes go both ways. It runs all the time; play sets the
// grid origin to the start of the current Link bar (~beats counts from there), so generators line
// up with Live's bars and start at once. Test mode uses a fresh TempoClock per play instead, so
// tests never join the Link session.
// Extra clocks (B, C, ...) are TempoClocks started at the origin, so they share beat 0; a
// generator's `clock` param (0 = main) picks the one it runs on. Clock modes:
//   ratio   main tempo × num/den      (follows main)
//   factor  main tempo × factor       (follows main; e.g. 1.01 for slow phasing)
//   free    its own bpm
(
~bpm = 120;
~playing = false;
~clock = nil;      // the main clock while playing, else nil
~origin = 0;       // main-clock beat of the grid origin
~link = nil;
~quantum = 4;      // beats per Link bar
~clocks = ();

~linkInit = {
	if(~testMode.not) {
		~link = LinkClock(~bpm / 60).quantum_(~quantum).latency_(~config[\latency]);
		// tempo changed by another Link peer (Live): follow it
		~link.addDependant({ |clock, what|
			if(what == \tempo and: { (clock.tempo * 60 - ~bpm).abs > 0.001 }) {
				~bpm = clock.tempo * 60;
				~clocks.do { |c| ~applyClockTempo.(c) };
				~sendTransport.();
			};
		});
		"Link: % peers".format(~link.numPeers).postln;
	};
};

// Beats since the grid origin, for routines on any clock (extra clocks start at the origin).
~beats = { var b = thisThread.beats; if(thisThread.clock === ~clock) { b - ~origin } { b } };

// For a generator's run: calls fn.(seconds, beats) about `rate` times a second, forever: for things
// that move continuously (an lfo-like type calling ~drive), where ~grid is for things on the beat.
// seconds count from when it started; beats are ~beats (from the grid origin).
~tick = { |fn, rate = 50|
	var t0 = thisThread.seconds;
	loop { fn.(thisThread.seconds - t0, ~beats.()); (thisThread.clock.tempo / rate).wait };
};

// For a generator's run: calls fn.(k) on every grid point k · dur beats from the origin (the first
// at or after now), forever. Keeps generators in step with each other however they started.
// `dur` is a number, or a function read before every point (e.g. { p[\num] / p[\den] }): when its
// value changes, the grid moves to the next point of the new step, as a restart would, so it stays
// aligned with everything else.
~grid = { |dur, fn|
	var step = dur.value.max(0.001), k = (~beats.() / step - 1e-9).ceil.asInteger;
	loop {
		var d = dur.value.max(0.001);
		if(d != step) { step = d; k = (~beats.() / step - 1e-9).ceil.asInteger };
		(k * step - ~beats.()).max(0).wait;
		fn.(k);
		k = k + 1;
	};
};

~setPlaying = { |on|
	var t0;
	~gens.do { |g| ~stopGen.(g) };
	~clock !? { if(~clock === ~link) { ~clock.clear } { ~clock.stop } };
	~clock = nil;
	~clocks.do { |c| c[\clock] !? { c[\clock].stop }; c[\clock] = nil };
	~playing = on;
	if(on) {
		if(~link.notNil) {
			~clock = ~link;
			~origin = (~link.beats / ~quantum).floor * ~quantum;
			t0 = ~link.beats2secs(~origin);
		} {
			t0 = thisThread.seconds;
			~clock = TempoClock(~bpm / 60, 0, t0);
			~origin = 0;
		};
		~clocks.do { |c| c[\clock] = TempoClock(~clockTempo.(c) / 60, 0, t0) };
		Routine { loop { ~sendLate.('/beat', ~beats.().round.asInteger); 1.wait } }.play(~clock, 1);
		~gens.do { |g| ~startGen.(g) };
	};
	~sendTransport.();
};

~setTempo = { |bpm|
	~bpm = bpm.asFloat.clip(20, 400);
	~link !? { ~link.tempo = ~bpm / 60 };
	~clock !? { ~clock.tempo = ~bpm / 60 };
	~clocks.do { |c| ~applyClockTempo.(c) };
	~sendTransport.();
};

// Metric modulation: tempo × num/den. Beats carry on, so generators keep their grid.
~scaleTempo = { |num, den| ~setTempo.(~bpm * num.asFloat.max(1) / den.asFloat.max(1)) };

~sendTransport = { ~send.('/transport', ~playing.binaryValue, ~bpm) };

// --- extra clocks ---

// The param a clock-driven generator type adds to choose its clock (0 = main).
~clockParam = [\clock, 0, \clock];

~clockTempo = { |c|
	switch(c[\mode],
		\factor, { ~bpm * c[\factor] },
		\free, { c[\bpm] },
		{ ~bpm * c[\num] / c[\den] }).clip(1, 999);
};

~applyClockTempo = { |c|
	c[\clock] !? { c[\clock].tempo = ~clockTempo.(c) / 60 };
	~sendClock.(c);
};

// The TempoClock a generator runs on: its clock if that still exists, else main.
~clockOf = { |id| ~clocks[id.asInteger] !? { |c| c[\clock] } ?? { ~clock } };

~addClock = { |id|
	var c;
	id = ~newId.(\clock, id);
	c = (id: id, name: (65 + id).asAscii.asString, mode: \ratio, num: 1, den: 1, factor: 1.0, bpm: ~bpm);
	~clocks[id] = c;
	// added while playing: start at the beat it would be on had it run since play
	if(~playing) { c[\clock] = TempoClock(~clockTempo.(c) / 60, (~clock.beats - ~origin) * ~clockTempo.(c) / ~bpm) };
	~sendClock.(c);
	c;
};

~setClock = { |c, key, val|
	switch(key.asSymbol,
		\mode, { if([\ratio, \factor, \free].includes(val.asSymbol)) { c[\mode] = val.asSymbol } },
		\num, { c[\num] = val.asInteger.clip(1, 32) },
		\den, { c[\den] = val.asInteger.clip(1, 32) },
		\factor, { c[\factor] = val.asFloat.clip(0.01, 16) },
		\bpm, { c[\bpm] = val.asFloat.clip(1, 999) });
	~applyClockTempo.(c);
};

~removeClock = { |id|
	~clocks.removeAt(id) !? { |c|
		c[\clock] !? { c[\clock].stop };
		~gens.do { |g| if(g[\p][\clock] == id) { ~setGen.(g, \clock, 0) } };  // back to main
		~send.('/clock/removed', id);
	};
};

~sendClock = { |c|
	~send.('/clock', c[\id], c[\name], c[\mode], c[\num], c[\den], c[\factor], c[\bpm], ~clockTempo.(c));
};
)
