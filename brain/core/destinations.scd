// destinations.scd — (port, channel) pairs a generator can play into ("outputs"); each is a Live
// MIDI track listening to that IAC bus and channel.
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
	id;
};

~removeDest = { |id|
	~dests.removeAt(id) !? {
		~gens.do { |g| if(g[\dest] == id) { ~release.(g); ~releaseHeld.(g); g[\dest] = 0; ~sendGen.(g) } };
		~send.('/dest/removed', id);
	};
};

~sendDest = { |d| ~send.('/dest', d[\id], d[\name], d[\port], d[\channel], d[\instrument]) };)
