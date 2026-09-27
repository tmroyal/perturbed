// clock.scd — transport. A fresh TempoClock per play, so beat 0 is the grid origin.
(
~bpm = 120;
~playing = false;
~clock = nil;

~setPlaying = { |on|
	~gens.do { |g| ~stopGen.(g) };
	~clock !? { ~clock.stop };
	~clock = nil;
	~playing = on;
	if(on) {
		~clock = TempoClock(~bpm / 60);
		Routine { loop { ~sendLate.('/beat', thisThread.beats.round.asInteger); 1.wait } }.play(~clock);
		~gens.do { |g| ~startGen.(g) };
	};
	~sendTransport.();
};

~setTempo = { |bpm|
	~bpm = bpm.asFloat.clip(20, 400);
	~clock !? { ~clock.tempo = ~bpm / 60 };
	~sendTransport.();
};

~sendTransport = { ~send.('/transport', ~playing.binaryValue, ~bpm) };
)
