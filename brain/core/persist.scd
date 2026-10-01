// persist.scd — save/load a performance as JSON: tempo, clocks, chord, destinations, groups,
// generators.
// Plugin state lives in the Live Set, not here. Loading replaces everything and stops the
// transport; generators keep their active flag, so pressing play resumes the piece.
(
~savePerformance = { |path|
	~writeJSON.(path.standardizePath, (
		tempo: ~bpm,
		chord: ~chord,
		chordMode: ~chordMode,
		clocks: ~clocks.keys.asArray.sort.collect { |id|
			var c = ~clocks[id];
			(id: id, mode: c[\mode], num: c[\num], den: c[\den], factor: c[\factor], bpm: c[\bpm])
		},
		destinations: ~dests.keys.asArray.sort.collect(~dests[_]),
		groups: ~groups.keys.asArray.sort.collect(~groups[_]),
		generators: ~gens.keys.asArray.sort.collect { |id|
			var g = ~gens[id];
			(id: id, type: g[\typeName], dest: g[\dest], group: g[\group] ? 0, active: g[\active], params: g[\p])
		},
	));
	"saved %".format(path).postln;
};

~loadPerformance = { |path|
	var perf = File.readAllString(path.standardizePath).parseJSON;
	~setPlaying.(false);
	~gens.keys.copy.do { |id| ~removeGen.(id) };
	~dests.keys.copy.do { |id| ~removeDest.(id) };
	~clocks.keys.copy.do { |id| ~removeClock.(id) };
	~groups.keys.copy.do { |id| ~removeGroup.(id) };

	~setTempo.(perf["tempo"]);  // also sets Link tempo
	~nextClockId = 1;
	(perf["clocks"] ? []).do { |saved|
		var c = ~addClock.(saved["id"].asInteger);
		[\mode, \num, \den, \factor, \bpm].do { |k| saved[k.asString] !? { |v| ~setClock.(c, k, v) } };
	};
	~chordMode = if(perf["chordMode"] == "arm") { \arm } { \auto };
	~armed = false;
	~chord = (perf["chord"] ? []).collect(_.asInteger);
	perf["destinations"].do { |d|
		~nextDestId = d["id"].asInteger;
		~addDest.(d["name"], d["port"], d["channel"], d["instrument"]);
	};
	~nextGroupId = 1;
	(perf["groups"] ? []).do { |saved|
		var gr = ~addGroup.(saved["name"], saved["id"].asInteger);
		[\on, \solo, \collapsed].do { |k| gr[k] = saved[k.asString] == "true" };
	};
	perf["generators"].do { |saved|
		var id, g;
		~nextGenId = saved["id"].asInteger;
		id = ~addGen.(saved["type"]);
		(g = ~gens[id]) !? {
			g[\type][\params].do { |spec|
				saved["params"][spec[0].asString] !? { |v| g[\p][spec[0]] = ~fromJSON.(v, spec[1]) };
			};
			g[\dest] = saved["dest"].asInteger;
			g[\group] = if(~groups.includesKey((saved["group"] ? 0).asInteger)) { saved["group"].asInteger } { 0 };
			g[\active] = saved["active"] == "true";
		};
	};
	~nextDestId = (~dests.keys.maxItem ? 0) + 1;
	~nextGenId = (~gens.keys.maxItem ? 0) + 1;
	~sendState.();
	"loaded %".format(path).postln;
};
)
