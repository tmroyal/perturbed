# performed — plan

An algorithmic performance toolbox: a set of generators that share musical material
(captured chords, scales, pools of notes), run on a common clock, and are played from a
custom surface, with the sound produced by instruments and effects in REAPER.

This document describes the architecture we settled on after the first proof of concept
(archived in `archive/sc-electron-poc/`), why, and how to build it.

---

## 1. Why this architecture

The first POC hosted VST instruments inside SuperCollider (VSTPlugin) and grew a
"tracks" pane: a small DAW. We evaluated alternatives:

| Option | Verdict |
|---|---|
| SC hosts plugins (POC) | Works, but plugin state, crash isolation, effects chains, mixing and saving all have to be built by hand. |
| Generators as REAPER JSFX | Sample-accurate and simple for one generator, but shared state between generators (`gmem`) is an untyped float array; every cross-generator feature becomes low-level plumbing. |
| Generators as Max for Live devices | Good performance workflow, but patch-based, can't load third-party plugins from the API, and can't be tested headlessly. Live's MIDI routing is too limited. |

The core realization: a *toolbox* is mostly about what happens **between** generators:
shared sources, references, modulation, live changes. That needs a single shared model of
musical state, which DAW plugin architectures don't provide. DAWs are good at the *sound*
side. So we split the system:

- **Brain (SuperCollider):** owns time and all musical state; runs generators; emits MIDI.
- **Sound rack (REAPER):** hosts instruments and effects, mixes, records, saves plugin state.
  Chosen over Live for its MIDI routing (per-track device and channel inputs, MIDI sends
  with channel remapping, routing matrix) and because everything is scriptable (ReaScript).
- **Surface (Electron):** the performance UI; shows and edits the brain's state over OSC.

```
 MIDI keyboard ──MIDI──▶ ┌───────────────────────────────┐
                         │ BRAIN  (sclang + TempoClock)  │ ──MIDI──▶ REAPER
 SURFACE (Electron) ◀OSC▶│  clock · sources · generators │  virtual   tracks: instrument,
                         │  destinations · state         │  ports     effects, mixer,
                         └───────────────────────────────┘  (port,ch) recording
```

---

## 2. Components

### 2.1 Brain — SuperCollider (`brain/`)

Runs headless: `sclang brain/main.scd` (`PERFORMED_TEST=1` for test mode: no default destinations,
`destinations.json` untouched; sclang rejects unknown command-line flags, hence the env var). No audio server is required (the brain only sends MIDI;
scsynth may be booted later for SC-native synthesis, but it is not part of the core).

Responsibilities:

- **Clock / transport.** A `TempoClock` is the single time source. Play restarts at beat 0,
  which is the grid origin for all generators. Tempo changes apply to the running clock.
- **Sources.** Named containers of musical material that generators read from (see §3).
- **Generators.** Routines on the clock that read sources and parameters and emit notes (§3).
- **Destinations.** A destination is a `(port, channel)` pair on one of the brain's MIDI
  outputs (IAC buses, see §8). Each REAPER track listens to exactly one destination.
- **MIDI input.** Receives the performer's keyboard (and controllers) for capturing chords
  into sources and for mapping CCs to parameters.
- **State authority.** The brain is authoritative. The surface sends *intents* ("set param",
  "capture into slot A") and renders what the brain reports back. Rationale: state also
  changes from the keyboard (captures, CCs), so the brain is the only place that sees everything.
- **Persistence.** The brain saves/loads a performance file (JSON: sources, generators,
  destinations, tempo). Plugin state lives in the REAPER project, not here.

Code layout (proposed):

```
brain/
  main.scd            boot, load modules, OSC + MIDI setup
  core/
    clock.scd         transport, tempo, grid helpers
    sources.scd       slot store, capture logic (milestone 4)
    generators.scd    lifecycle (add/remove/start/stop/restart), param handling
    midi.scd          outputs (IAC buses), note on/off with timestamps, input handling
    osc.scd           surface protocol (§5)
    persist.scd       save/load JSON (milestone 5)
    destinations.scd  destination store; writes reaper/destinations.json
  config.scd          MIDI ports (IAC buses), latency, default destinations
  types/
    fractionalRepeat.scd
    ...               one file per generator type; filename = type name
```

### 2.2 Sound rack — REAPER (`reaper/`)

REAPER is used as a live instrument rack; its own timeline/transport does not need to run.

- **Tracks:** one per destination. Input = brain virtual port + MIDI channel; record-armed with
  record mode "disable (input monitoring only)" and monitoring on, so tracks play incoming MIDI
  without recording it. (Recording a performance is then just switching record mode.)
- **Instruments/effects:** any VST/VST3/AU, loaded by name.
- **Setup script** `reaper/setup.lua` (ReaScript): creates or updates tracks from a
  destination list (name, port, channel, instrument), using `InsertTrackAtIndex`,
  `SetMediaTrackInfo_Value(track, "I_RECINPUT", ...)`, `I_RECARM`, `I_RECMODE`, `I_RECMON`, and
  `TrackFX_AddByName(track, "Pianoteq 9", false, -1)`.
