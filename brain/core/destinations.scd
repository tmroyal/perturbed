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

// Live's MIDI tracks listening to the brain's buses, as reported by the Perturbed Bridge:
// flat [name, port, channel, instrument, ...] (channel 0 = all channels); nil = no bridge.
// The surface offers them as outputs.
~liveTracks = nil;
~setLiveTracks = { |args| ~liveTracks = args; ~sendLiveTracks.() };
~sendLiveTracks = { if(~liveTracks.isNil) { ~send.('/live/tracks/clear') } { ~send.('/live/tracks', *~liveTracks) } };

~sendDest = { |d| ~send.('/dest', d[\id], d[\name], d[\port], d[\channel], d[\instrument]) };)
