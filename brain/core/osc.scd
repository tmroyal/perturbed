// osc.scd — the surface protocol. The brain is authoritative: surfaces send intents and render
// what the brain echoes back. Any address that sends /hello is registered as a surface.
//
// Surface → brain (port 57120, or $PERFORMED_PORT):
//   /hello                                       register; brain replies with a full snapshot
//   /ping                                        brain replies /pong to the sender only
//   /transport/play   1|0                        play restarts at beat 0
//   /transport/tempo  <bpm>
//   /chord/mode       auto|arm                   see core/chord.scd
//   /chord/arm        1|0                        in arm mode: the next chord played replaces the current one
//   /chord/set        <pitch>...                 set the current chord directly
//   /chord/clear
//   /gen/add          <type>                     brain assigns the id
//   /gen/remove       <id>
//   /gen/set          <id> <param> <value>       param = active | dest | a type param
//   /dest/add         <name> <port> <channel> <instrument>     port and channel are 1-based
//   /dest/remove      <id>
//   /save             <path>                     write the performance as JSON
//   /load             <path>                     replace everything; brain sends a full snapshot
//
// Brain → surfaces (on the sender's address):
//   /state/begin, /state/end                     frame a full snapshot
//   /pong             <bootId>                   bootId changes when the brain restarts: re-/hello
//   /transport        <playing> <bpm>
//   /ports            <name>...                  MIDI outputs; destination port n = nth name
//   /chord            <mode> <armed> <pitch>...
//   /gen/schema       <type> <param> <kind> <default> <kind args...>
//   /gen/show         <type> <param> <otherParam> <value>...   show param only for those values
//   /dest             <id> <name> <port> <channel> <instrument>
//   /dest/removed     <id>
//   /gen              <id> <type> <dest> <active>
//   /gen/param        <id> <param> <value>
//   /gen/removed      <id>
//   /beat             <beat>                     latency-aligned with the sound
//   /note             <genId> <pitch> <vel>      latency-aligned with the sound
(
~surfaces = [];
~bootId = 1000000.rand;

~send = { |...msg| ~surfaces.do { |a| a.sendMsg(*msg) } };

// Sent when the note actually sounds (MIDI is timestamped `latency` ahead of logical time).
~sendLate = { |...msg| SystemClock.sched(~config[\latency], { ~send.(*msg); nil }) };

~sendState = {
	~send.('/state/begin');
	~sendTransport.();
	~send.('/ports', *~config[\ports].collect(_.join(" ")));
	~sendChord.();
	~sendSchema.();
	~dests.keys.asArray.sort.do { |id| ~sendDest.(~dests[id]) };
	~gens.keys.asArray.sort.do { |id| ~sendGen.(~gens[id]); ~sendParams.(~gens[id]) };
	~send.('/state/end');
};

~oscInit = {
	var port = ("PERFORMED_PORT".getenv ? "57120").asInteger;
	if(NetAddr.langPort != port) {
		if(thisProcess.openUDPPort(port).not) {
			Error("port % is taken (another brain running?)".format(port)).throw;
		};
	};
	~port = port;

	OSCdef(\hello, { |msg, time, addr|
		if(~surfaces.includesEqual(addr).not) { ~surfaces = ~surfaces.add(addr) };
		~sendState.();
	}, '/hello');

	OSCdef(\ping, { |msg, time, addr| addr.sendMsg('/pong', ~bootId) }, '/ping');

	OSCdef(\play, { |msg| ~setPlaying.(msg[1].asInteger == 1) }, '/transport/play');
	OSCdef(\tempo, { |msg| ~setTempo.(msg[1]) }, '/transport/tempo');

	OSCdef(\chordMode, { |msg| ~setChordMode.(msg[1]) }, '/chord/mode');
	OSCdef(\chordArm, { |msg| ~arm.(msg[1].asInteger == 1) }, '/chord/arm');
	OSCdef(\chordSet, { |msg| ~setChord.(msg[1..]) }, '/chord/set');
	OSCdef(\chordClear, { ~setChord.([]) }, '/chord/clear');

	OSCdef(\genAdd, { |msg| ~addGen.(msg[1]) }, '/gen/add');
	OSCdef(\genRemove, { |msg| ~removeGen.(msg[1].asInteger) }, '/gen/remove');
	OSCdef(\genSet, { |msg| ~gens[msg[1].asInteger] !? { |g| ~setGen.(g, msg[2], msg[3]) } }, '/gen/set');

	OSCdef(\destAdd, { |msg| ~addDest.(msg[1], msg[2], msg[3], msg[4] ? "") }, '/dest/add');
	OSCdef(\destRemove, { |msg| ~removeDest.(msg[1].asInteger) }, '/dest/remove');

	OSCdef(\save, { |msg| ~savePerformance.(msg[1].asString) }, '/save');
	OSCdef(\load, { |msg|
		try { ~loadPerformance.(msg[1].asString) } { |e| "load failed: %".format(e.errorString).warn };
	}, '/load');
};
)