- **Project file** `reaper/performed.rpp` holds the tracks, plugins and their presets.
- **One-time setup:** enable the brain's virtual MIDI ports as inputs in
  Preferences → Audio → MIDI Inputs (REAPER only discovers new devices on restart).

### 2.3 Surface — Electron (`surface/`)

Carries forward from the POC: Nord theme, Electron main process speaking OSC over UDP
(no bridge), renderer builds UI from state reported by the brain.

Layout:

- **Transport bar:** play/stop (space bar), tempo dial (drag, shift for fine, scroll, double-click
  to type) plus a numeric BPM field, beat indicator.
- **Sources pane:** slots (A, B, C, ...) showing their notes; "capture" arm buttons; clear.
- **Generator grid:** one card per generator: active toggle (inactive by default), destination
  select, source reference, type-specific parameters, activity LED.
- **Destinations pane:** list of destinations (name, port/channel); "sync to REAPER"
  regenerates the REAPER setup (§6).

A Max/jsui surface remains an option later: the OSC protocol is the contract, so any surface
that speaks it works (also TouchOSC or a browser on an iPad).

---

## 3. Core concepts

### 3.1 Sources

A source is a named slot holding an ordered list of MIDI pitches (and optionally velocities).

- **Capture:** arm a slot (from the surface or a keyboard key/pedal), play a chord; the set of
  notes held at the moment the last key is released (or at a pedal press) is stored, sorted
  low→high. Re-capturing replaces the contents; generators pick it up on their next note.
- **Other source kinds (later):** scale (root + scale → pitches over a range), sequence
  (ordered, may contain repeats), transforms (transpose, invert, subset) of another source.

### 3.2 Generators

A generator = a type + parameters + a destination + (optionally) a source reference.
Each type is a file evaluating to an Event:

```supercollider
(
params: (...defaults...),           // sent to the surface as the schema
restartOn: [\num, \den],            // params whose change re-quantizes the routine
run: { |g, p| ... }                 // Routine body on the transport clock; waits in beats
)
```

Generators call a shared `~strike.(g, note, vel)` that releases the generator's previous note and
plays the new one at the same logical time.

### 3.3 FractionalRepeat (first type)

Repeats one note; each note lasts `num/den` beats and is released by the next.

| Param | Meaning |
|---|---|
| `note` | explicit pitch (name + octave in the UI), used when no source is set |
| `source` | slot name or none |
| `index` | which note of the source (0 = lowest; negative counts from the top; wraps) |
| `velocity` | 1–127 |
| `num`, `den` | duration in beats = num/den |
| `active` | on/off (off by default) |
| `dest` | destination id |

**Grid alignment rule** (proven in the POC): onsets fall on `k · num/den` beats from transport
start. Changing `num`/`den` restarts the routine at the next grid point of the new ratio,
`ceil(now / d) · d`, so generators keep their ratios with each other (3/4 and 1/1 meet every
3 beats). A sounding note is not cut by a restart; it is released by the next strike.

### 3.4 Destinations

`(port, channel)` with a display name and the intended REAPER instrument. Ports and channels are
1-based everywhere (protocol, JSON). Each IAC bus gives 16 destinations.

---

## 4. Timing

- All scheduling happens on the brain's `TempoClock` using logical time (`thisThread.beats`), so
  waits don't accumulate drift.
- MIDI is sent with a fixed latency (`MIDIOut.latency`, e.g. 0.05 s). On macOS, CoreMIDI
  delivers timestamped packets, so notes should land at logical time + latency regardless of
  sclang jitter.
- Live keyboard input used for *capture* needs no latency; keyboard input *played through* to
  REAPER should go directly (REAPER track listening to the keyboard), not via the brain.
- UI feedback (note LEDs, beat indicator) is scheduled `latency` later so it lines up with the sound.

---

## 5. Brain ⇄ surface OSC protocol

Brain listens on 57120 (sclang); surface listens on 57130. All messages are plain OSC over UDP.

Surface → brain (intents):

```
/hello                                  brain replies with full state
/ping                                   brain replies /pong <bootId> (changes on restart → re-/hello)
/transport/play      1|0
/transport/tempo     <bpm>
/source/arm          <slot> 1|0         next captured chord goes into slot
/source/set          <slot> <pitch>...  set a slot directly
/source/clear        <slot>
/gen/add             <type>             brain assigns the id
/gen/remove          <id>
/gen/set             <id> <param> <value>
/dest/add            <name> <port> <channel> <instrument>     1-based port and channel
/dest/remove         <id>
/save                <path>   /load <path>
```

Brain → surface (state):

