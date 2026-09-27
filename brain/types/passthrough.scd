// passthrough — plays the keyboard into its destination, transposed by octave + semitone. Only
// keys from lo to hi pass (a cheap MIDI zone); others are dropped. Notes go out immediately
// (no scheduling latency) and work whether or not the transport runs. A note-off goes to the
// pitch its note-on sounded, even if the transpose changed in between.
(
params: [
	[\octave, 0, \range, -4, 4],
	[\semitone, 0, \range, -12, 12],
	[\lo, 0, \note],
	[\hi, 127, \note],
],

labels: (octave: "octaves", semitone: "semitones", lo: "lowest", hi: "highest"),
sections: (octave: "Transpose", lo: "Zone"),

key: { |g, p, note, vel|
	var d = ~dests[g[\dest]], out = note + (12 * p[\octave].asInteger) + p[\semitone].asInteger;
	if(vel > 0) {
		if(note.inclusivelyBetween(p[\lo].asInteger, p[\hi].asInteger) and: { out.inclusivelyBetween(0, 127) }) {
			g[\held][note] !? { |h| ~noteOff.(h[0], h[1], true) };
			g[\held][note] = d !? { ~noteOn.(d, out, vel, true); [d, out] };
			~send.('/note', g[\id], out, vel);
		};
	} {
		g[\held].removeAt(note) !? { |h| ~noteOff.(h[0], h[1], true) };
	};
},
)
