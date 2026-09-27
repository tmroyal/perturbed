// chord.scd — plays into a running test-mode brain (its input is IAC Bus 2) and checks the current
// chord (auto and arm modes, clear) and the generator source choices. Run via tests/run.sh.
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
	check.(chord == ['auto', 0], "starts empty in auto mode (%)".format(chord));

	// overlapping presses and releases are one chord, taken when the last key is released
	[64, 60].do { |n| out.noteOn(0, n, 90); 0.02.wait };
	out.noteOff(0, 60, 0); out.noteOn(0, 67, 90); 0.1.wait;
	check.(chord == ['auto', 0], "auto: unchanged while keys are down");
	[64, 67].do { |n| out.noteOff(0, n, 0) }; 0.1.wait;
	check.(chord == ['auto', 0, 60, 64, 67], "auto: chord taken on release (%)".format(chord));
	play.([62, 65, 69, 57], [62, 65, 69, 57]);
	check.(chord == ['auto', 0, 57, 62, 65, 69], "auto: next chord replaces (%)".format(chord));

	brain.sendMsg('/chord/mode', "arm");
	0.1.wait;
	play.([48, 52], [48, 52]);
	check.(chord == ['arm', 0, 57, 62, 65, 69], "arm: disarmed playing ignored");
	brain.sendMsg('/chord/arm', 1);
	0.1.wait;
	check.(chord[1] == 1, "arm: armed");
	play.([50, 53], [50, 53]);
	check.(chord == ['arm', 0, 50, 53], "arm: chord taken, disarmed (%)".format(chord));
	play.([60], [60]);
	check.(chord == ['arm', 0, 50, 53], "arm: next chord ignored");
	brain.sendMsg('/chord/set', 57, 62, 65, 69);
	0.1.wait;

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
	check.(chord == ['arm', 0], "clear");
	check.(run.(\lowest).isEmpty, "empty chord rests");

	brain.sendMsg('/gen/remove', genId);
	brain.sendMsg('/chord/mode', "auto");
	0.1.wait;
	if(fail) { "CHORD FAILED".postln; 1.exit } { "CHORD PASSED".postln; 0.exit };
}.play(SystemClock);
)
