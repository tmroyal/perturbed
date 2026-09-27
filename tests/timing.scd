// timing.scd — drives a running brain (started with PERFORMED_TEST=1) over OSC, captures its MIDI on the
// IAC buses, and checks onsets against the grid. Run via tests/run.sh.
//
// Scenario at 120 bpm (0.5 s/beat):
//   gen 1: note 60, 1/1 on dest 1 (port 1 ch 1)
//   gen 2: note 64, 3/4 on dest 2 (port 1 ch 2); after ~4 s switched to 1/3
// Checks: every onset lies on its grid (beat 0 = first onset), 3/4 and 1/1 coincide every 3 beats,
// every note-on is balanced by a note-off after stop, and repeated pitches never overlap.
(
var brain = NetAddr("127.0.0.1", 57120);
var log = List[];      // [time, \on|\off, chan, note]
var tol = 0.010;       // seconds; typical error is < 1 ms, occasional ~5 ms outliers are fine
var bps = 2;           // beats per second at 120 bpm
var changeAt;
var fail = false;
var check = { |ok, what| if(ok.not) { fail = true }; "%  %".format(if(ok) { "ok  " } { "FAIL" }, what).postln };

MIDIClient.init(verbose: false);
MIDIClient.sources.select { |e| e.device == "IAC Driver" and: { ["Bus 1", "Bus 2"].includesEqual(e.name) } }
	.do { |e| MIDIIn.connect(0, e) };
MIDIdef.noteOn(\on, { |vel, note, ch| log.add([Main.elapsedTime, \on, ch, note]) });
MIDIdef.noteOff(\off, { |vel, note, ch| log.add([Main.elapsedTime, \off, ch, note]) });

Routine {
	brain.sendMsg('/hello');
	brain.sendMsg('/dest/add', "test a", 1, 1, "none");
	brain.sendMsg('/dest/add', "test b", 1, 2, "none");
	brain.sendMsg('/gen/add', "fractionalRepeat");
	brain.sendMsg('/gen/add', "fractionalRepeat");
	brain.sendMsg('/transport/tempo', 120);
	0.3.wait;
	[[1, \dest, 1], [1, \note, 60], [2, \dest, 2], [2, \note, 64], [2, \num, 3], [2, \den, 4],
		[1, \active, 1], [2, \active, 1]].do { |m| brain.sendMsg('/gen/set', *m) };
	0.2.wait;
	brain.sendMsg('/transport/play', 1);
	4.1.wait;
	changeAt = Main.elapsedTime;
	brain.sendMsg('/gen/set', 2, \num, 1);
	brain.sendMsg('/gen/set', 2, \den, 3);
	3.wait;
	brain.sendMsg('/transport/play', 0);
	0.5.wait;

	{
		var ons = log.select { |e| e[1] == \on };
		var offs = log.select { |e| e[1] == \off };
		var t0 = ons.detect { |e| e[2] == 0 }[0];
		var beat = { |t| (t - t0) * bps };
		var resid = { |t, grid| var b = beat.(t); ((b / grid).round * grid - b).abs / bps };
		var a = ons.select { |e| e[2] == 0 }.collect(_[0]);
		var b = ons.select { |e| e[2] == 1 }.collect(_[0]);
		var bBefore = b.select { |t| t < (changeAt + 0.05) };
		var bAfter = b.select { |t| t >= (changeAt + 0.05) };
		var errA = a.collect { |t| resid.(t, 1) };
		var errB = bBefore.collect { |t| resid.(t, 0.75) } ++ bAfter.collect { |t| resid.(t, 1/3) };
		var alternates;
		var meets = a.select { |t| (beat.(t).round % 3) == 0 }
			.collect { |t| b.collect { |u| (u - t).abs }.minItem };

		"gen 1: % onsets, gen 2: % before change, % after".format(a.size, bBefore.size, bAfter.size).postln;
		check.(a.size >= 14 and: { bBefore.size >= 10 } and: { bAfter.size >= 15 }, "onset counts");
		check.(errA.maxItem < tol, "1/1 on grid (max err % ms)".format((errA.maxItem * 1000).round(0.1)));
		check.(errB.maxItem < tol, "3/4 then 1/3 on grid (max err % ms)".format((errB.maxItem * 1000).round(0.1)));
		if(errB.maxItem >= tol) {
			"  gen 2 onsets (beat): %".format((bBefore ++ bAfter).collect { |t| beat.(t).round(0.001) }).postln;
			"  change sent at beat %".format(beat.(changeAt).round(0.001)).postln;
		};
		check.(meets.size >= 4 and: { meets.maxItem < tol },
			"1/1 and 3/4 meet every 3 beats (% meetings, max gap % ms)".format(meets.size, (meets.maxItem * 1000).round(0.1)));
		check.(ons.size == offs.size, "note-ons balanced by note-offs (% / %)".format(ons.size, offs.size));
		// per channel and pitch, events must alternate on, off, on, ... (a late off would cut the next note)
		alternates = log.collect { |e| [e[2], e[3]] }.asSet.every { |key|
			log.select { |e| [e[2], e[3]] == key }.collect(_[1]).every { |kind, i| kind == [\on, \off].wrapAt(i) }
		};
		check.(alternates, "each note-off arrives before the next note-on of that pitch");
		if(alternates.not) { log.collect { |e| [e[2], e[3]] }.asSet.do { |key|
			"  ch % note %: %".format(key[0], key[1], log.select { |e| [e[2], e[3]] == key }
				.collect { |e| "%@%".format(e[1], ((e[0] - t0) * 1000).round(0.1)) }).postln;
		} };
		if(fail) { "TIMING FAILED".postln; 1.exit } { "TIMING PASSED".postln; 0.exit };
	}.try { |err| err.reportError; "TIMING FAILED".postln; 1.exit };
}.play(SystemClock);
)
