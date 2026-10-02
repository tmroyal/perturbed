// json.scd — JSON out (sclang has parseJSON but no writer) and typed values back in.
//
// Written readable, for people, Claude and git diffs: an object or array that fits in `width`
// columns stays on one line (a chord, a pin, a clock), anything longer gets one entry per line,
// indented by 2.
(
~jsonWidth = 100;

~toJSON = { |x, indent = 0|
	var flat = ~jsonFlat.(x), pad = { |n| String.fill(n, $ ) };
	case
	{ (indent + flat.size) <= ~jsonWidth or: { x.isKindOf(String) } or: { x.isKindOf(Symbol) } } { flat }
	{ x.isKindOf(Dictionary) } {
		"{\n" ++ x.keys.asArray.sort.collect { |k|
			pad.(indent + 2) ++ ~jsonFlat.(k.asString) ++ ": " ++ ~toJSON.(x[k], indent + 2)
		}.join(",\n") ++ "\n" ++ pad.(indent) ++ "}"
	}
	{ x.isKindOf(SequenceableCollection) } {
		"[\n" ++ x.collect { |v| pad.(indent + 2) ++ ~toJSON.(v, indent + 2) }.join(",\n") ++ "\n" ++ pad.(indent) ++ "]"
	}
	{ flat };
};

// on one line
~jsonFlat = { |x|
	case
	{ x.isKindOf(Dictionary) } {
		"{" ++ x.keys.asArray.sort.collect { |k| ~jsonFlat.(k.asString) ++ ": " ++ ~jsonFlat.(x[k]) }.join(", ") ++ "}"
	}
	{ x.isKindOf(String) or: { x.isKindOf(Symbol) } } {
		// control characters escaped too: performance files embed AdHoc type sources (multi-line)
		"\"" ++ x.asString.replace("\\", "\\\\").replace("\"", "\\\"")
			.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") ++ "\""
	}
	{ x.isKindOf(SequenceableCollection) } { "[" ++ x.collect(~jsonFlat).join(", ") ++ "]" }
	{ x.isKindOf(Boolean) } { x.asString }
	{ x.isNil } { "null" }
	{ x.asString };
};

~writeJSON = { |path, x| File.use(path, "w", { |f| f.write(~toJSON.(x) ++ "\n") }) };

// JSON scalars arrive as strings; convert each param to the kind of its default. Numbers stay
// integers when whole and the default is an integer (so 0.5 for a param defaulting to 0 survives).
~fromJSON = { |value, default|
	var v;
	if(default.isKindOf(Number)) {
		v = value.asFloat;
		if(default.isKindOf(Integer) and: { v.frac == 0 }) { v.asInteger } { v };
	} { value.asString };
};
)
