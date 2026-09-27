// capture.scd — plays a chord into a running test-mode brain (its input is IAC Bus 2) and checks
// that an armed slot captures it and a generator reads the slot. Run via tests/run.sh.
(
var brain = NetAddr("127.0.0.1", 57120);
var out, source, genId, notes = List[];
var fail = false;
var check = { |ok, what| if(ok.not) { fail = true }; "%  %".format(if(ok) { "ok  " } { "FAIL" }, what).postln };

MIDIClient.init(verbose: false);
out = MIDIOut.newByName("IAC Driver", "Bus 2");
out.latency = 0;
OSCdef(\source, { |msg| if(msg[1] == 'A') { source = msg[2..] } }, '/source');
OSCdef(\gen, { |msg| genId = msg[1] }, '/gen');
OSCdef(\note, { |msg| if(msg[1] == genId) { notes.add(msg[2]) } }, '/note');

Routine {
	brain.sendMsg('/hello');
	0.3.wait;
	brain.sendMsg('/source/arm', "A", 1);
	0.1.wait;
	check.(source == [1], "arm A");
	// a chord with overlapping releases: all four notes count
	[64, 60, 67].do { |n| out.noteOn(0, n, 90); 0.02.wait };
	out.noteOff(0, 60, 0);
	out.noteOn(0, 72, 90);
	0.05.wait;
	[64, 67, 72].do { |n| out.noteOff(0, n, 0); 0.02.wait };
	0.1.wait;
	check.(source == [0, 60, 64, 67, 72], "chord captured into A, disarmed (%)".format(source));

	// not armed: playing doesn't change the slot
	out.noteOn(0, 50, 90); 0.05.wait; out.noteOff(0, 50, 0); 0.1.wait;
	check.(source == [0, 60, 64, 67, 72], "unarmed playing ignored");

	brain.sendMsg('/gen/add', "fractionalRepeat");
	0.1.wait;
	[[\source, "A"], [\index, -1], [\num, 1], [\den, 4], [\active, 1]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	brain.sendMsg('/transport/play', 1);
	0.4.wait;
	brain.sendMsg('/gen/set', genId, \index, 1);
	0.4.wait;
	brain.sendMsg('/transport/play', 0);
	brain.sendMsg('/gen/remove', genId);
	0.1.wait;
	check.(notes.includes(72) and: { notes.includes(64) } and: { notes.every([64, 72].includes(_)) },
		"generator plays A[-1] then A[1] (%)".format(notes.asArray.asSet.asArray.sort));

	brain.sendMsg('/source/clear', "A");
	0.1.wait;
	check.(source == [0], "clear A");
	if(fail) { "CAPTURE FAILED".postln; 1.exit } { "CAPTURE PASSED".postln; 0.exit };
}.play(SystemClock);
)
