# Perturbed — plan

Perturbed is an algorithmic performance toolbox: generators on shared clocks read the chord you
play and send MIDI to instruments in Ableton Live, played from the Perturbed app (§5 describes
the system). Claude runs in a drawer in the app (§5.6) and sets up the running performance with the `perturbed`
command (§5.7). Claude can also write its own generator types into a library (§5.9); global parameters reshape
many settings at once (§5.10). **Next: to be chosen.**

**The idea.** A performer describes the piece they want to play ("two pianos phasing on an
arpeggio of whatever I play, a slow bass on the lowest note, echo my right hand an octave up")
and Claude sets up the performance interface: outputs, clocks, generators and their settings,
tempo. Claude arranges the instrument; it does **not** rewrite the app. Its brief is
[AGENTS.md](AGENTS.md).

---

## 1. Later: Claude goes further

### 1.1 Claude and Live

Claude sets up the sound side too, through the bridge (§5.4): new protocol messages (e.g.
`/live/track/volume`, `/live/record`, `/live/clip/launch`) that the brain forwards and the bridge
carries out with the Live API, exposed as `perturbed live ...` commands. Instruments stay loaded
by hand (the Live API can't load third-party plugins). The Live Set is saved alongside the
performance file (it holds instruments and their state).

---

## 2. Ideas to shape

### 2.1 Audio processing: clip → script → clip

Process Live's audio clips outside Live and bring the result back as a new clip (Live 12.4,
so the Live API can create audio clips from files).

- **Pick:** the bridge reads the selected clip's `file_path` (`live_set view detail_clip`) and sends
  it to the brain with the clip's track and slot.
- **Process:** a script in `processes/` runs on it (`python process.py in.wav out.wav --args`),
  Python with numpy/scipy/librosa in a repo venv (`tools/venv`), or SuperCollider NRT. Stretch,
  freeze, granular, reverse, slice, spectral...
- **Return:** output goes to the project (`Perturbed Project/Samples/Processed/`, so the set stays
  self-contained); the bridge puts it in the next empty slot below the original
  (`clip_slot create_audio_clip`), or swaps it into a Simpler (`replace_sample`) so generators can
  play it at once. The original is never touched.
- **Not real time:** seconds per pass; for building material during a set, not on the beat. The
  surface shows a pending/done state.
- **Claude:** processes are small scripts like generator types, so Claude can write one for the
  moment ("stretch 8x, freeze the attack, reverse the tail"), run it, and the clip appears:
  AdHoc processes, alongside AdHoc generators (§5.9).

---

## 3. Backlog

- **More generator types:** chord/strum (plays the whole chord or a voicing; settles "multiple
  notes per generator"), canon/echo of another generator, walk, phase, additive process, tone
  row, cloud, drone. Some of these may start life as AdHoc types and graduate to `brain/types/`.
- **Other note sources:** sequence, transforms (transpose, invert, subset) of the chord.
- **Controllers:** generator-to-generator modulation. (Knobs drive globals: §5.10.)
- **LFOs:** depth as a setting (scaling every target's range at once), so one LFO can fade another in.
- **Globals:** a global driven by an LFO; soft takeover for knobs (no jump when a knob and its
  global disagree); a global on a group's
  header; offset mode (editing a mapped setting shifts its range instead of being refused).
- **Groups:** drag and drop cards between groups; renamable pins; shared group settings (output, clock, velocity for all
  members); fades for On/Off.
- **Live:** Link start/stop sync (Live's transport follows Play, for recording a performance);
  outputs that *are* Live's tracks (auto-sync, instead of one click each; needs a rule for
  opening performance files: match outputs to tracks by name, flag missing ones).
- **Parked (not wanted for now):** scales as a note source (root + scale → pitches over a range);
  swing as a rhythm feel.
- **Open questions:**
  - Pedal gestures for the chord (sustain pedal to latch or arm).
  - Metric modulation at the next beat instead of immediately.
  - Latency: Live's MIDI input path on top of the brain's 50 ms; retune `latency` in
    `brain/config.scd` if the surface feedback and the sound drift apart.
  - Whether a plain passthrough (no transpose/zone/delay) should be a Live track listening to
    the keyboard directly, for lower latency.

---

## 4. Working on Perturbed (developers)

- JavaScript is linted and formatted with Biome (`biome.jsonc`: 2 spaces, single quotes, 140
  columns; `npm run lint`, `npm run format`); `tests/run.sh` checks it first. The renderer scripts
  share globals through `<script>` tags, so Biome's unused-variable rule is off for them.
- `./tests/run.sh` (~45 s) starts a test brain on port 57140 and runs the timing, generator, CLI and
  protocol tests; it plays MIDI on IAC Bus 1 channels 1–2 and sends CCs on Bus 2. Keep it green
  and short.
- The OSC protocol's authoritative list is the header of `brain/core/osc.scd`.
- **Gotchas:**
  - SuperCollider 3.14 on macOS creates no virtual MIDI ports; the brain uses IAC buses and must
    never listen to them as input (it would hear its own output): the keyboard filter skips
    every device in `ports` and `control`.
  - sclang binary operators have no precedence: `a + b * c` is `(a + b) * c`. Parenthesize.
  - `var` declarations only at the start of a block; no `*splat` inside array literals (use `++`).
  - `Array.includes` compares by identity: `0.0` is not `0`. Keep grid indexes integers.
  - Choice params arrive over OSC as Symbols: compare with `.asString`/`.asSymbol`, never `==`
    against a String literal directly.
  - `MIDIOut.latency` counts from send time, not logical time; a fixed latency keeps messages in
    order, which matters for note-off/note-on of a repeated pitch.
  - sclang ignores SIGTERM (use `kill -9`) and rejects unknown command-line flags (use env vars).
  - `a = e[\k] = x` assigns the Event, not `x` (`put` returns the receiver).
  - Electron's binary download may be skipped by npm; run `node node_modules/electron/install.js`.
  - ImageMagick's SVG renderer drops stroked circles; the icon script renders with Quick Look.
  - To try the app while a performance may be running, move both ports:
    `PERFORMED_PORT=57141 PERFORMED_SURFACE_PORT=57131 ./run.sh`, and stop that copy by its PID,
    never with a pattern that matches the performer's app.
  - Max's `[udpsend]` sends from a random port: the bridge names its reply port in `/hello 57150`.
  - The Live API is usable only after `[live.thisdevice]` bangs; `bridge.js` also starts itself
    after an autowatch reload. `DEBUG = 1` in `bridge.js` traces every Live API step.

---

## 5. The system today (reference)

### 5.1 Architecture

```
 MIDI keyboard ──MIDI──▶ ┌──────────────────────────────┐ ──MIDI notes──▶ Ableton Live
                         │ BRAIN (sclang)               │  IAC Bus 1, 2    tracks: instrument,
 Perturbed app ◀──OSC──▶ │ clocks · chord · generators  │ ──MIDI CC─────▶  effects, mixer
                         │ outputs · state · files      │  CTL 1, 2        (MIDI mapping)
                         └──────────────────────────────┘ ◀──OSC──▶ Perturbed Bridge (M4L)
                                     ▲ Ableton Link (tempo, bar phase) ▲
```

- **Brain (SuperCollider, `brain/`):** owns time and all musical state; runs generators; emits
  MIDI. Authoritative: surfaces (the app, the bridge, Claude's tools) send intents and render
  what it reports. Saves/loads performances (JSON; plugin state lives in the Live Set).
- **Sound rack (Ableton Live, `ableton/Perturbed Project/Perturbed.als`):** one MIDI track per
  output, MIDI From an IAC bus + channel, Monitor In, made by hand.
- **Perturbed (Electron, `surface/`):** renders the brain's state; cards are built from the type
  schema, so new types need no surface code.

Why this split: a toolbox is mostly about what happens *between* generators (shared chord,
clocks, references, live changes), which needs one shared model of musical state; DAW plugin
architectures don't provide that, but DAWs are good at hosting, mixing and saving plugin state.
(The first proof of concept, SC hosting VSTs directly, is in `archive/`.)

### 5.2 Concepts

- **Chord:** one current chord, latched. Auto: every chord played replaces it on release. Arm:
  only the next chord after pressing Arm. Clear empties it.
- **Generators:** a type + params + an output. Types (`brain/types/`) declare `params` and `run`
  (clock-driven) and/or `key` (keyboard-driven), plus optional `showWhen`, `labels`, `sections`,
  `restartOn`, `sliders` (lin/log per param), `actions` (card buttons, `/gen/do`), `output: false`
  (no output menu). Shared modules: `pitch.scd` (which note), `rhythm.scd` (grid and which steps
  play), `velocity.scd` (how loud), `~clockParam` (which clock).
- **basic:** one note at a time on a grid of num/den beats, each released by the next.
  Pitch from a set note or the chord (index, lowest, highest, arpeggio up/down/up-down, permute);
  rhythm every/euclid/random/phrase; velocity set/accent/random/drift/ramp/pattern + humanize.
- **passthrough:** the keyboard into an output, transposed, zoned (lowest..highest), optionally
  delayed by beats; works with the transport stopped.
- **lfo:** a MIDI CC wave on a control bus (§5.5): sine, triangle, saw up/down, square, random,
  smooth random; rate sync (num/den beats per cycle on a clock) or free (Hz); phase; from/to;
  bus, channel, cc. ~50 values a second, only on change. **Send** sends one value (from/to in
  turn) for mapping without playing.
- **Clocks:** A is the main clock (transport tempo). B, C, ... run at main × ratio, main × factor,
  or a free bpm; all share the grid origin. Metric modulation multiplies the main tempo by a fraction.
- **Outputs** (the brain's *destinations*): (IAC port, channel) pairs, one Live track each.

### 5.3 Timing and Link

- The main clock is a LinkClock (quantum 4, latency = the MIDI latency), so Live and Perturbed
  share tempo and bar phase; tempo changes go both ways. Test mode uses a fresh TempoClock per
  play and stays out of the Link session.
- Play puts the grid origin at the start of the current Link bar (`~beats` counts from there), so
  generators start at once on Live's bar lines. Extra clocks are TempoClocks started at the origin.
- Onsets fall on `k · num/den` beats from the origin; changing num/den (or clock) restarts on the
  next point of the new grid, so generators keep their ratios. A sounding note is released by the next.
- All scheduling is in logical time; onsets land within a few ms of the grid (`tests/timing.scd`).
  MIDI is timestamped 50 ms ahead (`latency`); surface feedback (`/beat`, `/note`) is sent at the
  same delay so it lines up with the sound. Passthrough notes and `/cc` go out immediately.

### 5.4 Live setup and the Perturbed Bridge

- **Live settings (once):** IAC Bus 1 and 2 inputs with **Track** on (Remote off); the control
  buses *Perturbed CTL 1* and *2* with **Remote** on (Track off); the keyboard's Track input off
  (it reaches Live through passthrough); Link on.
- **Bridge** (`ableton/Perturbed Bridge.amxd`, a Max for Live MIDI effect on any track):
  `[live.thisdevice]` and `[udpreceive 57150]` → `[js bridge.js]` → `[udpsend 127.0.0.1 57120]`.
  All logic is in `bridge.js`; the `.amxd` is a thin shell. It joins the brain as a surface
  (`/hello 57150`, `/ping`, re-`/hello` on a new boot id).
- **Tracks → outputs:** the bridge reads Live's MIDI tracks whose MIDI From is one of the brain's
  buses (name, bus, channel, first device) and sends `/live/tracks` on connect and on every change
  (observed, debounced, only when different); `/live/tracks/clear` when the device is removed.
  The Outputs pane lists tracks that aren't outputs yet under *In Live* (**+**, *Add all*) and
  marks outputs no track listens to with **!**. The bridge only reads; it never makes tracks.

### 5.5 Control buses and MIDI mapping

- CCs (LFOs, `/cc <bus> <channel> <cc> <value>`) go to IAC buses of their own (config `control`:
  *Perturbed CTL 1*, *CTL 2*), never to an output, so they can't collide with notes. A missing
  bus is silent, with a warning at boot. Test mode sends CCs to Bus 2.
- In Live, MIDI Map mode (⌘M, click a parameter, press the LFO's **Send**) maps any parameter,
  with a min/max per mapping in the mapping browser; plugins' own MIDI learn works too.

### 5.6 The Claude drawer

- **Claude** in the transport bar (or ⌘`) slides up a terminal running Claude Code in the repo with
  `PERTURBED_AGENT=1`, so it follows AGENTS.md as the performance assistant. Drag the top edge to
  resize; the session keeps running while the drawer is closed; when Claude exits a shell stays,
  and after the shell exits any key starts a new session.
- xterm.js in the renderer (`surface/terminal.js`), node-pty in the main process (`main.js`, IPC
  channels `term:*`, exposed as `shell` in `preload.js`). node-pty is built against Electron by
  `run.sh` (`electron-rebuild`, needs Xcode command-line tools).
- `surface/agent-settings.json` (passed with `claude --settings`) allows edits in `performances/`
  and denies them in the app's code and docs, so AGENTS.md's rules are enforced, not just asked.

### 5.7 The perturbed command

- `tools/perturbed` (Node) changes the running performance from the shell: `state`, `schema`,
  `add`/`set`/`on`/`off`/`remove`/`do` for generators, `output add|remove|live`,
  `clock add|set|remove`, `tempo`, `scale`, `chord`, `cc`, `play`/`stop`, `new`, `save`/`load`
  (`tools/perturbed help`). Built for Claude in the drawer (allowed in `agent-settings.json`).
- `tools/lib/brain.js` does the work: a short-lived surface (`/hello`,
  mirror the snapshot, send intents and wait for their echo, `/bye`). Settings are checked against
  the type schema before sending (the brain stores what it gets), and errors list what's allowed.
  Outputs and clocks by name or id; notes by name or number.
- Protocol support: `/bye` unregisters a surface; `/saved` confirms a save; `/error` reports a
  failed save/load. `PERFORMED_PORT` points it at another brain (the tests use 57140).

### 5.8 Groups

- A named set of generators (each in at most one; no nesting) with **On/Off**, **Solo** and
  **folded** (`brain/core/groups.scd`). A generator sounds when it's on, its group is on, and no
  group is soloed or its group is (`~sounds`); gates sit in `~strike`, passthrough's key handler
  and the lfo loop. Off and soloed-out are mutes: routines keep running, held notes are released,
  so a group comes back on the grid.
- Protocol: `/group/add [name]`, `/group/set <id> name|on|solo|collapsed <v>`, `/group/remove`
  (generators stay, ungrouped); `/gen/set <id> group <gid>`; echoes `/group …`, `/group/removed`,
  and `/gen` carries the group. Saved in performance files, folding included.
- **Pins:** member settings (range, choice, note) shown under the group's header, folded or not,
  as the same controls as on the card: `/group/pin|unpin <id> <genId> <param>`, echoed as
  `/group/pins <id> (<genId> <param>)...` (sent after the generators in a snapshot). A generator
  leaving the group or removed takes its pins along. Pinned from the card's ◇.
- Surface (`surface/groups.js`): a section per group with header (fold, name, summary of member
  lights and outputs when folded, + to add a generator into it, On, Solo, ×) and its pins; a
  *group* menu on each card; cards that are on but muted are dimmed. CLI: `group add|set|remove|
  pin|unpin`, `group=` on generators, `sounding` in `state`.

### 5.9 The type library and AdHoc generators

- Every type the brain knows is in a **library** (`brain/core/library.scd`): built-in
  (`brain/types/`) and **AdHoc**, written by Claude for a piece (`adhoc/` at the repo root, in git;
  `$PERFORMED_ADHOC` elsewhere, as the tests do). A type file's first header sentence
  (`// name — what it does.`) is its description.
- **Favorites** (`adhoc/favorites.json`; default: the built-ins) load at boot and are the add bar;
  other types load on demand (`/adhoc/load <name>`, hot) and stay on the bar for the session.
  `/favorite <name> 1|0`, `/library/rescan`; every type is listed in the snapshot as
  `/library/type` (with `changed` when its file differs from what's loaded).
- **Guarded:** a file that fails to evaluate changes nothing (`/error`); a generator whose type
  fails while running stops alone (`Routine.exceptionHandler`, `try` around `key`), is switched off
  and reported. Reloading moves generators to the new version keeping their settings, and keeps the
  replaced AdHoc source in `adhoc/old/`.
- **Pieces** embed the AdHoc types they use (`adhoc` in the performance file); opening one loads
  those copies, so a piece never changes with the library.
- **Deleting** (`/adhoc/delete`): an AdHoc type's file moves to `adhoc/old/<name>-deleted-<stamp>`
  and it's unloaded and unstarred; refused for built-ins and for types generators still use.
- **Surface:** the add bar (favorites), *Library ▾* (star, + Add, Reload when changed, × to delete),
  brain errors in the status area. **CLI:** `adhoc list|show|load|check|delete`,
  `favorite`/`unfavorite`; `add` loads a library type first. `adhoc check` runs sclang's parser on a file to show the syntax error.
- [docs/writing-generator-types.md](docs/writing-generator-types.md) is the guide for writing types by
  hand (its recipes are complete files, checked by loading and playing them); AGENTS.md teaches
  Claude the same format. `~grid.(beats, fn)` (core/clock.scd) is the idiom for playing in step (`basic` uses it);
  `beats` can be a function, read before every point, re-aligning when its value changes.
  `onChange: (param: { |g, p, old, new| })` reacts to a setting's change (from anywhere; errors
  reported); `~restart.(g)` restarts `run`, which `restartOn` does for every change.
  `agent-settings.json` lets Claude write `adhoc/`.
- **Later:** graduating a type from `adhoc/` to `brain/types/` is a developer task (tests, AGENTS
  table).

### 5.10 Global parameters

- Named, performance-wide controls (`brain/core/globals.scd`): *Meta 1, Meta 2, …* by default,
  renamable, value 0–1, saved with the performance. Each maps to any number of generator settings:
  `from + (to − from) · curve(x)` in the setting's units (from > to inverts), curves linear, exp,
  steps (`amount` levels), threshold (jumps at `amount`); menus map over their option indexes.
  Settings that restart a generator, clocks and text can't be mapped.
- A mapped setting follows one global and is **locked**: `/gen/set` for it is refused with a
  message (`~setGenByHand`) and its card control is greyed and tagged `← name`. Removing a
  generator drops its mappings.
- **AdHoc types** read globals (`~global.(\\name)`) and declare them (`globals: [...]`), which
  creates missing ones when the type loads.
- Protocol: `/global/add [name]`, `/global/set <id> name|value <v>`, `/global/remove`,
  `/global/map <id> <gen> <param> [from to curve amount]`, `/global/unmap`; echoes `/global`,
  `/global/mappings <id> (gen param from to curve amount)...`, `/global/removed`.
- **Knobs:** a global can follow a knob or fader on the performer's inputs ([channel, cc], 0–127 →
  0–1): learned by turning it (`/global/learn <id> 1|0`) or set (`/global/knob <id> <ch> <cc>`,
  channel 0 = none); one knob drives one global; saved with it. `/global` carries the knob.
- Surface (`surface/globals.js`): a sidebar row per global (name, slider, Knob, Map, ▸ mappings, ×);
  Map mode makes setting names on cards clickable targets. CLI: `global add|set|remove|map|unmap`;
  `state` lists globals and each generator's `follows`.

### 5.11 Drivers: LFOs that move settings

- A generator whose type has `maps: true` (`lfo`) holds mappings exactly like a global
  (`g[\mappings]`, the same from → to, curves and lock): globals and such generators are *drivers*
  (`~drivers`, `~mappedBy`, `~driverName` in `core/globals.scd`), and a setting follows at most one,
  whichever kind. `/gen/map <id> <gen> <param> [from to curve amount]`, `/gen/unmap`, echoed as
  `/gen/targets` (the layout of `/global/mappings`); `/gen/maps <type>` in the schema.
- The lfo calls `~drive.(g, u)` from its run with its wave in 0–1, so it moves its targets only
  while it's on, sounding (not muted by its group) and the transport runs. A generator can't drive
  its own settings; another lfo's can be driven (LFO-to-LFO). MIDI CC is optional (`sendCC`).
- Surface: Map on the lfo's card (Map mode is shared with globals, `surface/globals.js`), targets
  under *Moves*; driven settings are locked, tagged `← Lfo n` and show their moving value.
  CLI: `map`/`unmap <lfo id> <gen id> <setting>`; `state` shows `targets` and `follows`.
- Also here: generator cards fold (`collapsed`, saved); basic has `chance`, and `length`/`duration`
  (`~strikeFor`, `~rhythmChance`, `~noteBeats`).

### 5.12 Unsaved changes

- The brain keeps `~dirty`: set by any incoming intent that changes what a performance file holds
  (`~changesPerformance`, checked for every message with `thisProcess.addOSCRecvFunc`, so the app,
  `perturbed` and Claude all count), cleared by save, load and new. Sent as `/dirty 1|0` (and in
  the snapshot). Chords played on the keyboard and knob turns don't count.
- The app marks *Save…* with a dot, asks before New and Open…, and on closing the window or
  quitting (`surface/main.js`): Save… (waits for `/saved`, stays open on `/error` or no answer),
  Don't Save, Cancel. `perturbed state` shows `unsaved`.
