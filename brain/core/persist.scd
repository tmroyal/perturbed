// persist.scd — save/load a performance as JSON: tempo, chord, destinations, generators.
// Plugin state lives in the REAPER project, not here. Loading replaces everything and stops the
// transport; generators keep their active flag, so pressing play resumes the piece.
(
~toJSON = { |x|
	case
	{ x.isKindOf(Dictionary) } {
		"{" ++ x.keys.asArray.sort.collect { |k| ~toJSON.(k.asString) ++ ": " ++ ~toJSON.(x[k]) }.join(", ") ++ "}"
	}
	{ x.isKindOf(String) or: { x.isKindOf(Symbol) } } {
		"\"" ++ x.asString.replace("\\", "\\\\").replace("\"", "\\\"") ++ "\""
	}
	{ x.isKindOf(SequenceableCollection) } { "[" ++ x.collect(~toJSON).join(", ") ++ "]" }
	{ x.isKindOf(Boolean) } { x.asString }
	{ x.isNil } { "null" }
	{ x.asString };
};

~writeJSON = { |path, x| File.use(path, "w", { |f| f.write(~toJSON.(x) ++ "\n") }) };

~savePerformance = { |path|
	~writeJSON.(path.standardizePath, (
		tempo: ~bpm,
		chord: ~chord,
		chordMode: ~chordMode,
		destinations: ~dests.keys.asArray.sort.collect(~dests[_]),
		generators: ~gens.keys.asArray.sort.collect { |id|
			var g = ~gens[id];
			(id: id, type: g[\typeName], dest: g[\dest], active: g[\active], params: g[\p])
		},
	));
	"saved %".format(path).postln;
};

// JSON scalars arrive as strings; convert each param to the type of its default.
~fromJSON = { |value, default|
	case
	{ default.isKindOf(Integer) } { value.asFloat.round.asInteger }
	{ default.isKindOf(Float) } { value.asFloat }
	{ value.asString };
};

~loadPerformance = { |path|
	var perf = File.readAllString(path.standardizePath).parseJSON;
	~setPlaying.(false);
	~gens.keys.copy.do { |id| ~removeGen.(id) };
	~dests.keys.copy.do { |id| ~removeDest.(id) };

	~bpm = perf["tempo"].asFloat;
	~chordMode = if(perf["chordMode"] == "arm") { \arm } { \auto };
	~armed = false;
	~chord = (perf["chord"] ? []).collect(_.asInteger);
	perf["destinations"].do { |d|
		~nextDestId = d["id"].asInteger;
		~addDest.(d["name"], d["port"], d["channel"], d["instrument"]);
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
			g[\active] = saved["active"] == "true";
		};
	};
	~nextDestId = (~dests.keys.maxItem ? 0) + 1;
	~nextGenId = (~gens.keys.maxItem ? 0) + 1;
	~sendState.();
	"loaded %".format(path).postln;
};
)