```
/state/begin | /state/end               full snapshot framing (on /hello, load)
/transport           <playing> <bpm>
/ports               <name>...                     MIDI outputs; destination port n = nth name
/source              <slot> <armed> <pitch>...
/gen                 <id> <type> <dest> <active>
/gen/param           <id> <param> <value>
/gen/removed         <id>
/gen/schema          <type> <param> <kind> <default> <args>...
                     kind = range (min max) | note | choice (options) | source | dest
/dest                <id> <name> <port> <channel> <instrument>
/dest/removed        <id>
/beat                <beat>                        (latency-aligned)
/note                <genId> <pitch> <vel>         (latency-aligned)
```

The brain echoes every accepted change, so multiple surfaces (laptop + iPad) stay in sync.
Any address that sends `/hello` is registered as a surface and receives all state messages.
`/save` and `/load` arrive with milestone 5. The authoritative list is the header of `brain/core/osc.scd`.

---

## 6. REAPER integration

- **Setup:** `reaper/setup.lua` reads `reaper/destinations.json` (written by the brain on `/dest/*`
  changes) and creates/updates one track per destination: name, MIDI input (port device +
  channel), monitor-only arm, instrument by name. Idempotent: existing tracks are matched by
  name and left alone except for routing.
- **Running the setup:** manually from REAPER's Actions list at first; later triggered from the
  surface via REAPER's OSC control surface (`/action/<command id>`).
- **Device indices:** REAPER addresses MIDI inputs by index; the setup script looks the brain's
  ports up by name (`GetMIDIInputName`) rather than hard-coding indices.

---

## 7. Milestones

1. ✅ **Brain skeleton, headless.** (`tests/timing.sh`: onsets within ~1.3 ms of the grid.) Clock, virtual MIDI outputs, FractionalRepeat with explicit note,
   OSC transport/tempo/gen control. Verified by a test harness that captures the MIDI output
   (loop the brain's port back into a MIDI listener) and checks onset times against the grid.
2. ✅ **REAPER rack.** `setup.lua` builds tracks from `destinations.json`; confirm Pianoteq 9 plays
   from the brain on two destinations.
3. ✅ **Surface v1.** Transport bar, generator grid, destinations pane; brain-authoritative state sync.
4. ✅ **Sources.** (Inputs: every MIDI device except the IAC Driver, or `inputs` in config.scd.) Chord capture from the keyboard into slots; FractionalRepeat `source` + `index`;
   sources pane in the surface.
5. **Persistence.** Save/load performance JSON; REAPER project alongside.
6. **More generator types** (e.g. euclidean, arpeggiator over a source, probability gates) and
   source kinds (scale, sequence, transforms).
7. **Modulation / controllers.** CC mapping to any generator parameter; generator-to-generator
   modulation.

---

## 8. Open questions and things to verify first

- ~~**SC virtual MIDI outputs.**~~ Tested 2026-09-26: SC 3.14 on macOS creates **no** virtual
  ports (`MIDIOut(0, 0)` fails; nothing appears in CoreMIDI). The brain sends to IAC buses instead,
  listed in `brain/config.scd` (Bus 1, Bus 2 now; add more buses in Audio MIDI Setup for more
  destinations). The brain must never listen to these buses as input, or it hears its own output.
- **REAPER headless/scripted testing:** whether REAPER can run a setup script and render from the
  command line well enough for automated checks. Nice to have, not required: the brain is
  verified on its own and REAPER only has to receive MIDI.
- **Capture gesture:** implemented as "every note pressed until all keys are up" (overlapping
  releases count). Pedal-triggered or timed window: revisit after playing with it.
- **Multiple notes per generator** (chords from a source) vs. one note per generator. Start with
  one; chord-playing generator types can come later.

---

## 9. Carried over from the POC (`archive/sc-electron-poc/`)

Useful code and lessons:

- **Electron OSC plumbing** (`app/main.js`, `app/preload.js`): minimal OSC encode/decode over UDP,
  exposed to the renderer via `contextBridge`. Reuse as-is.
- **UI pieces** (`app/index.html`): Nord palette, tempo dial, beat indicator, note name + octave
  selects, grid/card layout (use `minmax(0, 1fr)` columns so long names don't overflow).
- **Grid-alignment scheduling** (`engine/types/repeat.scd`): the `k · d` grid logic, verified.
- **Gotchas:**
  - Electron's binary download may be skipped by npm; run `node node_modules/electron/install.js`.
  - In sclang, `a = e[\k] = x` assigns the Event, not `x` (`put` returns the receiver).
  - `Scale` uses `performDegreeToKey`, not `degreeToKey`.
  - Timestamp everything that touches the output (note-offs and frees too), or queued events
    arrive after the target is gone.
- **Environment:** SuperCollider 3.14 at `/Applications/SuperCollider.app`; VSTPlugin 0.6.2 is
  installed in the user Extensions folder (supernova binary removed to avoid an Objective-C class
  clash). Not needed by the new brain, but harmless.
