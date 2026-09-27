// osc.scd — the surface protocol. The brain is authoritative: surfaces send intents and render
// what the brain echoes back. Any address that sends /hello is registered as a surface.
//
// Surface → brain (port 57120):
//   /hello                                       register; brain replies with a full snapshot
//   /transport/play   1|0                        play restarts at beat 0
//   /transport/tempo  <bpm>
//   /gen/add          <type>                     brain assigns the id
//   /gen/remove       <id>
//   /gen/set          <id> <param> <value>       param = active | dest | a type param
//   /dest/add         <name> <port> <channel> <instrument>     port and channel are 1-based
//   /dest/remove      <id>
//
// Brain → surfaces (on the sender's address):
//   /state/begin, /state/end                     frame a full snapshot
//   /transport        <playing> <bpm>
//   /gen/schema       <type> <param> <kind> <default> <kind args...>
//   /dest             <id> <name> <port> <channel> <instrument>
//   /dest/removed     <id>
//   /gen              <id> <type> <dest> <active>
//   /gen/param        <id> <param> <value>
//   /gen/removed      <id>
//   /beat             <beat>                     latency-aligned with the sound
//   /note             <genId> <pitch> <vel>      latency-aligned with the sound
(
~surfaces = [];

~send = { |...msg| ~surfaces.do { |a| a.sendMsg(*msg) } };

// Sent when the note actually sounds (MIDI is timestamped `latency` ahead of logical time).
~sendLate = { |...msg| SystemClock.sched(~config[\latency], { ~send.(*msg); nil }) };

~sendState = {
	~send.('/state/begin');
	~sendTransport.();
	~sendSchema.();
	~dests.keys.asArray.sort.do { |id| ~sendDest.(~dests[id]) };
	~gens.keys.asArray.sort.do { |id| ~sendGen.(~gens[id]); ~sendParams.(~gens[id]) };
	~send.('/state/end');
};

~oscInit = {
	if(NetAddr.langPort != 57120) {
		if(thisProcess.openUDPPort(57120).not) {
			"port 57120 is taken (another sclang?); surfaces won't reach the brain".warn;
		};
	};

	OSCdef(\hello, { |msg, time, addr|
		if(~surfaces.includesEqual(addr).not) { ~surfaces = ~surfaces.add(addr) };
		~sendState.();
	}, '/hello');

	OSCdef(\play, { |msg| ~setPlaying.(msg[1].asInteger == 1) }, '/transport/play');
	OSCdef(\tempo, { |msg| ~setTempo.(msg[1]) }, '/transport/tempo');

	OSCdef(\genAdd, { |msg| ~addGen.(msg[1]) }, '/gen/add');
	OSCdef(\genRemove, { |msg| ~removeGen.(msg[1].asInteger) }, '/gen/remove');
	OSCdef(\genSet, { |msg| ~gens[msg[1].asInteger] !? { |g| ~setGen.(g, msg[2], msg[3]) } }, '/gen/set');

	OSCdef(\destAdd, { |msg| ~addDest.(msg[1], msg[2], msg[3], msg[4] ? "") }, '/dest/add');
	OSCdef(\destRemove, { |msg| ~removeDest.(msg[1].asInteger) }, '/dest/remove');
};
)
