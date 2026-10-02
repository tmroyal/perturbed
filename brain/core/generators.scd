// generators.scd — generator lifecycle and the shared ~strike.
//
// A generator: (id, typeName, type, p: params, active, dest: dest id or 0, group: group id or 0,
// task, sounding, held). Whether it sounds also depends on its group (core/groups.scd: ~sounds).
// Types live in brain/types/, one file each (filename = type name), evaluating to:
//   params:    [[name, default, kind, ...kind args], ...]  also the surface's schema;
//              kind = range (min max [step]) | note | choice (options...) | text | clock
//              (a `clock` param picks the clock `run` plays on; 0 = main, see core/clock.scd)
// and one or both of:
//   run:       { |g, p| } routine body on the transport clock; waits are in beats
//   key:       { |g, p, note, vel| } called for each keyboard note while active (vel 0 = up),
//              whether or not the transport runs; notes it holds go in g[\held] (see passthrough)
// and optionally:
//   showWhen:  (param: [otherParam, value...]) the surface shows param only for those values
//   labels:    (param: "label") display names; the param name is shown otherwise
//   sections:  (param: "Title") params that start a new titled group on the surface
//   restartOn: params whose change restarts `run` (re-quantizes to the new grid)
//   actions:   (Name: { |g, p| }) buttons on the card; pressing one runs it (/gen/do)
//   sliders:   (param: \lin | \log) range params shown as a slider (+ field); by default a range
//              wider than 32 is a slider, others a number field, and num/den always fields
//   output:    false for types that don't play into an output (lfo); the surface hides the menu
// Shared building blocks: core/pitch.scd (which note), core/rhythm.scd (which grid steps play),
// core/velocity.scd (how loud).
(
~gens = ();

// Releases the generator's previous note and plays the new one at the same logical time. A
// generator muted by its group (or another group's solo) only releases.
~strike = { |g, note, vel|
	var d = ~dests[g[\dest]];
	~release.(g);
	if(~sounds.(g)) {
		d !? { ~noteOn.(d, note, vel) };
		g[\sounding] = d !? { [d, note] };
		~sendLate.('/note', g[\id], note, vel);
	};
};

~release = { |g|
	g[\sounding] !? { |sn| ~noteOff.(sn[0], sn[1]) };
	g[\sounding] = nil;
};

// Keyboard notes a key-driven generator is holding: (inNote: [dest, outNote]).
~releaseHeld = { |g|
	g[\held] !? { |held| held.do { |h| ~noteOff.(h[0], h[1], true) } };
	g[\held] = ();
};

// Lets go of everything it plays: its note and the keys it holds.
~silence = { |g| ~release.(g); ~releaseHeld.(g) };

~genKey = { |note, vel|
	~gens.do { |g| if(g[\active]) { g[\type][\key] !? { |fn| try { fn.(g, g[\p], note, vel) } { |e| ~genFailed.(g, e) } } } };
};

// (Re)starts the routine if it should be running. A sounding note rings until the next
// strike, so restarts don't cut notes short.
~startGen = { |g|
	g[\task].stop;
	g[\task] = nil;
	if(~playing and: { g[\active] } and: { g[\type][\run].notNil }) {
		// a failing run (an AdHoc type's bug) stops only this generator (core/library.scd)
		g[\task] = Routine { g[\type][\run].value(g, g[\p]) };
		g[\task].exceptionHandler = { |e| ~genFailed.(g, e) };
		g[\task].play(~clockOf.(g[\p][\clock] ? 0));
	};
};

~stopGen = { |g|
	g[\task].stop;
	g[\task] = nil;
	~release.(g);
};

~addGen = { |typeName, group = 0, id|
	var type = ~types[typeName.asSymbol], g;
	if(type.isNil) { "unknown generator type %".format(typeName).warn; nil } {
		id = ~newId.(\gen, id);
		g = (id: id, typeName: typeName.asSymbol, type: type, p: ~paramsFor.(type), active: false, dest: 0,
			held: (), group: ~groupOrNone.(group));
		~gens[id] = g;
		~sendGen.(g);
		~sendParams.(g);
		id;
	};
};

~removeGen = { |id|
	~gens.removeAt(id) !? { |g| ~stopGen.(g); ~releaseHeld.(g); ~dropPins.(id); ~send.('/gen/removed', id) };
};

// A type's params: kept from `old` (a generator's settings) where the param exists, else defaults.
~paramsFor = { |type, old|
	var p = ();
	type[\params].do { |spec| p[spec[0]] = (old ? ())[spec[0]] ? spec[1] };
	p;
};

~setGen = { |g, key, val|
	key = key.asSymbol;
	case
	{ key == \active } {
		g[\active] = val.asInteger == 1;
		if(g[\active]) { ~startGen.(g) } { ~stopGen.(g); ~releaseHeld.(g) };
		~sendGen.(g);
	}
	{ key == \dest } {
		~silence.(g);
		g[\dest] = val.asInteger;
		~sendGen.(g);
	}
	{ key == \group } {
		if(val.asInteger != g[\group]) { ~dropPins.(g[\id]) };
		g[\group] = ~groupOrNone.(val);
		~gate.(g);
		~sendGen.(g);
	}
	{ g[\p].includesKey(key) } {
		g[\p][key] = val;
		if(g[\task].notNil and: { (g[\type][\restartOn] ? []).includes(key) }) { ~startGen.(g) };
		~send.('/gen/param', g[\id], key, val);
	}
	{ "gen %: unknown param %".format(g[\id], key).warn };
};

// Runs one of the type's actions (a card button); unknown actions are ignored.
~genDo = { |g, action| g[\type][\actions] !? { |acts| acts[action.asSymbol] !? { |fn| fn.(g, g[\p]) } } };

~sendGen = { |g| ~send.('/gen', g[\id], g[\typeName], g[\dest], g[\active].binaryValue, g[\group] ? 0) };

~sendParams = { |g|
	g[\type][\params].do { |spec| ~send.('/gen/param', g[\id], spec[0], g[\p][spec[0]]) };
};

~sendSchema = {
	~types.keysValuesDo { |name, type|
		type[\params].do { |spec| ~send.('/gen/schema', name, spec[0], spec[2], spec[1], *spec[3..]) };
		(type[\showWhen] ? ()).keysValuesDo { |param, cond| ~send.('/gen/show', name, param, *cond) };
		(type[\labels] ? ()).keysValuesDo { |param, label| ~send.('/gen/label', name, param, label) };
		(type[\sections] ? ()).keysValuesDo { |param, title| ~send.('/gen/section', name, param, title) };
		if(type[\output] == false) { ~send.('/gen/nooutput', name) };
		(type[\sliders] ? ()).keysValuesDo { |param, scale| ~send.('/gen/slider', name, param, scale) };
		(type[\actions] ? ()).keys.asArray.sort.do { |a| ~send.('/gen/action', name, a) };
	};
};
)
