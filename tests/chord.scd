// chord.scd — plays into a running test-mode brain (its input is IAC Bus 2) and checks the current
// chord (auto and add modes, clear) and the generator source choices. Run via tests/run.sh.
(
var brain = NetAddr("127.0.0.1", "PERFORMED_PORT".getenv.asInteger);
var out, chord, genId, notes = List[];
var fail = false;
var check = { |ok, what| if(ok.not) { fail = true }; "%  %".format(if(ok) { "ok  " } { "FAIL" }, what).postln };
var play = { |ons, offs| ons.do { |n| out.noteOn(0, n, 90); 0.02.wait }; offs.do { |n| out.noteOff(0, n, 0); 0.02.wait }; 0.1.wait };
// runs the generator with a source for `beats` quarter notes (1/4 beat each) and returns the pitches
var run = { |source, index = 0, n = 6|
	notes.clear;
	[[\source, source], [\index, index]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	brain.sendMsg('/transport/play', 1);
	(n * 0.125 - 0.06).wait;  // 120 bpm, 1/4 beat = 0.125 s
	brain.sendMsg('/transport/play', 0);
	0.1.wait;
	notes.asArray;
};

MIDIClient.init(verbose: false);
out = MIDIOut.newByName("IAC Driver", "Bus 2");
out.latency = 0;
OSCdef(\chord, { |msg| chord = msg[1..] }, '/chord');
OSCdef(\gen, { |msg| genId = msg[1] }, '/gen');
OSCdef(\note, { |msg| if(msg[1] == genId) { notes.add(msg[2]) } }, '/note');

Routine {
	brain.sendMsg('/hello');
	brain.sendMsg('/transport/tempo', 120);
	0.3.wait;
	check.(chord == ['auto'], "starts empty in auto mode (%)".format(chord));

	// overlapping presses and releases are one chord
	play.([64, 60], [60]); play.([67], [64, 67]);
	check.(chord == ['auto', 60, 64, 67], "auto: chord latched (%)".format(chord));
	play.([62, 65], [62, 65]);
	check.(chord == ['auto', 62, 65], "auto: new chord replaces (%)".format(chord));

	brain.sendMsg('/chord/mode', "add");
	0.1.wait;
	play.([69], [69]); play.([57], [57]);
	check.(chord == ['add', 57, 62, 65, 69], "add: notes accumulate (%)".format(chord));

	brain.sendMsg('/gen/add', "fractionalRepeat");
	0.1.wait;
	[[\num, 1], [\den, 4], [\note, 48], [\active, 1]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	check.(run.(\preset).every(_ == 48), "preset plays its note");
	check.(run.(\index, -1).every(_ == 69), "index -1 plays the highest");
	check.(run.(\index, 5).every(_ == 62), "index wraps (5 of 4 → 1)");
	check.(run.(\lowest).every(_ == 57), "lowest");
	check.(run.(\highest).every(_ == 69), "highest");
	check.(run.(\arpeggio) == [57, 62, 65, 69, 57, 62], "arpeggio steps through the chord (%)".format(notes));

	brain.sendMsg('/chord/clear');
	0.1.wait;
	check.(chord == ['add'], "clear");
	check.(run.(\lowest).isEmpty, "empty chord rests");

	brain.sendMsg('/gen/remove', genId);
	brain.sendMsg('/chord/mode', "auto");
	0.1.wait;
	if(fail) { "CHORD FAILED".postln; 1.exit } { "CHORD PASSED".postln; 0.exit };
}.play(SystemClock);
)
