// clock.scd — transport and clocks. The main clock is a fresh TempoClock per play, so beat 0 is
// the grid origin. Extra clocks (B, C, ...) are TempoClocks started at the same instant, so they
// share beat 0; a generator's `clock` param (0 = main) picks the one it runs on. Clock modes:
//   ratio   main tempo × num/den      (follows main)
//   factor  main tempo × factor       (follows main; e.g. 1.01 for slow phasing)
//   free    its own bpm
(
~bpm = 120;
~playing = false;
~clock = nil;
~clocks = ();
~nextClockId = 1;

~setPlaying = { |on|
	var t0;
	~gens.do { |g| ~stopGen.(g) };
	~clock !? { ~clock.stop };
	~clock = nil;
	~clocks.do { |c| c[\clock] !? { c[\clock].stop }; c[\clock] = nil };
	~playing = on;
	if(on) {
		t0 = thisThread.seconds;
		~clock = TempoClock(~bpm / 60, 0, t0);
		~clocks.do { |c| c[\clock] = TempoClock(~clockTempo.(c) / 60, 0, t0) };
		Routine { loop { ~sendLate.('/beat', thisThread.beats.round.asInteger); 1.wait } }.play(~clock);
		~gens.do { |g| ~startGen.(g) };
	};
	~sendTransport.();
};

~setTempo = { |bpm|
	~bpm = bpm.asFloat.clip(20, 400);
	~clock !? { ~clock.tempo = ~bpm / 60 };
	~clocks.do { |c| ~applyClockTempo.(c) };
	~sendTransport.();
};

// Metric modulation: tempo × num/den. Beats carry on, so generators keep their grid.
~scaleTempo = { |num, den| ~setTempo.(~bpm * num.asFloat.max(1) / den.asFloat.max(1)) };

~sendTransport = { ~send.('/transport', ~playing.binaryValue, ~bpm) };

// --- extra clocks ---

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
	id = id ?? { ~nextClockId };
	~nextClockId = max(~nextClockId, id + 1);
	c = (id: id, name: (65 + id).asAscii.asString, mode: \ratio, num: 1, den: 1, factor: 1.0, bpm: ~bpm);
	~clocks[id] = c;
	// added while playing: start at the beat it would be on had it run since play
	if(~playing) { c[\clock] = TempoClock(~clockTempo.(c) / 60, ~clock.beats * ~clockTempo.(c) / ~bpm) };
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
