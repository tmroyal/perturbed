# Interdependence: generators that affect each other

## The note that started this

That one issue with this is a lack of interdependence channels. That should be the design focus more than all of this other stuff.

With this in light, I wonder if we, for each generator, can come up with statistics that can be mapped to other genrators/lfos.

We could also have generators that take the input of other generators and do things based off of them.

We need to brainstorm this before continuing.

We might need to redesign everything to be modular, but I don't want that yet.

## Brainstorm (2026-10-08)

Interdependence splits into two kinds of channel: one generator's **values** reaching another's
settings, and one generator's **notes** reaching another. Five options across both. None is a
modular redesign: they reuse the mapping and the strips that exist.

### Values: what a generator is doing moves another's settings

**1. Signals on every generator.** Each generator publishes a few 0–1 values as it plays: density
(notes per beat, smoothed), last pitch (as register), last velocity, and gate (sounding or not).
Every strip gets a Map button with a choice of signal; mapping works as for an LFO or a global.

- For: nothing new on the rack; any generator can drive anything.
- Against: every strip gets more to show, and smoothing has to be a fixed guess.

**2. A "follow" generator.** A type whose settings are: which generator to watch, what to measure,
how much to smooth. It drives targets like an LFO does.

- For: no new concepts. The statistic is a visible strip that can be tuned, inverted, switched off
  or folded away. It could start as an AdHoc type.
- Against: one extra strip per connection.

### Notes: one generator hears another

**3. Listeners.** A type can declare that it hears a chosen generator and is called on each of its
notes: canon and echo, a harmonizer, call and response (answer when it rests), fill-the-gaps
rhythms. Needs one new setting kind, a generator picker.

**4. A generator as the chord.** A new pitch source, "from generator N": its recent notes become
the chord another generator arpeggiates or permutes. One generator's melody becomes another's
harmony. Small: pitch sources are already shared by the types.

**5. Conditions.** Play only while another generator sounds, or only while it is silent (ducking).
Falls out of 1 or 2 (map gate to `chance`); no separate build.

### Suggested order

1. Build 2 on top of 1's measuring: the brain measures every generator at the one place notes are
   struck (`~strike`), and a follow type exposes it. Tunable statistics, no new mapping interface.
2. Then 3: it is what the backlog's canon, echo and generator-to-generator items all need.
3. 4 whenever; it is cheap.

### What exists already

- Any type can drive settings (`maps: true`, `~drive.(g, x)`): the built-in lfo and AdHoc types.
- A type can read what another generator is sounding (`~gens[id][\sounding]`).
- Missing: a generator publishing values (density, pitch, velocity, gate) as something mappable,
  a way for a type to be called on another generator's notes, and a setting that picks a generator.

### Open

- Feedback loops (A follows B, B follows A): allowed? They are safe (each value arrives one step
  late) and musically interesting.
- Which statistics matter most: density, register, velocity, gate; others (interval, direction,
  time since the last note)?
- Does a follower watch one generator, or a group?
