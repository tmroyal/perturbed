// json.scd — JSON out (sclang has parseJSON but no writer) and typed values back in.
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

// JSON scalars arrive as strings; convert each param to the type of its default.
~fromJSON = { |value, default|
	case
	{ default.isKindOf(Integer) } { value.asFloat.round.asInteger }
	{ default.isKindOf(Float) } { value.asFloat }
	{ value.asString };
};
)
