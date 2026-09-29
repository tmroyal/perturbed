# Perturbed — plan

Perturbed is an algorithmic performance toolbox: generators on shared clocks read the chord you
play and send MIDI to instruments in a DAW, played from the Perturbed app. The system works end to
end today with Ableton Live (§5 describes it). **First the rest of the pivot from REAPER to Live
(§0: checking Link with Live)**; then Claude inside the app (§1).

**The idea.** A performer describes the piece they want to play ("two pianos phasing on an
arpeggio of whatever I play, a slow bass on the lowest note, echo my right hand an octave up")
and Claude sets up the performance interface: outputs, clocks, generators and their settings,
tempo. Claude arranges the instrument; it does **not** rewrite the app. Its brief is
[AGENTS.md](AGENTS.md).

---

## 0. Migration: REAPER → Ableton Live (in progress)

**Status (2026-09-28):** 0.1 done (a hand-made set plays the brain), 0.2 step 1 done (the bridge
connects and logs outputs; track setup deferred), 0.3 built (LinkClock; verify with Live),
0.4 done (REAPER removed).

**Why.** Live is what gets used for live performance; REAPER isn't used often enough to be the
sound rack. REAPER was chosen for its MIDI routing and ReaScript, but the brain now does all the
routing itself (each output is one IAC bus + channel), so Live's simpler per-track MIDI input is
enough. What we lose is scripted setup (`setup.lua`); what we gain is Ableton Link and the
performer's usual instrument.

**What doesn't change.** The brain, the protocol, the surface and performance files. The brain
sends MIDI on IAC buses to whatever listens, so the pivot is almost entirely on the DAW side.
"Outputs" stay (IAC port, channel) pairs; each becomes a Live MIDI track instead of a REAPER track.

### 0.1 Routing: a Live Set that listens to the brain *(done)*

- A Live Set, `ableton/Perturbed Project/Perturbed.als`, with one MIDI
  track per default output: *Piano 1* = MIDI From *IAC Driver (Bus 1)*, Ch. 1; *Piano 2* = Bus 1,
  Ch. 2; Monitor **In** (plays incoming MIDI without arming or recording), instrument loaded.
- One-time Live setup: Preferences → Link, Tempo & MIDI → MIDI Ports: IAC Bus 1 and 2 with
  **Track** on for input. Remote/Sync stay off for these ports so Live doesn't treat the brain's
  notes as control messages.
- Keep the performer's keyboard out of the IAC buses. It reaches the brain directly, and a Live
  track only hears it through a passthrough generator (or an ordinary Live track set to it, if wanted).
- **Verify:** `tests/demo.scd` plays on both tracks; `tests/run.sh` still passes (it plays on
  Bus 1 ch 1–2, so Live will sound it, as REAPER did).

### 0.2 The Perturbed Bridge (Max for Live) *(step 1 done; track setup deferred)*

A Max for Live device, **Perturbed Bridge**, lives on a track in the set. It speaks the brain's
OSC protocol as one more surface, so the brain needs no Live-specific code. Step 1 (done): it
connects (`/hello 57150`: the brain replies to the named port, since `udpsend` sends from a random
one), follows brain restarts, and logs outputs to the Max Console. Outputs are set up by hand for
now; automatic track setup below is deferred until it earns its keep:

- **Patch** (`ableton/Perturbed Bridge.amxd`, a MIDI Effect device): `[udpreceive 57150]` →
  `[js bridge.js]` → `[udpsend 127.0.0.1 57120]`. All logic is in `ableton/bridge.js` (plain
  text, diffable, editable without Max); the `.amxd` stays a thin shell saved from Max.
- **Protocol:** the bridge sends `/hello` (and `/ping`, re-`/hello` on a new boot id, like the
  app) and receives the snapshot and live updates. It only acts on outputs (`/dest`,
  `/dest/removed`) and the transport; it ignores the rest.
- **Tracks** via the Live API (`LiveAPI` in `bridge.js`): for each output, find the MIDI track
  with the output's name or create one (`live_set create_midi_track`); set its input routing to
  the output's IAC bus and channel (`input_routing_type`, `input_routing_channel`), monitoring to
  In, and its name. Idempotent: existing tracks are matched by name and only re-routed.
- **Instruments:** loaded by hand. A new track is an empty MIDI track, already routed; the
  performer drops the instrument on it (the Live API can't load third-party plugins, and copying
  hidden template tracks was rejected as too fiddly). The output's `instrument` is a label.
- **Removed outputs** leave their tracks alone (they may hold the performer's sound design);
  the bridge only unassigns their input.

Later, the bridge is also where Live control goes: Claude's Live commands (§2.2) and reading Live
state (track names, instruments) back into the app.

### 0.3 Tempo and transport: Ableton Link *(built; to verify with Live)*

Built: the main clock is a persistent LinkClock (quantum 4, latency = MIDI latency); play puts
the grid origin at the start of the current Link bar (`~beats` counts from there), so generators
start at once, on Live's bar lines. Tempo changes go both ways. Test mode keeps a fresh
TempoClock per play and stays out of the Link session. Start/stop sync not done.


- Make the brain's main clock a **LinkClock** (built into SuperCollider) so Live and the brain
  share tempo and beat phase. Metric modulation and the tempo dial then change Live's tempo too,
  and Live's tempo changes reach the brain (the surface shows them; the brain stays authoritative
  for everything else).
- Extra clocks (ratio/factor/free) stay local TempoClocks derived from main, as now.
- Decide who owns play: Perturbed's Play (as now), with Link start/stop sync optional so Live's
  transport follows (useful when recording the performance into Live).
- **Verify:** with Link on, the timing test's grid still holds; Live's metronome and the brain's
  beat pulse agree.

### 0.4 Retire REAPER *(done)*

- Removed `reaper/` and the brain's `destinations.json` writer; README, AGENTS.md, `run.sh`, the
  Outputs pane hint and §5 describe Live. §2.2 is now Claude and Live.

### 0.5 Open questions

- Max for Live in use (decided 2026-09-28): the bridge needs Live Suite, or Standard + the
  Max for Live add-on.
- Live API routing names: `input_routing_type` display names for IAC buses (e.g. "IAC Driver
  (Bus 1)") and channels ("Ch. 1") must be matched by name (only if track setup is built).
- Latency: Live's MIDI input path on top of the brain's 50 ms scheduling latency; retune
  `latency` in `brain/config.scd` if the surface feedback and the sound drift apart.
- Whether passthrough should stay in the brain or become a plain Live track listening to the
  keyboard (lower latency) when no transpose/zone/delay is needed.

---

## 1. Next: Claude in Perturbed

### 1.1 A terminal drawer running Claude Code

- **Renderer:** [xterm.js](https://xtermjs.org/) in a drawer that slides up from the bottom of the
  window (toggle with a shortcut, e.g. ⌘`), so it stays out of the way while playing.
- **Main process:** [node-pty](https://github.com/microsoft/node-pty) spawns a login shell running
  `claude` with the repo as its working directory and `PERTURBED_AGENT=1` in the environment (so
  AGENTS.md knows it is the performance assistant). Bytes flow over the existing IPC bridge
  (`preload.js` gains a `term` channel next to `osc` and `files`).
- **Build:** node-pty is a native module and must be compiled against Electron's Node ABI:
  `@electron/rebuild` in `surface/`, which needs Xcode command-line tools. Add it to the install
  step in `run.sh`, next to the Electron binary check.
- **Lifecycle:** one terminal per window; the pty is killed when the window closes. Resizing the
  drawer resizes the pty (xterm fit addon → `pty.resize`).
- **Auth:** the `claude` CLI uses the user's existing login; nothing to configure.
- **Done when:** the drawer opens, Claude Code runs in it, and it can read the repo and AGENTS.md.

### 1.2 Setup tools: Claude drives the brain

Claude sets up performances through the brain's OSC protocol, the same one the surface uses, so
everything it does appears live on the surface and the performer can adjust it by hand.

- **Now (already possible):** write a performance file to `performances/` (format in AGENTS.md)
  and ask the performer to Open it, or send `/load <path>`.
- **Step 1 — `tools/perturbed` CLI** (Node, reusing `surface/osc.js`): small commands Claude can
  call from its shell, each printing the brain's reply:
  - `perturbed state` — the current snapshot as JSON (generators, params, outputs, clocks, chord)
  - `perturbed schema` — generator types and their params (kinds, ranges, choices, labels)
  - `perturbed add <type>`, `perturbed set <id> <param> <value>`, `perturbed remove <id>`
  - `perturbed output add <name> <port> <channel> <instrument>`, `perturbed clock add|set|remove`
  - `perturbed tempo <bpm>`, `perturbed load <file>`, `perturbed save <file>`
  - `perturbed chord <pitch>...` (set the chord for auditioning)
  It talks to the brain on a port of its own (the brain accepts any sender that says `/hello`).
- **Step 2 — MCP server** (optional, once the CLI shows which moves matter): the same commands as
  typed tools, so Claude sees parameter ranges and choices without reading AGENTS.md.
- **Guardrails:** tools can only send protocol messages, so Claude cannot break the brain. It
  should not start or stop the transport unless asked (the performer owns play/stop), and it
  saves a performance before replacing one (`perturbed save performances/before-<time>.json`).
- **Done when:** from the drawer, "set up two phasing arpeggios on Piano 1 and 2" produces working
  generators on the surface without the performer touching anything but Play.

---

## 2. Later: Claude goes further

### 2.1 AdHoc generators

Claude writes a one-off generator type for the piece at hand (a strum, a tintinnabuli voice, a
canon of another generator), called **AdHoc**.

- AdHoc types live in `brain/adhoc/` (git-ignored, per performance), never in `brain/types/`.
  The app's own types stay the performer's and the developer's; AGENTS.md keeps Claude out of them.
- **Hot reload:** a `/reload` message re-reads type files and resends the schema, so a new type
  appears as a `+ …` button at once; running generators keep running. The surface already builds
  cards from the schema, so no surface code is needed.
- **Isolation:** a type that fails to load or throws in `run` must not take the brain down: load
  inside `try`, keep the previous version on error, and report the error back to the terminal.
- A performance file that uses an AdHoc type records it, so saving/opening carries the type along
  (copy the type file next to the performance, or embed its source).

### 2.2 Claude and Live

Claude sets up the sound side too, through the bridge (§0.2): new protocol messages (e.g.
`/live/track/volume`, `/live/record`, `/live/clip/launch`) that the brain forwards and the bridge
carries out with the Live API, exposed as `perturbed live ...` commands. Instruments stay loaded
by hand (the Live API can't load third-party plugins). The Live Set is saved alongside the
performance file (it holds instruments and their state).

---

## 3. Backlog (from the original plan, unfinished)

- **More generator types:** chord/strum (plays the whole chord or a voicing; settles "multiple
  notes per generator"), canon/echo of another generator, walk, phase, additive process, tone
  row, cloud, drone, CC generator (velocity-mode shapes sent as controller curves). Some of these
  may start life as AdHoc types and graduate to `brain/types/`.
- **Other note sources:** scale (root + scale → pitches over a range), sequence, transforms
  (transpose, invert, subset) of the chord.
- **Modulation / controllers:** CC mapping (MiniLab knobs) to any generator parameter;
  generator-to-generator modulation.
- **Swing** as a rhythm-timing feel.
- **Open questions:**
  - Pedal gestures for the chord (sustain pedal to latch or arm).
  - Metric modulation at the next beat instead of immediately.

---

## 4. Working on Perturbed (developers)

- `./tests/run.sh` (~30 s) starts a test brain on port 57140 and runs the timing, generator and
  protocol tests; it plays MIDI on IAC Bus 1 channels 1–2. Keep it green and short.
- The OSC protocol's authoritative list is the header of `brain/core/osc.scd`.
- **Gotchas:**
  - SuperCollider 3.14 on macOS creates no virtual MIDI ports; the brain uses IAC buses and must
    never listen to them as input (it would hear its own output).
  - sclang binary operators have no precedence: `a + b * c` is `(a + b) * c`. Parenthesize.
  - `var` declarations only at the start of a block.
  - `Array.includes` compares by identity: `0.0` is not `0`. Keep grid indexes integers.
  - `MIDIOut.latency` counts from send time, not logical time; a fixed latency keeps messages in
    order, which matters for note-off/note-on of a repeated pitch.
  - sclang ignores SIGTERM (use `kill -9`) and rejects unknown command-line flags (use env vars).
  - `a = e[\k] = x` assigns the Event, not `x` (`put` returns the receiver).
  - Electron's binary download may be skipped by npm; run `node node_modules/electron/install.js`.
  - ImageMagick's SVG renderer drops stroked circles; the icon script renders with Quick Look.

---

## 5. The system today (reference)

### 5.1 Architecture

```
 MIDI keyboard ──MIDI──▶ ┌──────────────────────────────┐
                         │ BRAIN (sclang)               │ ──MIDI──▶ Ableton Live
 Perturbed app ◀──OSC──▶ │ clocks · chord · generators  │  IAC       tracks: instrument,
                         │ outputs · state · files      │  buses     effects, mixer
                         └──────────────────────────────┘ ◀──OSC──▶ Perturbed Bridge (M4L)
```

- **Brain (SuperCollider, `brain/`):** owns time and all musical state; runs generators; emits
  MIDI. Authoritative: surfaces (and Claude's tools) send intents and render what it reports.
  Saves/loads performances (JSON; plugin state lives in the Live Set).
- **Sound rack (Ableton Live, `ableton/`):** one MIDI track per output, MIDI From an IAC bus +
  channel, Monitor In; set up by hand. The Perturbed Bridge (`bridge.js` in a Max for Live
  device) joins the brain as a surface; it only logs so far (§0.2).
- **Perturbed (Electron, `surface/`):** renders the brain's state; cards are built from the type
  schema (params, labels, sections, showWhen), so new types need no surface code.

Why this split: a toolbox is mostly about what happens *between* generators (shared chord,
clocks, references, live changes), which needs one shared model of musical state; DAW plugin
architectures don't provide that, but DAWs are good at hosting, mixing and saving plugin state.
(The first proof of concept, SC hosting VSTs directly, is in `archive/`.)

### 5.2 Concepts

- **Chord:** one current chord, latched. Auto: every chord played replaces it on release. Arm:
  only the next chord after pressing Arm. Clear empties it.
- **Generators:** a type + params + an output. Types (`brain/types/`) declare `params` and `run`
  (clock-driven) and/or `key` (keyboard-driven), plus optional `showWhen`, `labels`, `sections`,
  `restartOn`. Shared modules: `pitch.scd` (which note), `rhythm.scd` (grid and which steps
  play), `velocity.scd` (how loud), `~clockParam` (which clock).
- **basic:** one note at a time on a grid of num/den beats, each released by the next.
  Pitch from a set note or the chord (index, lowest, highest, arpeggio up/down/up-down, permute);
  rhythm every/euclid/random/phrase; velocity set/accent/random/drift/ramp/pattern + humanize.
- **passthrough:** the keyboard into an output, transposed, zoned (lowest..highest), optionally
  delayed by beats; works with the transport stopped.
- **Clocks:** A is the main clock (transport tempo). B, C, ... run at main × ratio, main × factor,
  or a free bpm; all share beat 0 at play. Metric modulation multiplies the main tempo by a fraction.
- **Outputs** (the brain's *destinations*): (IAC port, channel) pairs, one Live track each.

### 5.3 Timing

- All scheduling runs on clocks in logical time (main: a LinkClock shared with Live, §0.3); onsets land within a few ms of the grid
  (`tests/timing.scd`). MIDI is timestamped 50 ms ahead (`latency` in `brain/config.scd`);
  surface feedback (`/beat`, `/note`) is sent at the same delay so it lines up with the sound.
- Onsets fall on `k · num/den` beats from the grid origin (the Link bar where play was pressed); changing num/den (or clock) restarts on the next
  point of the new grid, so generators keep their ratios. A sounding note is released by the next.
- Passthrough notes go out immediately (or after their delay), not through the scheduling latency.
