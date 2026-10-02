// objects.scd — what clocks, groups, destinations and generators share: each kind is an Event of
// id -> object (~clocks, ~groups, ~dests, ~gens), sent and saved in id order. Ids count up per
// kind and aren't reused in a session; a performance file brings its own (core/persist.scd).
(
~nextIds = ();

// A new object's id: `id` if given (from a file), else the next one of its kind.
~newId = { |kind, id|
	id = id ?? { ~nextIds[kind] ? 1 };
	~nextIds[kind] = max(~nextIds[kind] ? 1, id + 1);
	id;
};

~inOrder = { |objects| objects.keys.asArray.sort.collect(objects[_]) };
)
