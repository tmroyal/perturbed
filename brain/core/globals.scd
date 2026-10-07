// globals.scd — global parameters ("Meta 1", ...): named, performance-wide controls, 0–1, each
// mapped to any number of generator settings, so one gesture reshapes the piece (PLAN §5.10).
//
// A mapping is (gen, param, from, to, curve, amount): the global's value x in 0–1 becomes
// from + (to - from) * curve(x), in the setting's units (from > to inverts it). Curves:
//   linear     x
//   exp        slow start, fast end (velocity, frequencies)
//   steps      x snapped to `amount` levels (default 4)
//   threshold  0 below `amount` (default 0.5), 1 from there on: jumps from `from` to `to`
// Choice settings map over their option indexes (0 = first option). A setting follows at most one
// global and is locked while it does: /gen/set for it is refused (core/osc.scd). Settings that
// restart a generator (restartOn), clocks and text can't be mapped. AdHoc types read globals with
// ~global.(\name) and declare them (`globals: [\name]`), which creates missing ones on load.
//
// Generators can drive settings the same way: a type with `maps: true` (lfo) holds mappings too
// (g[\mappings]) and moves them with ~drive.(g, x) from its run. Globals and such generators are
// "drivers"; a setting follows at most one of them, whichever kind.
//
// Knobs: a global can follow a knob or fader on the performer's controller ([channel, cc], channel
// 1-based): learned by turning it (/global/learn) or set (/global/knob); 0–127 → 0–1. A knob drives
// one global; learning it for another moves it there.
(
~globals = ();
~curves = [\linear, \exp, \steps, \threshold];

~addGlobal = { |name, id|
	var gl;
	id = ~newId.(\global, id);
	gl = (id: id, name: (name ?? { "Meta %".format(id) }).asString, value: 0.0, mappings: [], knob: nil);
	~globals[id] = gl;
	~sendGlobal.(gl);
	~sendMappings.(gl);
	gl;
};

~setGlobal = { |gl, key, val|
	switch(key.asSymbol,
		\name, { gl[\name] = val.asString },
		\value, { gl[\value] = val.asFloat.clip(0, 1); ~applyGlobal.(gl) });
	~sendGlobal.(gl);
};

~removeGlobal = { |id|
	if(~knobLearning == id) { ~knobLearning = nil };
	~globals.removeAt(id) !? { ~send.('/global/removed', id) };
};

// --- knobs ---
~knobLearning = nil;  // the global waiting for a knob to be turned

~learnKnob = { |gl, on|
	~knobLearning !? { |id| ~send.('/global/learn', id, 0) };
	~knobLearning = if(on.asInteger == 1) { gl[\id] };
	~knobLearning !? { |id| ~send.('/global/learn', id, 1) };
};

// Assigns a knob ([channel, cc]) to a global, taking it from any other; channel 0 clears.
~setKnob = { |gl, channel, cc|
	var knob = if(channel.asInteger > 0) { [channel.asInteger, cc.asInteger] };
	knob !? { ~globals.do { |o| if(o !== gl and: { o[\knob] == knob }) { o[\knob] = nil; ~sendGlobal.(o) } } };
	gl[\knob] = knob;
	~sendGlobal.(gl);
};

// A control change from the performer's inputs: learn it, and move the globals that follow it.
~knob = { |channel, cc, val|
	~knobLearning !? { |id|
		~knobLearning = nil;
		~send.('/global/learn', id, 0);
		~globals[id] !? { |gl| ~setKnob.(gl, channel, cc) };
	};
	~globals.do { |gl| if(gl[\knob] == [channel, cc]) { ~setGlobal.(gl, \value, val / 127) } };
};

// For AdHoc types: a global's value by name (0 if there's none).
~global = { |name|
	var gl = ~globals.values.detect { |x| x[\name].asSymbol == name.asSymbol };
	gl !? (_[\value]) ? 0;
};

// Creates the globals a type declares that don't exist yet.
~declareGlobals = { |type| (type[\globals] ? []).do { |n| if(~globals.values.any { |x| x[\name].asSymbol == n.asSymbol }.not) { ~addGlobal.(n.asString) } } };

// Everything that holds mappings: the globals, and generators whose type maps (lfo).
~drivers = { ~globals.values ++ ~gens.values.select { |g| g[\type][\maps] == true } };
~isGlobal = { |d| ~globals[d[\id]] === d };
~driverName = { |d| if(~isGlobal.(d)) { d[\name] } { var n = d[\typeName].asString; n[0].toUpper ++ n.drop(1) + d[\id] } };

// The driver (global or generator) a setting follows, or nil.
~mappedBy = { |genId, param| ~drivers.().detect { |d| d[\mappings].any { |m| m[\gen] == genId and: { m[\param] == param.asSymbol } } } };

~mappable = { |g, spec| spec.notNil and: { [\range, \note, \choice].includes(spec[2]) } and: { (g[\type][\restartOn] ? []).includes(spec[0]).not } };

// Maps a setting to a driver (`gl`: a global, or a generator that maps), or updates its mapping;
// from/to default to the current value and the far end of the setting's range. A setting mapped
// elsewhere moves here. A generator can't drive its own settings.
~map = { |gl, genId, param, from, to, curve, amount|
	var g = ~gens[genId.asInteger], spec, max, cur, m, at;
	param = param.asSymbol;
	curve = (curve ? \linear).asSymbol;
	spec = g !? { g[\type][\params].detect { |s| s[0] == param } };
	if(g.isNil or: { g === gl } or: { ~mappable.(g, spec).not }) {
		~report.("can't map %: %".format(param, case
			{ g.isNil } { "no generator %".format(genId) }
			{ g === gl } { "a generator can't drive its own settings" }
			{ "only numbers, notes and menus that don't restart the generator" }));
	} {
		cur = ~settingNumber.(spec, g[\p][param]);
		max = switch(spec[2], \range, { spec[4] }, \note, { 127 }, \choice, { spec.size - 4 });
		m = (gen: g[\id], param: param,
			from: (from ? cur).asFloat, to: (to ?? { if(cur == max) { ~settingMin.(spec) } { max } }).asFloat,
			curve: if(~curves.includes(curve)) { curve } { \linear },
			amount: amount !? (_.asFloat));
		// an edit keeps the mapping's place in the list; a new one goes at the end
		at = gl[\mappings].detectIndex { |x| x[\gen] == g[\id] and: { x[\param] == param } };
		~drivers.().do { |other| if(other !== gl) { ~dropMapping.(other, g[\id], param) } };
		gl[\mappings] = if(at.notNil) { gl[\mappings].copy.put(at, m) } { gl[\mappings].add(m) };
		~sendMappings.(gl);
		if(~isGlobal.(gl)) { ~applyGlobal.(gl) };
	};
};

// /gen/map for a generator whose type maps (lfo).
~mapFromGen = { |g ...args| if(g[\type][\maps] == true) { ~map.(g, *args) } { ~report.("% % can't map settings".format(g[\typeName], g[\id])) } };

~unmap = { |gl, genId, param| ~dropMapping.(gl, genId.asInteger, param.asSymbol) };

~dropMapping = { |gl, genId, param|
	if(gl[\mappings].any { |m| m[\gen] == genId and: { m[\param] == param } }) {
		gl[\mappings] = gl[\mappings].reject { |m| m[\gen] == genId and: { m[\param] == param } };
		~sendMappings.(gl);
	};
};

// A generator is gone: the mappings that point at it go.
~dropGenMappings = { |genId| ~drivers.().do { |gl| gl[\mappings].copy.do { |m| if(m[\gen] == genId) { ~dropMapping.(gl, genId, m[\param]) } } } };

// /gen/set from a surface or tool: a setting that follows a driver is locked (the surface's control
// is put back by the echo).
~setGenByHand = { |g, key, val|
	~mappedBy.(g[\id], key) !? { |gl|
		~report.("% of generator % follows % (unmap it to set it by hand)".format(key, g[\id], ~driverName.(gl)));
		~send.('/gen/param', g[\id], key.asSymbol, g[\p][key.asSymbol]);
	} ?? { ~setGen.(g, key, val) };
};

~settingMin = { |spec| switch(spec[2], \range, { spec[3] }, \note, { 0 }, \choice, { 0 }) };
~settingNumber = { |spec, v| if(spec[2] == \choice) { spec[3..].collect(_.asString).indexOfEqual(v.asString) ? 0 } { v.asFloat } };

~curveOf = { |m, x|
	switch(m[\curve],
		\exp, { (exp(3 * x) - 1) / (exp(3) - 1) },
		\steps, { var n = (m[\amount] ? 4).max(1); (x * n).floor.min(n - 1) / (n - 1).max(1) },
		\threshold, { if(x >= (m[\amount] ? 0.5)) { 1 } { 0 } },
		{ x });
};

// The setting value a mapping gives for x, rounded and clipped to the setting.
~mappedValue = { |m, spec, x|
	var v = m[\from] + ((m[\to] - m[\from]) * ~curveOf.(m, x));
	switch(spec[2],
		\range, { var step = spec[5] ? 1; v = (v / step).round * step; v = v.clip(spec[3], spec[4]); if(step.isInteger) { v.asInteger } { v } },
		\note, { v.round.asInteger.clip(0, 127) },
		\choice, { spec[3..].at(v.round.asInteger.clip(0, spec.size - 4)).asString });
};

// Moves every setting mapped to a driver to where x (0–1) puts it; only real changes are sent.
~drive = { |driver, x|
	driver[\mappings].do { |m|
		var g = ~gens[m[\gen]], spec, v;
		spec = g !? { g[\type][\params].detect { |s| s[0] == m[\param] } };
		if(spec.notNil) {
			v = ~mappedValue.(m, spec, x);
			if(g[\p][m[\param]] != v) { ~setGen.(g, m[\param], v) };
		};
	};
};
~applyGlobal = { |gl| ~drive.(gl, gl[\value]) };

~sendGlobal = { |gl| ~send.('/global', gl[\id], gl[\name], gl[\value], *(gl[\knob] ? [0, 0])) };
// A driver's mappings: /global/mappings for a global, /gen/targets for a generator (same layout).
~sendMappings = { |gl|
	~send.(if(~isGlobal.(gl)) { '/global/mappings' } { '/gen/targets' }, gl[\id],
		*gl[\mappings].collect { |m| [m[\gen], m[\param], m[\from], m[\to], m[\curve], m[\amount] ? -1] }.flatten);
};
)
