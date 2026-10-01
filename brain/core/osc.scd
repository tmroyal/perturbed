// osc.scd — the surface protocol. The brain is authoritative: surfaces send intents and render
// what the brain echoes back. Any address that sends /hello is registered as a surface.
//
// Surface → brain (port 57120, or $PERFORMED_PORT):
//   /hello            [<port>]                   register; brain replies with a full snapshot
//                                                (to <port> if given: for senders like Max's udpsend,
//                                                whose source port isn't the one they listen on)
//   /bye              [<port>]                   unregister (short-lived surfaces: tools/perturbed)
//   /ping             [<port>]                   brain replies /pong to the sender only
//   /transport/play   1|0                        play restarts at beat 0
//   /transport/tempo  <bpm>
//   /transport/scale  <num> <den>                tempo × num/den (metric modulation)
//   /chord/mode       auto|arm                   see core/chord.scd
//   /chord/arm        1|0                        in arm mode: the next chord played replaces the current one
//   /chord/set        <pitch>...                 set the current chord directly
//   /chord/clear
//   /gen/add          <type> [<group>]           brain assigns the id; optionally into a group
//   /gen/remove       <id>
//   /gen/set          <id> <param> <value>       param = active | dest | group | a type param
//   /gen/learn        <id> <param> 1|0           the next key played sets param
//   /group/add        [<name>]                   brain assigns the id
//   /group/set        <id> name|on|solo|collapsed <value>     see core/groups.scd
//   /group/remove     <id>                       its generators stay, ungrouped
//   /group/pin        <id> <genId> <param>       show a member's setting on the group's header
//   /group/unpin      <id> <genId> <param>
//   /clock/add                                   brain assigns the id and name (B, C, ...)
//   /clock/set        <id> mode|num|den|factor|bpm <value>     see core/clock.scd
//   /clock/remove     <id>
//   /dest/add         <name> <port> <channel> <instrument>     port and channel are 1-based
//   /dest/remove      <id>
//   /gen/do           <id> <action>              run one of the type's actions (a card button)
//   /cc               <port> <channel> <cc> <value>   one control change now; port = control bus 1, 2, ...
//   /live/tracks      (<name> <port> <channel> <instrument>)...   from the Perturbed Bridge: Live's
//                                                MIDI tracks on the brain's buses (channel 0 = all)
//   /live/tracks/clear                           the bridge is gone
//   /save             <path>                     write the performance as JSON
//   /load             <path>                     replace everything; brain sends a full snapshot
//
// Brain → surfaces (on the sender's address):
//   /state/begin, /state/end                     frame a full snapshot
//   /pong             <bootId>                   bootId changes when the brain restarts: re-/hello
//   /saved            <path>                     a /save was written
//   /error            <message>                  an intent failed (e.g. /load of a bad file)
//   /transport        <playing> <bpm>
//   /ports            <name>...                  MIDI outputs; destination port n = nth name
//   /chord            <mode> <armed> <pitch>...
//   /gen/schema       <type> <param> <kind> <default> <kind args...>
//   /gen/show         <type> <param> <otherParam> <value>...   show param only for those values
//   /gen/label        <type> <param> <label>     display name
//   /gen/action       <type> <name>              the type has an action: show a button
//   /gen/slider       <type> <param> lin|log     show the param as a slider
//   /gen/nooutput     <type>                     the type plays into no output (hide the output menu)
//   /gen/section      <type> <param> <title>     param starts a new titled group
//   /gen/learn        <id> <param> 1|0           learning started / ended
//   /clock            <id> <name> <mode> <num> <den> <factor> <bpm> <tempo>   tempo = effective bpm
//   /clock/removed    <id>
//   /dest             <id> <name> <port> <channel> <instrument>
//   /dest/removed     <id>
//   /live/tracks      (<name> <port> <channel> <instrument>)...   as received from the bridge
//   /live/tracks/clear                           no bridge (Live's tracks unknown)
//   /gen              <id> <type> <dest> <active> <group>
//   /group            <id> <name> <on> <solo> <collapsed>
//   /group/removed    <id>
//   /group/pins       <id> (<genId> <param>)...  the group's pins, in order
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

// Where to answer: the sender, or the port named in msg[1].
~replyAddr = { |msg, addr| msg[1] !? { |port| NetAddr(addr.ip, port.asInteger) } ? addr };

