// keyboard.scd — MIDI input from the performer's keyboard and controllers: which devices count,
// where each key goes (learn, the chord, key-driven generators), and learn itself.
//
// Every source is connected; only the chosen inputs' messages are kept. The candidates are config
// `inputs`, or by default every source but the devices the brain sends to (so it never hears its
// own output, even if the IAC Driver is renamed) and Max's virtual "from Max" ports (they appear
// when Live runs a Max for Live device). The performer switches candidates off and on from the
// surface (/inputs/set); what's off is remembered in local/inputs.json (this machine's rig, not in
// git; not in test mode). /inputs/rescan finds devices plugged in since.
//
// An input's role: `all` (its keys play: chord, key-driven generators) or `control` (a control
// surface: its knobs drive globals and its keys can be switch keys, but never reach the chord).
// Switch keys: a note that switches a generator or a group on and off (their `key`), learned by
// playing it (/key/learn) or set (/key/set). A switch key is used up: the chord never sees it.
(
~inputsOff = Set[];  // "device name" of the candidates switched off
~inputsControl = Set[];  // ... of those that are control surfaces
~controlUids = [];
~inputsPath = { ~root.dirname +/+ "local" +/+ "inputs.json" };
~inputKey = { |e| if(e.device == e.name) { e.name } { e.device + e.name } };  // "MiniLab", or "IAC Driver Bus 2"

~inputName = { |uid| MIDIClient.sources.detect { |e| e.uid == uid } !? ~inputKey };  // of a source, by its uid

~inputCandidates = {
	var own = (~config[\ports] ++ (~config[\control] ? [])).collect(_[0]);
	MIDIClient.sources.select { |e|
		~config[\inputs] !? { |ins| ins.any { |pair| e.device == pair[0] and: { e.name == pair[1] } } }
		?? { own.includesEqual(e.device).not and: { e.device.beginsWith("from Max").not } };
	};
};

// Which sources are listened to now, and the list for surfaces.
~applyInputs = {
	~inputUids = ~inputCandidates.().reject { |e| ~inputsOff.includes(~inputKey.(e)) }.collect(_.uid);
	~controlUids = ~inputCandidates.().select { |e| ~inputsControl.includes(~inputKey.(e)) }.collect(_.uid);
	~sendInputs.();
};

~sendInputs = {
	~send.('/inputs', *~inputCandidates.().collect { |e|
		var name = ~inputKey.(e);
		[name, ~inputsOff.includes(name).not.binaryValue, if(~inputsControl.includes(name)) { \control } { \all }];
	}.flatten);
};

~rememberInputs = {
	if(~testMode.not) {
		File.mkdir(~inputsPath.().dirname);
		~writeJSON.(~inputsPath.(), (off: ~inputsOff.asArray.sort, control: ~inputsControl.asArray.sort));
	};
	~applyInputs.();
};

~setInputRole = { |name, role|
	if(role.asSymbol == \control) { ~inputsControl.add(name.asString) } { ~inputsControl.remove(name.asString) };
	~rememberInputs.();
};

~setInput = { |name, on|
	if(on.asInteger == 1) { ~inputsOff.remove(name.asString) } { ~inputsOff.add(name.asString) };
	~rememberInputs.();
};

// Devices plugged in since the brain started: refresh the list and connect them.
~rescanInputs = {
	MIDIClient.list;
	try { MIDIIn.connectAll } { |e| "MIDI rescan: %".format(e.errorString).warn };
	~applyInputs.();
};

// Call after ~midiInit.
~keyboardInit = {
	if(~testMode.not and: { File.exists(~inputsPath.()) }) {
		var saved = File.readAllString(~inputsPath.()).parseJSON ? ();
		~inputsOff = (saved["off"] ? []).asSet;
		~inputsControl = (saved["control"] ? []).asSet;
	};
	MIDIIn.connectAll;
	MIDIdef.noteOn(\keyOn, { |vel, note, ch, src| if(~inputUids.includes(src)) { ~key.(note, vel, ~controlUids.includes(src), ~inputName.(src)) } });
	MIDIdef.noteOff(\keyOff, { |vel, note, ch, src| if(~inputUids.includes(src)) { ~key.(note, 0, ~controlUids.includes(src), ~inputName.(src)) } });
	// knobs and faders: control changes from the same inputs drive globals (core/globals.scd)
	MIDIdef.cc(\knob, { |val, num, ch, src| if(~inputUids.includes(src)) { ~knob.(ch + 1, num, val) } });
	~applyInputs.();
	"MIDI inputs: %".format(MIDIClient.sources.select { |e| ~inputUids.includes(e.uid) }.collect(~inputKey)).postln;
};

// Keyboard input (vel 0 = key up). A key pressed while a param is learning only sets that param;
// a switch key (or one being learned) only switches; a control surface's other keys do nothing;
// the rest go to key-driven generators (chord strips, passthrough), with the input's name (`src`).
~key = { |note, vel, controlOnly = false, src|
	case
	{ vel > 0 and: { ~learning.notNil } } { ~learnNote.(note) }
	{ ~switchKey.(note, vel) } { nil }
	{ controlOnly } { nil }
	{ vel > 0 } { ~keyDown.(note); ~genKey.(note, vel, src) }
	{ ~keyUp.(note); ~genKey.(note, 0, src) };
};

// --- switch keys ---
~keyLearning = nil;  // [\gen | \group, id]: the next key played becomes its switch key

~keyOwner = { |kind, id| if(kind.asSymbol == \group) { ~groups[id.asInteger] } { ~gens[id.asInteger] } };

~learnKey = { |kind, id, on|
	~keyLearning !? { |l| ~send.('/key/learn', l[0], l[1], 0) };
	~keyLearning = if(on.asInteger == 1 and: { ~keyOwner.(kind, id).notNil }) { [kind.asSymbol, id.asInteger] };
	~keyLearning !? { |l| ~send.('/key/learn', l[0], l[1], 1) };
};

// note < 0 forgets it
~setSwitchKey = { |kind, id, note|
	~keyOwner.(kind, id) !? { |o|
		o[\key] = if(note.asInteger >= 0) { note.asInteger };
		if(kind.asSymbol == \group) { ~sendGroup.(o) } { ~sendGen.(o) };
		~setDirty.(true);
	};
};

// Learns the key, or switches what it belongs to (on key down). True if the note was used up.
~switchKey = { |note, vel|
	var used = false;
	if(~keyLearning.notNil) {
		if(vel > 0) {
			var l = ~keyLearning;
			~keyLearning = nil;
			~send.('/key/learn', l[0], l[1], 0);
			~setSwitchKey.(l[0], l[1], note);
		};
		true;
	} {
		~gens.do { |g| if(g[\key] == note) { used = true; if(vel > 0) { ~setGen.(g, \active, g[\active].not.binaryValue); ~setDirty.(true) } } };
		~groups.do { |gr| if(gr[\key] == note) { used = true; if(vel > 0) { ~setGroup.(gr, \on, gr[\on].not.binaryValue); ~setDirty.(true) } } };
		used;
	};
};

// Learn: the next key played sets a generator's (note) param.
~learning = nil;  // [genId, param]

~learnGen = { |id, param, on|
	~learning !? { |l| ~send.('/gen/learn', l[0], l[1], 0) };
	~learning = if(on and: { ~gens[id].notNil }) { [id, param.asSymbol] };
	~learning !? { |l| ~send.('/gen/learn', l[0], l[1], 1) };
};

~learnNote = { |note|
	var l = ~learning;
	~learning = nil;
	~send.('/gen/learn', l[0], l[1], 0);
	~gens[l[0]] !? { |g| ~setGen.(g, l[1], note) };
};
)
