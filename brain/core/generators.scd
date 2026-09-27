// generators.scd — generator lifecycle and the shared ~strike.
//
// A generator: (id, typeName, type, p: params, active, dest: dest id or 0, task, sounding, held).
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
// Shared building blocks: core/pitch.scd (which note), core/rhythm.scd (which grid steps play),
// core/velocity.scd (how loud).
(
~gens = ();
~nextGenId = 1;

// Releases the generator's previous note and plays the new one at the same logical time.
~strike = { |g, note, vel|
	var d = ~dests[g[\dest]];
	g[\sounding] !? { |sn| ~noteOff.(sn[0], sn[1]) };
	d !? { ~noteOn.(d, note, vel) };
	g[\sounding] = d !? { [d, note] };
	~sendLate.('/note', g[\id], note, vel);
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

~genKey = { |note, vel|
	~gens.do { |g| if(g[\active]) { g[\type][\key] !? { |fn| fn.(g, g[\p], note, vel) } } };
};

// (Re)starts the routine if it should be running. A sounding note rings until the next
// strike, so restarts don't cut notes short.
~startGen = { |g|
	g[\task].stop;
	g[\task] = nil;
	if(~playing and: { g[\active] } and: { g[\type][\run].notNil }) {
		g[\task] = Routine { g[\type][\run].value(g, g[\p]) }.play(~clockOf.(g[\p][\clock] ? 0));
	};
};

~stopGen = { |g|
	g[\task].stop;
	g[\task] = nil;
	~release.(g);
};

~addGen = { |typeName|
	var type = ~types[typeName.asSymbol], id, g;
	if(type.isNil) { "unknown generator type %".format(typeName).warn; nil } {
		id = ~nextGenId;
		~nextGenId = id + 1;
		g = (id: id, typeName: typeName.asSymbol, type: type, p: (), active: false, dest: 0, held: ());
		type[\params].do { |spec| g[\p][spec[0]] = spec[1] };
		~gens[id] = g;
		~sendGen.(g);
		~sendParams.(g);
		id;
	};
};

~removeGen = { |id|
	~gens.removeAt(id) !? { |g| ~stopGen.(g); ~releaseHeld.(g); ~send.('/gen/removed', id) };
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
		~release.(g);
		~releaseHeld.(g);
		g[\dest] = val.asInteger;
		~sendGen.(g);
	}
	{ g[\p].includesKey(key) } {
		g[\p][key] = val;
		if(g[\task].notNil and: { (g[\type][\restartOn] ? []).includes(key) }) { ~startGen.(g) };
		~send.('/gen/param', g[\id], key, val);
	}
	{ "gen %: unknown param %".format(g[\id], key).warn };
};

~sendGen = { |g| ~send.('/gen', g[\id], g[\typeName], g[\dest], g[\active].binaryValue) };

~sendParams = { |g|
	g[\type][\params].do { |spec| ~send.('/gen/param', g[\id], spec[0], g[\p][spec[0]]) };
};

~sendSchema = {
	~types.keysValuesDo { |name, type|
		type[\params].do { |spec| ~send.('/gen/schema', name, spec[0], spec[2], spec[1], *spec[3..]) };
		(type[\showWhen] ? ()).keysValuesDo { |param, cond| ~send.('/gen/show', name, param, *cond) };
		(type[\labels] ? ()).keysValuesDo { |param, label| ~send.('/gen/label', name, param, label) };
		(type[\sections] ? ()).keysValuesDo { |param, title| ~send.('/gen/section', name, param, title) };
	};
};
)
