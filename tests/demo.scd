// demo.scd — plays ~10 s on a running brain's default destinations (Piano 1, Piano 2) so you can
// hear REAPER respond: C4 in quarter notes on Piano 1, E4/G4 in 3/4 and 2/3 on Piano 2.
// Run in a second terminal while the brain runs:  sclang tests/demo.scd
(
var brain = NetAddr("127.0.0.1", 57120);
var ids = List[];
OSCdef(\demoGen, { |msg| if(ids.includes(msg[1]).not) { ids.add(msg[1]) } }, '/gen');
Routine {
	brain.sendMsg('/hello');
	0.5.wait;
	ids.clear;
	3.do { brain.sendMsg('/gen/add', "fractionalRepeat") };
	0.3.wait;
	[[1, 60, 1, 1], [2, 64, 3, 4], [2, 67, 2, 3]].do { |spec, i|
		var id = ids[i];
		brain.sendMsg('/gen/set', id, \dest, spec[0]);
		brain.sendMsg('/gen/set', id, \note, spec[1]);
		brain.sendMsg('/gen/set', id, \num, spec[2]);
		brain.sendMsg('/gen/set', id, \den, spec[3]);
		brain.sendMsg('/gen/set', id, \active, 1);
	};
	brain.sendMsg('/transport/tempo', 100);
	brain.sendMsg('/transport/play', 1);
	10.wait;
	brain.sendMsg('/transport/play', 0);
	ids.do { |id| brain.sendMsg('/gen/remove', id) };
	0.3.wait;
	0.exit;
}.play(SystemClock);
)
