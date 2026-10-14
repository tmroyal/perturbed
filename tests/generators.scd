// generators.scd — plays into a running test-mode brain (its input is IAC Bus 2) and checks the
// current chord (auto and arm modes, clear), the basic generator (note sources, Set, rhythm and
// velocity modes), passthrough (transpose, zone), groups, knobs driving globals, and control
// changes (/cc, the lfo type) on the test control bus (Bus 2).
// Run via tests/run.sh.
(
var brain = NetAddr("127.0.0.1", "PERFORMED_PORT".getenv.asInteger);
var v;
var out, chord, genId, notes = List[], vels = List[], times = List[];
var fail = false;
var check = { |ok, what| if(ok.not) { fail = true }; "%  %".format(if(ok) { "ok  " } { "FAIL" }, what).postln };
var play = { |ons, offs| ons.do { |n| out.noteOn(0, n, 90); 0.02.wait }; offs.do { |n| out.noteOff(0, n, 0); 0.02.wait }; 0.1.wait };
// runs the generator with a source for `beats` quarter notes (1/4 beat each) and returns the pitches
var run = { |source, index = 0, n = 6|
	notes.clear;
	[[\source, source], [\index, index]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	brain.sendMsg('/transport/play', 1);
	(n * ~step - 0.03).wait;
	brain.sendMsg('/transport/play', 0);
	0.1.wait;
	notes.asArray;
};

~step = 0.0625;  // seconds per 1/4-beat grid step at the test tempo, 240 bpm

MIDIClient.init(verbose: false);
out = MIDIOut.newByName("IAC Driver", "Bus 2");
out.latency = 0;
OSCdef(\chord, { |msg| chord = msg[1..] }, '/chord');
OSCdef(\gen, { |msg| genId = msg[1] }, '/gen');
OSCdef(\dest, { |msg| ~destId = msg[1] }, '/dest');
OSCdef(\clock, { |msg| ~clockId = msg[1] }, '/clock');
~midi = List[];
MIDIClient.sources.select { |e| e.device == "IAC Driver" and: { e.name == "Bus 1" } }.do { |e| MIDIIn.connect(0, e) };
// control changes from the test brain arrive on Bus 2: [channel (0-based), cc, value]
~ccs = List[];
MIDIClient.sources.select { |e| e.device == "IAC Driver" and: { e.name == "Bus 2" } }.do { |e| MIDIIn.connect(0, e) };
MIDIdef.cc(\ccs, { |val, num, ch| ~ccs.add([ch, num, val]) });
MIDIdef.noteOn(\passOn, { |vel, note, ch| if(ch == 2) { ~midi.add([\on, note]) } });
MIDIdef.noteOff(\passOff, { |vel, note, ch| if(ch == 2) { ~midi.add([\off, note]) } });
// the same notes with their times, for note lengths: [time, \on|\off]
~timed = List[];
MIDIdef.noteOn(\timedOn, { |vel, note, ch| if(ch == 2) { ~timed.add([Main.elapsedTime, \on]) } });
MIDIdef.noteOff(\timedOff, { |vel, note, ch| if(ch == 2) { ~timed.add([Main.elapsedTime, \off]) } });
OSCdef(\take, { |msg| if(msg[1] == 1 and: { msg[2] == 'take' }) { ~take = msg[3] } }, '/gen/param');  // the chord strip (generator 1)
OSCdef(\param, { |msg| if(msg[1] == genId and: { msg[2] == 'note' }) { ~noteParam = msg[3] } }, '/gen/param');
OSCdef(\note, { |msg| if(msg[1] == genId) { notes.add(msg[2]); vels.add(msg[3]); times.add(Main.elapsedTime) } }, '/note');
// plays n quarter-beat grid steps with the given params; returns the grid steps that played.
// /note arrives `latency` after the grid time; play starts at beat 0 when the brain gets it.
~hits = { |pairs, n|
	var t0;
	times.clear;
	pairs.do { |m| brain.sendMsg('/gen/set', genId, *m) };
	0.05.wait;
	t0 = Main.elapsedTime;
	brain.sendMsg('/transport/play', 1);
	(n * ~step - 0.03).wait;
	brain.sendMsg('/transport/play', 0);
	0.1.wait;
	times.collect { |t| ((t - t0 - 0.05) / ~step).round.asInteger }.asArray;
};
// plays n quarter-beat notes with the given params; returns the velocities
~vel = { |pairs, n = 8|
	vels.clear;
	pairs.do { |m| brain.sendMsg('/gen/set', genId, *m) };
	brain.sendMsg('/transport/play', 1);
	(n * ~step - 0.03).wait;
	brain.sendMsg('/transport/play', 0);
	0.1.wait;
	vels.asArray;
};

Routine {
	brain.sendMsg('/hello');
	brain.sendMsg('/transport/tempo', 240);
	0.3.wait;
	check.(chord == [] and: { ~take == 'every chord' }, "starts with a chord strip: empty, taking every chord (% %)".format(chord, ~take));

	// overlapping presses and releases are one chord, taken when the last key is released
	[64, 60].do { |n| out.noteOn(0, n, 90); 0.02.wait };
	out.noteOff(0, 60, 0); out.noteOn(0, 67, 90); 0.1.wait;
	check.(chord == [], "auto: unchanged while keys are down");
	[64, 67].do { |n| out.noteOff(0, n, 0) }; 0.1.wait;
	check.(chord == [60, 64, 67], "auto: chord taken on release (%)".format(chord));
	play.([62, 65, 69, 57], [62, 65, 69, 57]);
	check.(chord == [57, 62, 65, 69], "auto: next chord replaces (%)".format(chord));

	brain.sendMsg('/gen/set', 1, \take, "hold");
	0.1.wait;
	play.([48, 52], [48, 52]);
	check.(chord == [57, 62, 65, 69], "hold: playing ignored");
	brain.sendMsg('/gen/do', 1, \Arm);
	0.1.wait;
	check.(~take == 'next chord', "Arm: takes the next chord");
	play.([50, 53], [50, 53]);
	check.(chord == [50, 53] and: { ~take == 'hold' }, "arm: chord taken, then it holds (% %)".format(chord, ~take));
	play.([60], [60]);
	check.(chord == [50, 53], "arm: next chord ignored");

	// as played: the chord builds as keys go down, until the last one comes up
	[[\take, "every chord"], [\build, "as played"]].do { |m| brain.sendMsg('/gen/set', 1, *m) };
	0.1.wait;
	out.noteOn(0, 60, 90); 0.1.wait;
	check.(chord == [60], "as played: the first key starts a new chord (%)".format(chord));
	out.noteOn(0, 64, 90); 0.1.wait;
	check.(chord == [60, 64], "as played: each key adds (%)".format(chord));
	out.noteOff(0, 60, 0); out.noteOn(0, 67, 90); 0.1.wait;
	check.(chord == [60, 64, 67], "as played: still the same chord while a key is down (%)".format(chord));
	[64, 67].do { |n| out.noteOff(0, n, 0) }; 0.1.wait;
	check.(chord == [60, 64, 67], "as played: kept when the keys come up");
	brain.sendMsg('/gen/set', 1, \octave, 1); 0.1.wait;
	check.(chord == [72, 76, 79], "transposed: generators hear it an octave up (%)".format(chord));
	[[\octave, 0], [\lo, 60], [\build, "on release"]].do { |m| brain.sendMsg('/gen/set', 1, *m) };
	0.1.wait;
	play.([48, 62], [48, 62]);
	check.(chord == [62], "a key range: keys below it aren't heard (%)".format(chord));
	brain.sendMsg('/gen/set', 1, \active, 0); 0.1.wait;
	play.([65], [65]);
	check.(chord == [62], "off: it keeps what it has");
	[[\active, 1], [\lo, 0], [\take, "hold"]].do { |m| brain.sendMsg('/gen/set', 1, *m) };
	brain.sendMsg('/chord/set', 57, 62, 65, 69);
	0.1.wait;

	brain.sendMsg('/gen/add', "basic");
	0.1.wait;
	[[\num, 1], [\den, 4], [\note, 48], [\active, 1]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	check.(run.(\note).every(_ == 48), "note plays its note");
	brain.sendMsg('/gen/set', 1, \take, "every chord");  // where a key would otherwise replace the chord
	brain.sendMsg('/gen/learn', genId, \note, 1);
	0.1.wait;
	play.([61], [61]);
	check.(~noteParam == 61 and: { chord == [57, 62, 65, 69] }, "Set: next key sets the note, chord untouched");
	brain.sendMsg('/gen/set', 1, \take, "hold");
	brain.sendMsg('/gen/set', genId, \note, 48);
	check.(run.(\index, -1).every(_ == 69), "index -1 plays the highest");
	check.(run.(\index, 5).every(_ == 62), "index wraps (5 of 4 → 1)");
	check.(run.(\lowest).every(_ == 57), "lowest");
	check.(run.(\highest).every(_ == 69), "highest");
	// a second chord strip: a generator reads the one it picks; gone, it's back on the main chord
	~basic = genId;
	brain.sendMsg('/gen/add', "chord");
	0.1.wait;
	~c2 = genId; genId = ~basic;
	brain.sendMsg('/gen/set', ~c2, \notes, "C2 G2");
	brain.sendMsg('/gen/set', genId, \chord, ~c2);
	check.(run.(\lowest).every(_ == 36), "a generator reads the chord strip it picks (%)".format(notes));
	brain.sendMsg('/gen/set', ~c2, \semitone, 2);
	check.(run.(\lowest).every(_ == 38), "and hears its transposition");
	check.(chord == [57, 62, 65, 69], "the main chord is still the first strip's");
	brain.sendMsg('/gen/remove', ~c2);
	0.1.wait;
	genId = ~basic;
	check.(run.(\lowest).every(_ == 57), "its chord strip removed: back to the main chord");
	brain.sendMsg('/gen/set', genId, \chord, 0);
	check.(run.(\arpeggio) == [57, 62, 65, 69, 57, 62], "arpeggio up (%)".format(notes));
	brain.sendMsg('/gen/set', genId, \direction, "down");
	check.(run.(\arpeggio) == [69, 65, 62, 57, 69, 65], "arpeggio down (%)".format(notes));
	brain.sendMsg('/gen/set', genId, \direction, "up-down");
	check.(run.(\arpeggio, 0, 8) == [57, 62, 65, 69, 65, 62, 57, 62], "arpeggio updown (%)".format(notes));
	brain.sendMsg('/gen/set', genId, \permutation, 5);
	brain.sendMsg('/gen/set', genId, \advance, 2);
	check.(run.(\permute, 0, 12) == ([57, 62, 65, 69].permute(5) ++ [57, 62, 65, 69].permute(7) ++ [57, 62, 65, 69].permute(9)),
		"permute: permutation 5, advancing by 2 each pass (%)".format(notes));

	brain.sendMsg('/gen/set', genId, \source, "note");
	check.(~vel.([[\velMode, "set"], [\velocity, 77]]).every(_ == 77), "velocity set");
	v = ~vel.([[\velMode, "accent"], [\velocity, 50], [\accent, 120], [\every, 3]]);
	check.(v == [120, 50, 50, 120, 50, 50, 120, 50], "velocity accent every 3 (%)".format(v));
	v = ~vel.([[\velMode, "random"], [\low, 30], [\high, 40]], 16);
	check.(v.every(_.inclusivelyBetween(30, 40)) and: { v.asSet.size > 1 }, "velocity random in range (%)".format(v));
	v = ~vel.([[\velMode, "drift"], [\low, 20], [\high, 110], [\rate, 1]], 16);
	check.(v.every(_.inclusivelyBetween(20, 110)) and: { v.asSet.size > 1 }, "velocity drift in range (%)".format(v));
	v = ~vel.([[\velMode, "ramp"], [\low, 20], [\high, 100], [\attack, 1], [\decay, 1]], 9);
	check.(v == [20, 40, 60, 80, 100, 80, 60, 40, 20], "velocity ramp (%)".format(v));
	v = ~vel.([[\velMode, "pattern"], [\pattern, "100 50  70"]], 7);
	check.(v == [100, 50, 70, 100, 50, 70, 100], "velocity pattern (%)".format(v));
	v = ~vel.([[\velMode, "set"], [\velocity, 64], [\humanize, 5]], 16);
	check.(v.every(_.inclusivelyBetween(59, 69)) and: { v.asSet.size > 1 }, "humanize ±5 (%)".format(v));

	// rhythm: which grid steps (k) play
	brain.sendMsg('/gen/set', genId, \velMode, "set");
	v = ~hits.([[\rhythm, "every"], [\interval, 3], [\offset, 1]], 12);
	check.(v == [1, 4, 7, 10], "every 3, offset 1 (%)".format(v));
	v = ~hits.([[\rhythm, "euclid"], [\pulses, 3], [\steps, 8], [\offset, 0]], 16);
	check.(v == [0, 3, 6, 8, 11, 14], "euclid 3 of 8 (%)".format(v));
	v = ~hits.([[\rhythm, "euclid"], [\offset, 2]], 8);
	check.(v == [0, 2, 5], "euclid rotated by 2 (%)".format(v));
	check.(~hits.([[\rhythm, "random"], [\prob, 0]], 8).isEmpty, "random 0%");
	check.(~hits.([[\rhythm, "random"], [\prob, 100]], 8) == (0..7), "random 100%");
	v = ~hits.([[\rhythm, "phrase"], [\phrase, "1 2"]], 9);
	check.(v == [0, 1, 3, 4, 6, 7], "phrase 1 2 (%)".format(v));
	check.(~hits.([[\rhythm, "phrase"], [\phrase, "1 x"]], 6) == (0..5), "invalid phrase → every 1");
	brain.sendMsg('/gen/set', genId, \rhythm, "every");
	brain.sendMsg('/gen/set', genId, \interval, 1);

	// clocks: at half the main tempo, 1/4-beat notes land on every other main step
	brain.sendMsg('/clock/add');
	0.1.wait;
	brain.sendMsg('/clock/set', ~clockId, \num, 1); brain.sendMsg('/clock/set', ~clockId, \den, 2);
	v = ~hits.([[\clock, ~clockId]], 8);
	check.(v == [0, 2, 4, 6], "clock ratio 1/2 (%)".format(v));
	brain.sendMsg('/clock/set', ~clockId, \mode, "factor"); brain.sendMsg('/clock/set', ~clockId, \factor, 0.5);
	v = ~hits.([], 8);
	check.(v == [0, 2, 4, 6], "clock factor 0.5 (%)".format(v));
	brain.sendMsg('/clock/set', ~clockId, \mode, "free"); brain.sendMsg('/clock/set', ~clockId, \bpm, 120);
	v = ~hits.([], 8);
	check.(v == [0, 2, 4, 6], "clock free 120 bpm (%)".format(v));
	brain.sendMsg('/clock/remove', ~clockId);
	0.1.wait;

	brain.sendMsg('/chord/clear');
	0.1.wait;
	check.(chord == [], "clear");
	check.(run.(\lowest).isEmpty, "empty chord rests");

	brain.sendMsg('/gen/remove', genId);

	// passthrough: transport stopped; zone C4..C5, up an octave and a tone
	brain.sendMsg('/gen/add', "passthrough");
	0.1.wait;
	[[\octave, 1], [\semitone, 2], [\lo, 60], [\hi, 72], [\active, 1]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	0.1.wait;
	notes.clear;
	[59, 60, 72, 73].do { |n| out.noteOn(0, n, 90); 0.03.wait; out.noteOff(0, n, 0); 0.03.wait };
	0.1.wait;
	check.(notes.asArray == [74, 86], "passthrough: zone and transpose (%)".format(notes));
	// with a destination (port 1 ch 3): MIDI arrives on IAC Bus 1, note-offs included
	brain.sendMsg('/dest/add', "pass", 1, 3, "none");
	0.1.wait;
	brain.sendMsg('/gen/set', genId, \dest, ~destId);
	0.1.wait;
	~midi.clear;
	[60, 64].do { |n| out.noteOn(0, n, 90) }; 0.05.wait; [60, 64].do { |n| out.noteOff(0, n, 0) }; 0.1.wait;
	check.(~midi.asArray == [[\on, 74], [\on, 78], [\off, 74], [\off, 78]], "passthrough: MIDI out on ch 3 (%)".format(~midi));
	// delay: 1 beat at 240 bpm = 0.25 s, note-off delayed too
	brain.sendMsg('/gen/set', genId, \delay, 1);
	0.1.wait;
	~midi.clear;
	out.noteOn(0, 60, 90); 0.1.wait; out.noteOff(0, 60, 0);
	0.1.wait;
	check.(~midi.isEmpty, "passthrough delay: nothing yet after 0.1 s");
	0.25.wait;
	check.(~midi.asArray == [[\on, 74], [\off, 74]], "passthrough delay: note and note-off after 1 beat (%)".format(~midi));
	brain.sendMsg('/dest/remove', ~destId);
	brain.sendMsg('/gen/remove', genId);
	brain.sendMsg('/gen/set', 1, \take, "every chord");
	0.1.wait;

	// --- groups: off and soloed-out mute (no notes); two solos both sound; removing ungroups ---
	OSCdef(\group, { |msg| ~groupId = msg[1] }, '/group');
	brain.sendMsg('/gen/add', "basic");
	0.1.wait;
	[[\num, 1], [\den, 4], [\active, 1]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	brain.sendMsg('/group/add', "g");
	0.1.wait;
	~g = ~groupId;
	brain.sendMsg('/gen/set', genId, \group, ~g);
	0.1.wait;
	~count = { var n; notes.clear; brain.sendMsg('/transport/play', 1); 0.4.wait; brain.sendMsg('/transport/play', 0); 0.1.wait; notes.size };
	check.(~count.() >= 4, "group on: plays");
	brain.sendMsg('/group/set', ~g, \on, 0); 0.05.wait;
	check.(~count.() == 0, "group off: silent");
	brain.sendMsg('/group/set', ~g, \on, 1);
	brain.sendMsg('/group/add', "h");
	0.1.wait;
	~h = ~groupId;
	brain.sendMsg('/group/set', ~h, \solo, 1); 0.05.wait;
	check.(~count.() == 0, "another group soloed: silent");
	brain.sendMsg('/group/set', ~g, \solo, 1); 0.05.wait;
	check.(~count.() >= 4, "its group soloed too: plays");
	brain.sendMsg('/group/remove', ~g); 0.05.wait;
	check.(~count.() == 0, "group removed: ungrouped, silenced by h's solo");
	brain.sendMsg('/group/remove', ~h); 0.05.wait;
	check.(~count.() >= 4, "no groups: plays");
	brain.sendMsg('/gen/remove', genId);
	0.1.wait;

	// --- chance and note length (basic): 1 beat steps at 240 bpm = 0.25 s; MIDI on port 1 ch 3 ---
	brain.sendMsg('/gen/add', "basic");
	brain.sendMsg('/dest/add', "len", 1, 3, "none");
	0.1.wait;
	[[\dest, ~destId], [\active, 1], [\chance, 0]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	0.05.wait;
	check.(~count.() == 0, "chance 0: nothing plays");
	brain.sendMsg('/gen/set', genId, \chance, 100);
	0.05.wait;
	// the lengths of the notes played in ~0.9 s (on → its off)
	~lengths = {
		var ons;
		~timed.clear;
		brain.sendMsg('/transport/play', 1); 0.9.wait; brain.sendMsg('/transport/play', 0); 0.2.wait;
		ons = ~timed.select { |e| e[1] == \on };
		ons.collect { |on| (~timed.detect { |e| e[1] == \off and: { e[0] >= on[0] } } !? (_[0]) ? inf) - on[0] };
	};
	v = ~lengths.();
	check.(v.size >= 3 and: { v.drop(-1).every { |x| (x - 0.25).abs < 0.03 } }, "hold: each note lasts until the next (%)".format(v.round(0.01)));
	brain.sendMsg('/gen/set', genId, \length, "percent");
	brain.sendMsg('/gen/set', genId, \duration, 40);
	0.05.wait;
	v = ~lengths.();
	check.(v.size >= 3 and: { v.every { |x| (x - 0.1).abs < 0.03 } }, "length 40 percent of the step: 0.1 s notes (%)".format(v.round(0.01)));
	brain.sendMsg('/dest/remove', ~destId);
	brain.sendMsg('/gen/remove', genId);
	0.1.wait;

	// --- knobs: a global learns a knob by turning it; that knob (only) moves it ---
	OSCdef(\global, { |msg| ~globalMsg = msg[1..] }, '/global');
	brain.sendMsg('/global/add', "knobbed");
	0.1.wait;
	~gid = ~globalMsg[0];
	brain.sendMsg('/global/learn', ~gid, 1);
	0.05.wait;
	out.control(0, 74, 0);
	0.1.wait;
	check.(~globalMsg[3] == 1 and: { ~globalMsg[4] == 74 }, "knob learned by turning it (%)".format(~globalMsg));
	out.control(0, 74, 127);
	0.1.wait;
	check.((~globalMsg[2] - 1).abs < 0.001, "the knob moves the global (%)".format(~globalMsg[2]));
	out.control(0, 75, 0);
	0.1.wait;
	check.((~globalMsg[2] - 1).abs < 0.001, "other knobs don't");
	// one knob, several globals, each with its own response
	~byId = ();
	OSCdef(\globalAll, { |msg| ~byId[msg[1]] = msg[1..] }, '/global');
	brain.sendMsg('/global/add', "inverted");
	0.1.wait;
	~inv = ~globalMsg[0];
	brain.sendMsg('/global/add', "squared");
	0.1.wait;
	~sq = ~globalMsg[0];
	brain.sendMsg('/global/knob', ~inv, 1, 74);
	brain.sendMsg('/global/knob', ~sq, 1, 74);
	brain.sendMsg('/global/set', ~inv, \response, \invert);
	brain.sendMsg('/global/set', ~sq, \response, \formula);
	brain.sendMsg('/global/set', ~sq, \formula, "x * x");
	0.1.wait;
	out.control(0, 74, 64);
	0.15.wait;
	check.((~byId[~gid][2] - 0.504).abs < 0.01 and: { (~byId[~inv][2] - 0.496).abs < 0.01 } and: { (~byId[~sq][2] - 0.254).abs < 0.01 },
		"one knob drives three globals: linear %, inverted %, x*x %".format(~byId[~gid][2].round(0.001), ~byId[~inv][2].round(0.001), ~byId[~sq][2].round(0.001)));
	brain.sendMsg('/global/set', ~sq, \formula, "x +* nonsense(");
	0.1.wait;
	out.control(0, 74, 127);
	0.15.wait;
	check.((~byId[~sq][2] - 1).abs < 0.01, "a formula that doesn't parse is reported and treated as x (%)".format(~byId[~sq][2]));
	brain.sendMsg('/global/remove', ~inv);
	brain.sendMsg('/global/remove', ~sq);
	brain.sendMsg('/global/knob', ~gid, 0, 0);
	0.05.wait;
	check.(~globalMsg[3] == 0, "knob cleared");
	brain.sendMsg('/global/remove', ~gid);
	0.05.wait;

	// --- inputs: an input switched off is ignored (keys), and listened to again when back on ---
	OSCdef(\inputs, { |msg| ~inputsMsg = msg[1..] }, '/inputs');
	brain.sendMsg('/inputs/rescan');
	0.2.wait;
	check.(~inputsMsg.size == 3 and: { ~inputsMsg[1] == 1 }, "inputs listed, on (%)".format(~inputsMsg));
	brain.sendMsg('/gen/set', 1, \take, "every chord");
	brain.sendMsg('/chord/clear');
	brain.sendMsg('/inputs/set', ~inputsMsg[0], 0);
	0.1.wait;
	play.([60, 64], [60, 64]);
	check.(~inputsMsg[1] == 0 and: { chord.isEmpty }, "an input switched off is ignored (chord %)".format(chord));
	brain.sendMsg('/inputs/set', ~inputsMsg[0], 1);
	0.1.wait;
	play.([62, 65], [62, 65]);
	check.(chord.asArray == [62, 65], "switched back on, it plays (chord %)".format(chord));
	brain.sendMsg('/chord/clear');
	0.1.wait;

	// --- switch keys and control surfaces: a key switches a generator or group and never reaches the chord ---
	OSCdef(\genFull, { |msg| ~genMsg = msg[1..] }, '/gen');
	OSCdef(\groupFull, { |msg| ~groupMsg = msg[1..] }, '/group');
	brain.sendMsg('/gen/add', "basic");
	0.1.wait;
	brain.sendMsg('/key/set', \gen, genId, 36);
	0.05.wait;
	play.([36], [36]);
	check.(~genMsg[0] == genId and: { ~genMsg[3] == 1 } and: { ~genMsg[6] == 36 } and: { chord.isEmpty },
		"a switch key turns its generator on and leaves the chord alone (gen %, chord %)".format(~genMsg, chord));
	play.([36], [36]);
	check.(~genMsg[3] == 0, "and off again");
	brain.sendMsg('/group/add', "keyed");
	0.1.wait;
	~kg = ~groupMsg[0];
	brain.sendMsg('/key/learn', \group, ~kg, 1);
	0.05.wait;
	play.([38], [38]);
	check.(~groupMsg[5] == 38 and: { ~groupMsg[2] == 1 }, "a switch key is learned by playing it (group %)".format(~groupMsg));
	play.([38], [38]);
	check.(~groupMsg[2] == 0, "then it switches the group");
	brain.sendMsg('/inputs/role', ~inputsMsg[0], \control);
	0.1.wait;
	play.([60, 64], [60, 64]);
	play.([36], [36]);
	check.(chord.isEmpty and: { ~genMsg[3] == 1 }, "a control surface's keys don't reach the chord, its switch keys work (chord %)".format(chord));
	brain.sendMsg('/inputs/role', ~inputsMsg[0], \all);
	brain.sendMsg('/group/remove', ~kg);
	brain.sendMsg('/gen/remove', genId);
	0.1.wait;

	// --- control changes ---
	~ccs.clear;
	brain.sendMsg('/cc', 1, 3, 20, 99);
	0.1.wait;
	check.(~ccs.asArray == [[2, 20, 99]], "/cc: one control change on ch 3 (%)".format(~ccs));
	// lfo: square, one cycle per 1/2 beat (0.125 s at 240 bpm), 10..100 on ch 4 cc 21
	brain.sendMsg('/gen/add', "lfo");
	0.1.wait;
	[[\shape, "square"], [\num, 1], [\den, 2], [\low, 10], [\high, 100], [\channel, "4"], [\cc, 21], [\active, 1]]
		.do { |m| brain.sendMsg('/gen/set', genId, *m) };
	0.1.wait;
	~ccs.clear;
	brain.sendMsg('/transport/play', 1);
	0.6.wait;
	brain.sendMsg('/transport/play', 0);
	0.1.wait;
	v = ~ccs.select { |e| e[0] == 3 and: { e[1] == 21 } }.collect(_[2]);
	check.(v.size >= 6 and: { v.asSet == Set[10, 100] } and: { ~ccs.size == v.size },
		"lfo square: alternates 10/100 on ch 4 cc 21, only on change (%)".format(v));
	// sine: stays in range, moves smoothly
	[[\shape, "sine"], [\num, 1], [\den, 1]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	0.1.wait;
	~ccs.clear;
	brain.sendMsg('/transport/play', 1);
	0.5.wait;
	brain.sendMsg('/transport/play', 0);
	0.1.wait;
	v = ~ccs.collect(_[2]);
	check.(v.size >= 10 and: { v.every { |x| x.inclusivelyBetween(10, 100) } } and: { v.asSet.size >= 8 },
		"lfo sine: % values in 10..100".format(v.size));
	// Send button: one value now, from/to in turn, transport stopped
	~ccs.clear;
	[[\low, 10], [\high, 100]].do { |m| brain.sendMsg('/gen/set', genId, *m) };
	brain.sendMsg('/gen/do', genId, "Send");
	0.05.wait;
	brain.sendMsg('/gen/do', genId, "Send");
	0.1.wait;
	check.(~ccs.asArray == [[3, 21, 100], [3, 21, 10]], "lfo Send: to, then from (%)".format(~ccs));
	brain.sendMsg('/gen/remove', genId);
	0.1.wait;
	if(fail) { "GENERATORS FAILED".postln; 1.exit } { "GENERATORS PASSED".postln; 0.exit };
}.play(SystemClock);
)
