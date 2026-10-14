// loop — records what's played on the keyboard and plays it back as a loop, transformed.
// Record (the strip switches on and listens; what you play goes through to its output), play, Done:
// the loop is everything from the first note to Done, its length rounded to the nearest `round`
// beats. Recorded while the transport plays, the loop starts at the last `round` line before the
// first note, so it keeps its place against everything else; recorded with the transport stopped,
// it starts at the first note. `snap` moves each note to the nearest of that many points per beat
// when the loop is made (0 leaves the timing as played).
// It plays while it's on and the transport runs, in step with the grid, and is transformed as it
// plays (the recording itself stays as it is):
//   time × num/den   1/2 is diminution, every time and length halved, the loop twice as often;
//                    2/1 augmentation
//   octaves, semitones   transposition
// `holds` says what it holds. Clear empties it.
(
params: [
	[\status, "empty", \text],              // written by the generator: what it holds
	[\round, 4, \range, 0.25, 64, 0.25],
	[\snap, 0, \range, 0, 12],
	[\thru, "on", \choice, "on", "off"],
	[\num, 1, \range, 1, 32], [\den, 1, \range, 1, 32],
	[\octave, 0, \range, -4, 4],
	[\semitone, 0, \range, -12, 12],
	[\data, "", \text],                     // the loop itself (length; beat note velocity length; ...): saved, not shown
	~clockParam,
],
labels: (status: "holds", round: "length to nearest (beats)", snap: "snap (per beat)", thru: "hear it while recording",
	num: "time ×", octave: "octaves", semitone: "semitones"),
sections: (status: "Loop", round: "Recording", num: "Playback", clock: "Clock"),
showWhen: (data: [\thru, "never shown"]),  // (no value of thru is that: the data stays out of sight)
restartOn: [\clock],
onChange: (data: { |g| ~restart.(g) }),    // a new loop (recorded, cleared, set from outside): play that

// the loop from its text: [length in beats, [[beat, note, velocity, length], ...]]; kept until the text changes
read: { |g, p|
	var text = p[\data].asString, parts;
	if(g[\cache].isNil or: { g[\cache][0] != text }) {
		parts = text.split($;).collect { |s| s.split($ ).reject(_.isEmpty).collect(_.asFloat) };
		g[\cache] = [text, if(parts.isEmpty or: { parts[0].isEmpty }) { [0, []] } {
			[parts[0][0], parts.drop(1).select { |e| e.size == 4 }]
		}];
	};
	g[\cache][1];
},

// where recording is in time, in beats of its clock: on the grid while the transport plays, by
// the wall clock at the clock's tempo while it's stopped
beat: { |g, p|
	var c = ~clockOf.(p[\clock] ? 0), saved = ~clocks[(p[\clock] ? 0).asInteger];
	if(~playing and: { c.notNil }) { c.beats - (if(c === ~clock) { ~origin } { 0 }) } {
		Main.elapsedTime * (if(saved.notNil) { ~clockTempo.(saved) } { ~bpm }) / 60;
	};
},

actionOrder: [\Record, \Done, \Clear],
actions: (
	Record: { |g, p|
		~silence.(g);
		~setGen.(g, \data, "");
		g[\rec] = (t0: nil, notes: List[], open: ());
		if(g[\active].not) { ~setGen.(g, \active, 1) };  // it listens while it's on
		~setGen.(g, \status, "recording: play, then Done");
	},
	Done: { |g, p|
		g[\rec] !? { |rec|
			var now = g[\type][\beat].(g, p), unit = p[\round].asFloat.max(0.25), snap = p[\snap].asInteger, len, notes;
			~releaseHeld.(g);
			g[\rec] = nil;
			if(rec[\t0].isNil) { ~setGen.(g, \status, "empty") } {
				rec[\open].keysValuesDo { |note, on| rec[\notes].add([on[0], note, on[1], now - rec[\t0] - on[0]]) };  // keys still down
				len = (((now - rec[\t0]) / unit).round.max(1)) * unit;
				notes = rec[\notes].collect { |e|
					var b = if(snap > 0) { (e[0] * snap).round / snap } { e[0] };
					[b % len, e[1], e[2], e[3].max(0.05)];
				}.asArray.sort { |a, b| a[0] < b[0] };
				~setGen.(g, \data, ([[len]] ++ notes).collect { |e| e.collect { |x| x.round(0.0001) }.join(" ") }.join(";"));
				~setGen.(g, \status, "% notes, % beats".format(notes.size, len.round(0.01)));
			};
		};
	},
	Clear: { |g, p| g[\rec] = nil; ~silence.(g); ~setGen.(g, \data, ""); ~setGen.(g, \status, "empty") },
),

// recording: the notes with their times; and through to its output, to hear what's being played
key: { |g, p, note, vel|
	g[\rec] !? { |rec|
		var now = g[\type][\beat].(g, p), d = ~dests[g[\dest]];
		if(vel > 0) {
			if(rec[\t0].isNil) {
				// with the transport playing the loop starts on the last `round` line, keeping its place
				rec[\t0] = if(~playing) { (now / p[\round].asFloat.max(0.25)).floor * p[\round].asFloat.max(0.25) } { now };
			};
			rec[\open][note] = [now - rec[\t0], vel];
			if(p[\thru].asString == "on" and: { d.notNil } and: { ~sounds.(g) }) {
				g[\held][note] !? { |h| ~noteOff.(h[0], h[1], true) };
				~noteOn.(d, note, vel, true);
				g[\held][note] = [d, note];
			};
			~send.('/note', g[\id], note, vel);
		} {
			rec[\open].removeAt(note) !? { |on| rec[\notes].add([on[0], note, on[1], now - rec[\t0] - on[0]]) };
			g[\held].removeAt(note) !? { |h| ~noteOff.(h[0], h[1], true) };
		};
	};
},

// playback: every pass of the (stretched) loop schedules its notes; they are transposed as they play
run: { |g, p|
	var loop = g[\type][\read].(g, p), len = loop[0], notes = loop[1], pass = 0;
	var id = (g[\runs] ? 0) + 1;
	var alive = { g[\runs] == id and: { g[\task].notNil } };
	g[\runs] = id;
	if(len <= 0 or: { notes.isEmpty } or: { g[\rec].notNil }) { inf.wait };  // nothing to play (a new loop restarts it)
	~grid.({ len * p[\num] / p[\den] }, { |k|
		var scale = p[\num] / p[\den];
		pass = pass + 1;
		notes.do { |e, i|
			var key = "%-%".format(pass, i).asSymbol;
			thisThread.clock.sched(e[0] * scale, {
				var d = ~dests[g[\dest]], out = e[1].asInteger + (12 * p[\octave].asInteger) + p[\semitone].asInteger;
				if(alive.() and: { d.notNil } and: { ~sounds.(g) } and: { out.inclusivelyBetween(0, 127) }) {
					~noteOn.(d, out, e[2].asInteger.clip(1, 127));
					g[\held][key] = [d, out];
					~sendLate.('/note', g[\id], out, e[2].asInteger);
					thisThread.clock.sched((e[3] * scale).max(0.02), {
						g[\held].removeAt(key) !? { |h| ~noteOff.(h[0], h[1]) };
						nil;
					});
				};
				nil;
			});
		};
	});
},
)
