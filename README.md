# Perturbed

An algorithmic performance instrument. You play chords on a MIDI keyboard; generators running on
shared clocks turn them into arpeggios, permutations, euclidean rhythms, phasing and polytempo
layers, and send the MIDI to instruments in Ableton Live. You shape it all live from the Perturbed app.

Next up: Claude inside the app, setting up a performance from a description of the piece
([PLAN.md](PLAN.md), [AGENTS.md](AGENTS.md)).

## Requirements

- macOS, [SuperCollider](https://supercollider.github.io/) 3.14 in `/Applications`
- [Ableton Live](https://www.ableton.com/) with the instruments you want (the defaults use
  Pianoteq 9); Max for Live for the bridge device (optional so far)
- Node.js (for the app); ImageMagick only to regenerate the icon
- A MIDI keyboard

## One-time setup

1. **IAC buses:** Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver: enable, with
   *Bus 1* and *Bus 2*. The brain sends on these; Live listens.
2. **Live:** Settings → Link, Tempo & MIDI: turn **Track** on for the inputs *IAC Driver (Bus 1)*
   and *(Bus 2)*, and off for your keyboard (it reaches Live through the brain's passthrough).
   Turn on **Show Link Toggle** there, then the **Link** button at the top left of Live's window:
   Live and Perturbed then share tempo and bar lines.
3. **Bridge:** put `ableton/Perturbed Bridge.amxd` (Max for Live) on any track. It shows
   Perturbed which Live tracks listen to the brain.
4. **Tracks:** a sound is a Live MIDI track with MIDI From *IAC Driver (Bus n)*, a channel no
   other track uses, Monitor **In**, not armed, an instrument on it. It appears under *In Live*
   in Perturbed's Outputs pane; **+** makes it an output. Save the set as
   `ableton/Perturbed Project/Perturbed.als`.

## Run

```
./run.sh
```

Starts the brain and opens Perturbed; quitting Perturbed stops the brain. Plug the keyboard in
first (the brain lists the MIDI inputs it found in the terminal). The first run builds
`build/Perturbed.app` from Electron.

## Playing

- **Chord:** play a chord; it stays until the next one (*Auto*), or only changes after you press
  *Arm* (*Arm* mode). *Clear* empties it.
- **Outputs:** Live's tracks on the IAC buses are listed under *In Live*; **+** (or *Add all*)
  makes them outputs. A **!** marks an output no Live track listens to.
- **Generators:** *+ Basic* adds a generator. Pick an output, turn it *On*, press *Play* (or
  space). Set where its pitch comes from (a note or the chord: index, lowest, highest, arpeggio,
  permute), its rhythm (every, euclid, random, phrase on a num/den grid) and velocity (set,
  accent, random, drift, ramp, pattern, humanize).
- **Passthrough:** *+ Passthrough* plays the keyboard into an output: transposed, zoned, delayed.
- **Tempo:** the dial (drag, shift for fine, scroll, double-click to type); *Modulate* multiplies
  the tempo by a fraction and ⇅ flips it back.
- **Clocks:** A is the main clock. Add B, C… at a ratio or factor of it (1.01 phases slowly), or
  at their own tempo, and put generators on them.
- **Save… / Open…** store the whole performance in `performances/` (`example.json` is a demo).

## Develop

```
./tests/run.sh      # ~30 s: timing, generator and protocol tests on a separate test brain
```

```
brain/     SuperCollider: clocks, chord, generators, MIDI, OSC protocol (the authority)
  types/     generator types (basic, passthrough); a new file here is a new generator
surface/   the Perturbed app (Electron): ui, transport, generators, sidebar, app (state + protocol)
ableton/   the Live set and the Perturbed Bridge (Max for Live: bridge.js)
tests/     run.sh and the tests it runs
performances/  saved performances
archive/   the first proof of concept
```

Rig settings (IAC ports, MIDI inputs, latency, default outputs) are in `brain/config.scd`.
Architecture, protocol, plans and gotchas: [PLAN.md](PLAN.md). Rules for coding agents and for
Claude as performance assistant: [AGENTS.md](AGENTS.md).
