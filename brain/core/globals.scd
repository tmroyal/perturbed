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
(
~globals = ();
~curves = [\linear, \exp, \steps, \threshold];

~addGlobal = { |name, id|
	var gl;
	id = ~newId.(\global, id);
	gl = (id: id, name: (name ?? { "Meta %".format(id) }).asString, value: 0.0, mappings: []);
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

~removeGlobal = { |id| ~globals.removeAt(id) !? { ~send.('/global/removed', id) } };

// For AdHoc types: a global's value by name (0 if there's none).
~global = { |name|
	var gl = ~globals.values.detect { |x| x[\name].asSymbol == name.asSymbol };
	gl !? (_[\value]) ? 0;
};

// Creates the globals a type declares that don't exist yet.
~declareGlobals = { |type| (type[\globals] ? []).do { |n| if(~globals.values.any { |x| x[\name].asSymbol == n.asSymbol }.not) { ~addGlobal.(n.asString) } } };

// The global a setting follows, or nil.
~mappedBy = { |genId, param| ~globals.values.detect { |gl| gl[\mappings].any { |m| m[\gen] == genId and: { m[\param] == param.asSymbol } } } };

~mappable = { |g, spec| spec.notNil and: { [\range, \note, \choice].includes(spec[2]) } and: { (g[\type][\restartOn] ? []).includes(spec[0]).not } };

// Maps a setting to `gl`, or updates its mapping; from/to default to the current value and the far
// end of the setting's range. A setting mapped elsewhere moves here.
~map = { |gl, genId, param, from, to, curve, amount|
	var g = ~gens[genId.asInteger], spec, max, cur;
	param = param.asSymbol;
	spec = g !? { g[\type][\params].detect { |s| s[0] == param } };
	if(g.isNil or: { ~mappable.(g, spec).not }) {
		~report.("can't map %: %".format(param, if(g.isNil) { "no generator %".format(genId) } { "only numbers, notes and menus that don't restart the generator" }));
	} {
		cur = ~settingNumber.(spec, g[\p][param]);
		max = switch(spec[2], \range, { spec[4] }, \note, { 127 }, \choice, { spec.size - 4 });
		~globals.do { |other| ~dropMapping.(other, g[\id], param) };
		gl[\mappings] = gl[\mappings].add((gen: g[\id], param: param,
			from: (from ? cur).asFloat, to: (to ?? { if(cur == max) { ~settingMin.(spec) } { max } }).asFloat,
			curve: if(~curves.includes((curve ? \linear).asSymbol)) { curve.asSymbol } { \linear },
			amount: amount !? (_.asFloat)));
		~sendMappings.(gl);
		~applyGlobal.(gl);
	};
};

~unmap = { |gl, genId, param| ~dropMapping.(gl, genId.asInteger, param.asSymbol) };

~dropMapping = { |gl, genId, param|
	if(gl[\mappings].any { |m| m[\gen] == genId and: { m[\param] == param } }) {
		gl[\mappings] = gl[\mappings].reject { |m| m[\gen] == genId and: { m[\param] == param } };
		~sendMappings.(gl);
	};
};

// A generator is gone: its mappings go.
~dropGenMappings = { |genId| ~globals.do { |gl| gl[\mappings].copy.do { |m| if(m[\gen] == genId) { ~dropMapping.(gl, genId, m[\param]) } } } };

// /gen/set from a surface or tool: a setting that follows a global is locked (the surface's control
// is put back by the echo).
~setGenByHand = { |g, key, val|
	~mappedBy.(g[\id], key) !? { |gl|
		~report.("% of generator % follows % (unmap it to set it by hand)".format(key, g[\id], gl[\name]));
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

~applyGlobal = { |gl|
	gl[\mappings].do { |m|
		var g = ~gens[m[\gen]], spec, v;
		spec = g !? { g[\type][\params].detect { |s| s[0] == m[\param] } };
		if(spec.notNil) {
			v = ~mappedValue.(m, spec, gl[\value]);
			if(g[\p][m[\param]] != v) { ~setGen.(g, m[\param], v) };
		};
	};
};

~sendGlobal = { |gl| ~send.('/global', gl[\id], gl[\name], gl[\value]) };
~sendMappings = { |gl|
	~send.('/global/mappings', gl[\id], *gl[\mappings].collect { |m| [m[\gen], m[\param], m[\from], m[\to], m[\curve], m[\amount] ? -1] }.flatten);
};
)
