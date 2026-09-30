// main.scd — the brain: clock, destinations and generators; MIDI out, OSC to/from surfaces.
// Run headless:  sclang brain/main.scd      (PERFORMED_TEST=1 for test mode)
//   test mode: no default destinations, no Link (plain TempoClock), MIDI input and control = IAC Bus 2
// The OSC protocol is documented in core/osc.scd and PLAN.md §5.
(
var root = thisProcess.nowExecutingPath.dirname;

~root = root;
~testMode = "PERFORMED_TEST".getenv.notNil;
~config = (root +/+ "config.scd").load;
if(~testMode) { ~config[\inputs] = [["IAC Driver", "Bus 2"]]; ~config[\control] = [["IAC Driver", "Bus 2"]] };

["json", "midi", "keyboard", "clock", "chord", "destinations", "generators", "pitch", "rhythm", "velocity", "persist", "osc"].do { |name|
	(root +/+ "core" +/+ name ++ ".scd").load;
};

~types = ();
(root +/+ "types/*.scd").pathMatch.do { |path|
	~types[path.basename.splitext[0].asSymbol] = path.load;
};

~midiInit.();
~linkInit.();
~keyboardInit.();
if(~testMode.not) { ~config[\destinations].do { |d| ~addDest.(*d) } };
~oscInit.();

"brain ready: % types, % destinations, OSC on %".format(
	~types.size, ~dests.size, ~port).postln;
)