~sendState = {
	~send.('/state/begin');
	~sendTransport.();
	~send.('/ports', *~config[\ports].collect(_.join(" ")));
	~sendChord.();
	~sendSchema.();
	~clocks.keys.asArray.sort.do { |id| ~sendClock.(~clocks[id]) };
	~groups.keys.asArray.sort.do { |id| ~sendGroup.(~groups[id]) };
	~dests.keys.asArray.sort.do { |id| ~sendDest.(~dests[id]) };
	~sendLiveTracks.();
	~gens.keys.asArray.sort.do { |id| ~sendGen.(~gens[id]); ~sendParams.(~gens[id]) };
	~groups.keys.asArray.sort.do { |id| ~sendPins.(~groups[id]) };  // after the generators they point at
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
		addr = ~replyAddr.(msg, addr);
		if(~surfaces.includesEqual(addr).not) { ~surfaces = ~surfaces.add(addr) };
		~sendState.();
	}, '/hello');

	OSCdef(\bye, { |msg, time, addr| addr = ~replyAddr.(msg, addr); ~surfaces = ~surfaces.reject(_ == addr) }, '/bye');

	OSCdef(\ping, { |msg, time, addr| ~replyAddr.(msg, addr).sendMsg('/pong', ~bootId) }, '/ping');

	OSCdef(\play, { |msg| ~setPlaying.(msg[1].asInteger == 1) }, '/transport/play');
	OSCdef(\tempo, { |msg| ~setTempo.(msg[1]) }, '/transport/tempo');
	OSCdef(\scale, { |msg| ~scaleTempo.(msg[1], msg[2]) }, '/transport/scale');

	OSCdef(\chordMode, { |msg| ~setChordMode.(msg[1]) }, '/chord/mode');
	OSCdef(\chordArm, { |msg| ~arm.(msg[1].asInteger == 1) }, '/chord/arm');
	OSCdef(\chordSet, { |msg| ~setChord.(msg[1..]) }, '/chord/set');
	OSCdef(\chordClear, { ~setChord.([]) }, '/chord/clear');

	OSCdef(\genAdd, { |msg| ~addGen.(msg[1], msg[2] ? 0) }, '/gen/add');
	OSCdef(\genRemove, { |msg| ~removeGen.(msg[1].asInteger) }, '/gen/remove');
	OSCdef(\genLearn, { |msg| ~learnGen.(msg[1].asInteger, msg[2], msg[3].asInteger == 1) }, '/gen/learn');
	OSCdef(\genSet, { |msg| ~gens[msg[1].asInteger] !? { |g| ~setGen.(g, msg[2], msg[3]) } }, '/gen/set');

	OSCdef(\groupAdd, { |msg| ~addGroup.(msg[1]) }, '/group/add');
	OSCdef(\groupSet, { |msg| ~groups[msg[1].asInteger] !? { |gr| ~setGroup.(gr, msg[2], msg[3]) } }, '/group/set');
	OSCdef(\groupPin, { |msg| ~groups[msg[1].asInteger] !? { |gr| ~pin.(gr, msg[2], msg[3]) } }, '/group/pin');
	OSCdef(\groupUnpin, { |msg| ~groups[msg[1].asInteger] !? { |gr| ~unpin.(gr, msg[2], msg[3]) } }, '/group/unpin');
	OSCdef(\groupRemove, { |msg| ~removeGroup.(msg[1].asInteger) }, '/group/remove');

	OSCdef(\clockAdd, { ~addClock.() }, '/clock/add');
	OSCdef(\clockSet, { |msg| ~clocks[msg[1].asInteger] !? { |c| ~setClock.(c, msg[2], msg[3]) } }, '/clock/set');
	OSCdef(\clockRemove, { |msg| ~removeClock.(msg[1].asInteger) }, '/clock/remove');

	OSCdef(\destAdd, { |msg| ~addDest.(msg[1], msg[2], msg[3], msg[4] ? "") }, '/dest/add');
	OSCdef(\genDo, { |msg|
		~gens[msg[1].asInteger] !? { |g| g[\type][\actions] !? { |acts| acts[msg[2].asSymbol] !? { |fn| fn.(g, g[\p]) } } };
	}, '/gen/do');
	OSCdef(\cc, { |msg| ~cc.(msg[1], msg[2], msg[3], msg[4], true) }, '/cc');
	OSCdef(\liveTracks, { |msg| ~setLiveTracks.(msg[1..].collect { |x| if(x.isKindOf(Symbol)) { x.asString } { x } }) }, '/live/tracks');
	OSCdef(\liveTracksClear, { ~setLiveTracks.(nil) }, '/live/tracks/clear');
	OSCdef(\destRemove, { |msg| ~removeDest.(msg[1].asInteger) }, '/dest/remove');

	OSCdef(\save, { |msg|
		try { ~savePerformance.(msg[1].asString); ~send.('/saved', msg[1].asString) } { |e|
			"save failed: %".format(e.errorString).warn; ~send.('/error', "save failed: " ++ e.errorString);
		};
	}, '/save');
	OSCdef(\load, { |msg|
		try { ~loadPerformance.(msg[1].asString) } { |e|
			"load failed: %".format(e.errorString).warn; ~send.('/error', "load failed: " ++ e.errorString);
		};
	}, '/load');
};
)
