# Perturbed

An algorithmic performance instrument. You play chords on a MIDI keyboard; generators running on
shared clocks turn them into arpeggios, permutations, euclidean rhythms, phasing and polytempo
layers, and send the MIDI to instruments in Ableton Live. You shape it all live from the Perturbed app.

**Claude** (the button, or ⌘`) opens a drawer running Claude Code as a performance assistant:
describe the piece and it sets up the performance ([AGENTS.md](AGENTS.md)).

## Requirements

- macOS, [SuperCollider](https://supercollider.github.io/) 3.14 in `/Applications`
- [Ableton Live](https://www.ableton.com/) with the instruments you want (the defaults use
  Pianoteq 9); Max for Live for the bridge device (optional so far)
- Node.js (for the app) and Xcode command-line tools (to build the drawer's terminal);
  ImageMagick only to regenerate the icon
- [Claude Code](https://claude.com/claude-code), logged in, for the Claude drawer
- A MIDI keyboard

## One-time setup

1. **IAC buses:** Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver: enable, with
   *Bus 1* and *Bus 2*. The brain sends on these; Live listens.
2. **Live:** Settings → Link, Tempo & MIDI: turn **Track** on for the inputs *IAC Driver (Bus 1)*
   and *(Bus 2)*, and off for your keyboard (it reaches Live through the brain's passthrough).
   For *IAC Driver (Perturbed CTL 1)* and *(Perturbed CTL 2)* turn **Remote** on and Track off:
   the control buses for LFOs.
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
- **Library:** the add bar holds your favorite generator types; *Library ▾* lists every type,
  built-in and AdHoc (written by Claude for a piece, kept in `adhoc/`), with ☆ to star one for the
  bar, *+ Add*, and × to delete an AdHoc type (its file moves to `adhoc/old/`). Errors from a type show at the top right.
- **Generators:** *+ Basic* adds a generator. Pick an output, turn it *On*, press *Play* (or
  space). Set where its pitch comes from (a note or the chord: index, lowest, highest, arpeggio,
  permute), its rhythm (every, euclid, random, phrase on a num/den grid) and velocity (set,
  accent, random, drift, ramp, pattern, humanize).
- **Groups:** *+ Group* makes a section; put generators in it with their *group* menu. **On/Off**
  and **Solo** mute without losing time (a group comes back on the beat); ▸ folds it away to a
  header with a light per generator. Click the name to rename; **+** in the header adds a
  generator straight into the group. **◇** by a card's setting pins it to the group's header, so it
  stays at hand when the group is folded.
- **Passthrough:** *+ Passthrough* plays the keyboard into an output: transposed, zoned, delayed.
- **LFOs:** *+ Lfo* sends a MIDI CC wave (synced to the beat or free) on a control bus (menu). To make
  it move something in Live: ⌘M, click the parameter, press the card's **Send** (or let the LFO
  run) until Live learns it, ⌘M.
  The range of each mapping is set in Live's mapping browser.
- **Tempo:** the dial (drag, shift for fine, scroll, double-click to type); *Modulate* multiplies
  the tempo by a fraction and ⇅ flips it back.
- **Clocks:** A is the main clock. Add B, C… at a ratio or factor of it (1.01 phases slowly), or
  at their own tempo, and put generators on them.
- **Save… / Open…** store the whole performance in `performances/` (`example.json` is a demo).

## Develop

```
npm install         # once, at the repo root: the JavaScript linter/formatter (Biome)
./tests/run.sh      # ~45 s: lint, then timing, generator, protocol, CLI and library tests on a separate test brain
npm run format      # fix formatting and safe lint findings in the JavaScript (biome.jsonc)
```

```
brain/     SuperCollider: clocks, chord, generators, MIDI, OSC protocol (the authority)
  types/     generator types (basic, passthrough); a new file here is a new generator
surface/   the Perturbed app (Electron): ui, transport, generators, sidebar, app (state + protocol),
           terminal (the Claude drawer)
tools/     perturbed: change the running performance from the shell (tools/perturbed help)
adhoc/     the AdHoc type library (written by Claude), favorites.json, old/ (replaced versions)
ableton/   the Live set and the Perturbed Bridge (Max for Live: bridge.js)
tests/     run.sh and the tests it runs
performances/  saved performances
archive/   the first proof of concept
```

Rig settings (IAC ports, MIDI inputs, latency, default outputs) are in `brain/config.scd`.
Architecture, protocol, plans and gotchas: [PLAN.md](PLAN.md). Rules for coding agents and for
Claude as performance assistant: [AGENTS.md](AGENTS.md).
