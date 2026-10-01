// groups.scd — named groups of generators, for handling a layer of the piece as one thing and for
// hiding detail (a collapsed group shows only its header on the surface). A generator is in at most
// one group (g[\group], 0 = none); groups don't nest.
//
// A generator sounds when it is active, its group (if any) is on, and either nothing is soloed or its
// group is soloed. Off and soloed-out are mutes: routines keep running and only stop sounding (a
// held note is released), so a group comes back on the grid, in phase. `collapsed` is the
// surface's view, kept here so performance files open tidy.
(
~groups = ();
~nextGroupId = 1;

~addGroup = { |name, id|
	var gr;
	id = id ?? { ~nextGroupId };
	~nextGroupId = max(~nextGroupId, id + 1);
	gr = (id: id, name: (name ?? { "Group %".format(id) }).asString, on: true, solo: false, collapsed: false);
	~groups[id] = gr;
	~sendGroup.(gr);
	gr;
};

~setGroup = { |gr, key, val|
	switch(key.asSymbol,
		\name, { gr[\name] = val.asString },
		\on, { gr[\on] = val.asInteger == 1; ~applyGates.() },
		\solo, { gr[\solo] = val.asInteger == 1; ~applyGates.() },
		\collapsed, { gr[\collapsed] = val.asInteger == 1 });
	~sendGroup.(gr);
};

// Its generators stay, ungrouped.
~removeGroup = { |id|
	~groups.removeAt(id) !? {
		~gens.do { |g| if(g[\group] == id) { g[\group] = 0; ~sendGen.(g) } };
		~applyGates.();
		~send.('/group/removed', id);
	};
};

~sounds = { |g|
	var gr = ~groups[g[\group] ? 0];
	g[\active]
	and: { gr.isNil or: { gr[\on] } }
	and: { ~groups.any(_[\solo]).not or: { gr.notNil and: { gr[\solo] } } };
};

// After a gate changes: whatever no longer sounds lets go of its notes.
~applyGates = { ~gens.do { |g| if(~sounds.(g).not) { ~release.(g); ~releaseHeld.(g) } } };

~sendGroup = { |gr| ~send.('/group', gr[\id], gr[\name], gr[\on].binaryValue, gr[\solo].binaryValue, gr[\collapsed].binaryValue) };
)
