// passthrough — plays the keyboard into its destination, transposed by octave + semitone. Only
// keys from lo to hi pass (a cheap MIDI zone); others are dropped. Notes go out immediately, or
// `delay` beats of the main tempo later (note-offs too, so lengths are kept), and work whether or
// not the transport runs. A note-off goes to the pitch its note-on sounded, even if the transpose
// changed in between.
(
params: [
	[\octave, 0, \range, -4, 4],
	[\semitone, 0, \range, -12, 12],
	[\lo, 0, \note],
	[\hi, 127, \note],
	[\delay, 0, \range, 0, 16, 0.25],
],

labels: (octave: "octaves", semitone: "semitones", lo: "lowest", hi: "highest", delay: "beats"),
sections: (octave: "Transpose", lo: "Zone", delay: "Delay"),

key: { |g, p, note, vel|
	var d = ~dests[g[\dest]], out = note + (12 * p[\octave].asInteger) + p[\semitone].asInteger;
	var pass = note.inclusivelyBetween(p[\lo].asInteger, p[\hi].asInteger) and: { out.inclusivelyBetween(0, 127) };
	var play = {
		if(vel > 0) {
			g[\held][note] !? { |h| ~noteOff.(h[0], h[1], true) };
			g[\held][note] = d !? { ~noteOn.(d, out, vel, true); [d, out] };
			~send.('/note', g[\id], out, vel);
		} {
			g[\held].removeAt(note) !? { |h| ~noteOff.(h[0], h[1], true) };
		};
	};
	var delay = p[\delay].asFloat * 60 / ~bpm;
	if(pass or: { vel == 0 }) {
		if(delay > 0) {
			// still active when it's due (deactivating releases what's held; nothing arrives after)
			SystemClock.sched(delay, { if(g[\active] and: { ~gens[g[\id]] === g }) { play.() }; nil });
		} { play.() };
	};
},
)
