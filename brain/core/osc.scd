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
//   /gen/set          <id> <param> <value>       param = active | dest | group | collapsed | a type param
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
//   /global/add       [<name>]                   a global parameter ("Meta n" by default); core/globals.scd
//   /global/set       <id> name|value <v>        value 0–1 moves every mapped setting
//   /global/remove    <id>
//   /global/map       <id> <genId> <param> [<from> <to> <curve> <amount>]   add or update a mapping
//   /global/unmap     <id> <genId> <param>
//   /global/learn     <id> 1|0                   the next knob turned (control change) drives it
//   /global/knob      <id> <channel> <cc>        set its knob; channel 0 = none
//   /cc               <port> <channel> <cc> <value>   one control change now; port = control bus 1, 2, ...
//   /adhoc/load       <name>                     load (or reload) a library type: rescans adhoc/, then
//                                                a full snapshot and /adhoc/loaded (or /error)
//   /adhoc/delete     <name>                     an AdHoc type's file moves to adhoc/old/; full snapshot
//                                                and /adhoc/deleted (or /error: built in, or in use)
//   /library/rescan                              re-read the library (new files); full snapshot
//   /favorite         <name> 1|0                 star a type (the add bar); full snapshot
//   /live/tracks      (<name> <port> <channel> <instrument>)...   from the Perturbed Bridge: Live's
//                                                MIDI tracks on the brain's buses (channel 0 = all)
//   /live/tracks/clear                           the bridge is gone
//   /new                                         a new, empty performance; brain sends a full snapshot
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
//   /library/type     <name> <builtin> <favorite> <loaded> <onBar> <changed> <description> <mtime>
//                                                every library type (changed: the file differs from
//                                                what's loaded: reload to update)
//   /adhoc/loaded     <name>
//   /adhoc/deleted    <name>
//   /gen/schema       <type> <param> <kind> <default> <kind args...>   (loaded types only)
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
//   /gen              <id> <type> <dest> <active> <group> <collapsed>
//   /group            <id> <name> <on> <solo> <collapsed>
//   /group/removed    <id>
//   /global           <id> <name> <value> <knobChannel> <knobCC>    knob channel 0 = none
//   /global/learn     <id> 1|0                   learning a knob started / ended
//   /global/mappings  <id> (<genId> <param> <from> <to> <curve> <amount>)...   amount -1 = default
//   /global/removed   <id>
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

// An intent failed: to the log and to every surface (tools/perturbed shows it, the app's status bar too).
~report = { |text| text.warn; ~send.('/error', text) };

// Where to answer: the sender, or the port named in msg[1].
~replyAddr = { |msg, addr| msg[1] !? { |port| NetAddr(addr.ip, port.asInteger) } ? addr };

~sendState = {
	~send.('/state/begin');
	~sendTransport.();
	~send.('/ports', *~config[\ports].collect(_.join(" ")));
	~sendChord.();
	~sendSchema.();
	~sendLibrary.();
	~inOrder.(~clocks).do(~sendClock);
	~inOrder.(~groups).do(~sendGroup);
	~inOrder.(~dests).do(~sendDest);
	~sendLiveTracks.();
	~inOrder.(~gens).do { |g| ~sendGen.(g); ~sendParams.(g) };
	~inOrder.(~groups).do(~sendPins);  // after the generators they point at
	~inOrder.(~globals).do { |gl| ~sendGlobal.(gl); ~sendMappings.(gl) };
	~send.('/state/end');
};

// An intent for one object, `<addr> <id> <args...>` (objects: \gens, \groups, ...): calls the
// function named `fn` with the object and the args. Unknown ids are ignored.
~onObject = { |addr, objects, fn|
	OSCdef(addr, { |msg| objects.envirGet[msg[1].asInteger] !? { |o| fn.envirGet.(o, *msg[2..]) } }, addr);
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
	~onObject.('/gen/set', \gens, \setGenByHand);  // refused for settings that follow a global
	~onObject.('/gen/do', \gens, \genDo);

	OSCdef(\groupAdd, { |msg| ~addGroup.(msg[1]) }, '/group/add');
	OSCdef(\groupRemove, { |msg| ~removeGroup.(msg[1].asInteger) }, '/group/remove');
	~onObject.('/group/set', \groups, \setGroup);
	~onObject.('/group/pin', \groups, \pin);
	~onObject.('/group/unpin', \groups, \unpin);

	OSCdef(\clockAdd, { ~addClock.() }, '/clock/add');
	OSCdef(\clockRemove, { |msg| ~removeClock.(msg[1].asInteger) }, '/clock/remove');
	~onObject.('/clock/set', \clocks, \setClock);

	OSCdef(\destAdd, { |msg| ~addDest.(msg[1], msg[2], msg[3], msg[4] ? "") }, '/dest/add');
	OSCdef(\destRemove, { |msg| ~removeDest.(msg[1].asInteger) }, '/dest/remove');

	OSCdef(\adhocLoad, { |msg| if(~useType.(msg[1])) { ~sendState.(); ~send.('/adhoc/loaded', msg[1].asSymbol) } }, '/adhoc/load');
	OSCdef(\adhocDelete, { |msg| if(~deleteType.(msg[1])) { ~sendState.(); ~send.('/adhoc/deleted', msg[1].asSymbol) } }, '/adhoc/delete');
	OSCdef(\libraryRescan, { ~scanLibrary.(); ~sendState.() }, '/library/rescan');
	OSCdef(\favorite, { |msg| ~setFavorite.(msg[1], msg[2].asInteger == 1) }, '/favorite');
	OSCdef(\cc, { |msg| ~cc.(msg[1], msg[2], msg[3], msg[4], true) }, '/cc');
	OSCdef(\liveTracks, { |msg| ~setLiveTracks.(msg[1..].collect { |x| if(x.isKindOf(Symbol)) { x.asString } { x } }) }, '/live/tracks');
	OSCdef(\liveTracksClear, { ~setLiveTracks.(nil) }, '/live/tracks/clear');

	OSCdef(\globalAdd, { |msg| ~addGlobal.(msg[1]) }, '/global/add');
	OSCdef(\globalRemove, { |msg| ~removeGlobal.(msg[1].asInteger) }, '/global/remove');
	~onObject.('/global/set', \globals, \setGlobal);
	~onObject.('/global/map', \globals, \map);
	~onObject.('/global/unmap', \globals, \unmap);
	~onObject.('/global/learn', \globals, \learnKnob);
	~onObject.('/global/knob', \globals, \setKnob);

	OSCdef(\new, { ~newPerformance.() }, '/new');
	OSCdef(\save, { |msg|
		try { ~savePerformance.(msg[1].asString); ~send.('/saved', msg[1].asString) } { |e| ~report.("save failed: " ++ e.errorString) };
	}, '/save');
	OSCdef(\load, { |msg| try { ~loadPerformance.(msg[1].asString) } { |e| ~report.("load failed: " ++ e.errorString) } }, '/load');
};
)
