# Perturbed

An algorithmic performance instrument. You play chords on a MIDI keyboard; generators running on
shared clocks turn them into arpeggios, permutations, euclidean rhythms, phasing and polytempo
layers, and send the MIDI to instruments in REAPER. You shape it all live from the Perturbed app.

Next up: Claude inside the app, setting up a performance from a description of the piece
([PLAN.md](PLAN.md), [AGENTS.md](AGENTS.md)).

## Requirements

- macOS, [SuperCollider](https://supercollider.github.io/) 3.14 in `/Applications`
- [REAPER](https://www.reaper.fm/) with the instruments you want (the defaults use Pianoteq 9)
- Node.js (for the app); ImageMagick only to regenerate the icon
- A MIDI keyboard

## One-time setup

1. **IAC buses:** Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver: enable, with
   *Bus 1* and *Bus 2*. The brain sends on these; REAPER listens.
2. **REAPER:** Preferences → Audio → MIDI Inputs: enable *IAC Driver – Bus 1* and *Bus 2*
   (restart REAPER if they don't appear).
3. **Tracks:** start Perturbed once (it writes `reaper/destinations.json`), then in REAPER:
   Actions → Load ReaScript… → `reaper/setup.lua`, and run it. Save the project as
   `reaper/performed.rpp`. Run `setup.lua` again whenever you add or remove outputs.

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
reaper/    setup.lua builds monitor-only tracks from destinations.json
tests/     run.sh and the tests it runs
performances/  saved performances
archive/   the first proof of concept
```

Rig settings (IAC ports, MIDI inputs, latency, default outputs) are in `brain/config.scd`.
Architecture, protocol, plans and gotchas: [PLAN.md](PLAN.md). Rules for coding agents and for
Claude as performance assistant: [AGENTS.md](AGENTS.md).
