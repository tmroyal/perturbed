// persist.scd — save/load a performance as JSON: tempo, clocks, chord, destinations, groups,
// generators, and a copy of every AdHoc type it uses (`adhoc`), so the piece sounds the same even
// if the library's version changes later (the surface then offers the library's version).
// Plugin state lives in the Live Set, not here. Loading replaces everything and stops the
// transport; generators keep their active flag, so pressing play resumes the piece.
(
~savePerformance = { |path|
	~writeJSON.(path.standardizePath, (
		tempo: ~bpm,
		chord: ~chord,
		chordMode: ~chordMode,
		clocks: ~inOrder.(~clocks).collect { |c|
			(id: c[\id], mode: c[\mode], num: c[\num], den: c[\den], factor: c[\factor], bpm: c[\bpm])
		},
		destinations: ~inOrder.(~dests),
		groups: ~inOrder.(~groups),
		globals: ~inOrder.(~globals),
		adhoc: ().putPairs(~gens.values.collect(_[\typeName]).asSet.asArray
			.reject { |name| ~library[name] !? (_[\builtin]) ? false }
			.collect { |name| [name, ~typeSource[name].split($\n)] }.flatten(1)),  // as lines: readable, diffable
		generators: ~gensInOrder.().collect { |g|  // in the performer's order, which loading keeps
			(id: g[\id], type: g[\typeName], dest: g[\dest], group: g[\group] ? 0, active: g[\active],
				collapsed: g[\collapsed] ? false, key: g[\key] ? -1, params: g[\p], mappings: g[\mappings] ? [])
		},
	));
	"saved %".format(path).postln;
};

// Stops and empties everything a performance holds (ids start over).
~clearPerformance = {
	~setPlaying.(false);
	~gens.keys.copy.do(~removeGen);
	~dests.keys.copy.do(~removeDest);
	~clocks.keys.copy.do(~removeClock);
	~groups.keys.copy.do(~removeGroup);
	~globals.keys.copy.do(~removeGlobal);
	~nextIds = ();
};

// A new, empty performance: no outputs, generators, groups, globals or extra clocks, no chord.
// The tempo stays (it's shared with Live).
~newPerformance = {
	~clearPerformance.();
	~chordMode = \auto;
	~armed = false;
	~chord = [];
	~dirty = false;
	~file = "";
	~sendState.();
};

~loadPerformance = { |path|
	var perf = File.readAllString(path.standardizePath).parseJSON, readMappings;
	~clearPerformance.();  // ids come from the file

	~setTempo.(perf["tempo"]);  // also sets Link tempo
	(perf["clocks"] ? []).do { |saved|
		var c = ~addClock.(saved["id"].asInteger);
		[\mode, \num, \den, \factor, \bpm].do { |k| saved[k.asString] !? { |v| ~setClock.(c, k, v) } };
	};
	~chordMode = if(perf["chordMode"] == "arm") { \arm } { \auto };
	~armed = false;
	~chord = (perf["chord"] ? []).collect(_.asInteger);
	perf["destinations"].do { |d| ~addDest.(d["name"], d["port"], d["channel"], d["instrument"], d["id"].asInteger) };
	(perf["groups"] ? []).do { |saved|
		var gr = ~addGroup.(saved["name"], saved["id"].asInteger);
		[\on, \solo, \collapsed].do { |k| gr[k] = saved[k.asString] == "true" };
		gr[\key] = saved["key"] !? (_.asInteger);
		gr[\pins] = (saved["pins"] ? []).collect { |p| [p[0].asInteger, p[1].asSymbol] };  // checked against the generators below
	};
	// the types it uses: AdHoc from the piece's own copies, any other from the library
	(perf["adhoc"] ? ()).keysValuesDo { |name, source|
		name = name.asSymbol;
		if(source.isKindOf(String).not) { source = source.join("\n") };  // lines (older files: one string)
		if(~typeSource[name] != source) { ~loadType.(name, source) };
		~addToBar.(name);
	};
	perf["generators"].do { |saved|
		var name = saved["type"].asSymbol;
		if(~types[name].isNil and: { ~loadType.(name) }) { ~addToBar.(name) };
	};
	perf["generators"].do { |saved|
		var id = ~addGen.(saved["type"], saved["group"] ? 0, saved["id"].asInteger);
		~gens[id] !? { |g|
			g[\type][\params].do { |spec|
				saved["params"][spec[0].asString] !? { |v| g[\p][spec[0]] = ~fromJSON.(v, spec[1]) };
			};
			g[\dest] = saved["dest"].asInteger;
			g[\active] = saved["active"] == "true";
			g[\collapsed] = saved["collapsed"] == "true";
			g[\key] = saved["key"] !? { |k| if(k.asInteger >= 0) { k.asInteger } };
		};
	};
	~groups.do { |gr| gr[\pins] = gr[\pins].select { |p| ~gens[p[0]] !? { |g| g[\group] == gr[\id] } ? false } };
	// mappings, once the generators they point at exist: of globals (values kept as saved, not
	// re-applied) and of generators that drive settings (lfo)
	readMappings = { |saved|
		(saved["mappings"] ? []).collect { |m|
			(gen: m["gen"].asInteger, param: m["param"].asSymbol, from: m["from"].asFloat, to: m["to"].asFloat,
				curve: m["curve"].asSymbol, amount: m["amount"] !? (_.asFloat))
		}.select { |m| ~gens[m[\gen]].notNil };
	};
	(perf["globals"] ? []).do { |saved|
		var gl = ~addGlobal.(saved["name"], saved["id"].asInteger, (saved["group"] ? 0).asInteger);
		gl[\value] = saved["value"].asFloat;
		gl[\knob] = saved["knob"] !? { |k| k.collect(_.asInteger) };
		gl[\response] = (saved["response"] ? \linear).asSymbol;
		gl[\formula] = (saved["formula"] ? "x").asString;
		gl[\mappings] = readMappings.(saved);
	};
	perf["generators"].do { |saved| ~gens[saved["id"].asInteger] !? { |g| g[\mappings] = readMappings.(saved) } };
	~dirty = false;
	~file = path.standardizePath;
	~sendState.();
	"loaded %".format(path).postln;
};
)
