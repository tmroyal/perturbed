// destinations.scd — (port, channel) pairs a generator can play into; one REAPER track each.
// Changes are written to reaper/destinations.json for reaper/setup.lua.
(
~dests = ();
~nextDestId = 1;

~addDest = { |name, port, channel, instrument|
	var id = ~nextDestId;
	~nextDestId = id + 1;
	~dests[id] = (
		id: id,
		name: name.asString,
		port: port.asInteger.clip(1, ~config[\ports].size),
		channel: channel.asInteger.clip(1, 16),
		instrument: instrument.asString,
	);
	~sendDest.(~dests[id]);
	~writeDestinations.();
	id;
};

~removeDest = { |id|
	~dests.removeAt(id) !? {
		~gens.do { |g| if(g[\dest] == id) { ~release.(g); ~releaseHeld.(g); g[\dest] = 0; ~sendGen.(g) } };
		~send.('/dest/removed', id);
		~writeDestinations.();
	};
};

~sendDest = { |d| ~send.('/dest', d[\id], d[\name], d[\port], d[\channel], d[\instrument]) };

~writeDestinations = {
	if(~testMode.not) {
		~writeJSON.(~root.dirname +/+ "reaper/destinations.json", (
			ports: ~config[\ports].collect(_.join(" ")),
			destinations: ~dests.keys.asArray.sort.collect(~dests[_]),
		));
	};
};
)
