// json.scd — JSON out (sclang has parseJSON but no writer) and typed values back in.
(
~toJSON = { |x|
	case
	{ x.isKindOf(Dictionary) } {
		"{" ++ x.keys.asArray.sort.collect { |k| ~toJSON.(k.asString) ++ ": " ++ ~toJSON.(x[k]) }.join(", ") ++ "}"
	}
	{ x.isKindOf(String) or: { x.isKindOf(Symbol) } } {
		// control characters escaped too: performance files embed AdHoc type sources (multi-line)
		"\"" ++ x.asString.replace("\\", "\\\\").replace("\"", "\\\"")
			.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") ++ "\""
	}
	{ x.isKindOf(SequenceableCollection) } { "[" ++ x.collect(~toJSON).join(", ") ++ "]" }
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
