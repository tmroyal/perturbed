# Perturbed — plan

Perturbed is an algorithmic performance toolbox: generators on shared clocks read the chord you
play and send MIDI to instruments in a DAW, played from the Perturbed app. The system works end to
end today with REAPER (§5 describes it). **First comes a hard pivot from REAPER to Ableton Live
(§0)**; then Claude inside the app (§1).

**The idea.** A performer describes the piece they want to play ("two pianos phasing on an
arpeggio of whatever I play, a slow bass on the lowest note, echo my right hand an octave up")
and Claude sets up the performance interface: outputs, clocks, generators and their settings,
tempo. Claude arranges the instrument; it does **not** rewrite the app. Its brief is
[AGENTS.md](AGENTS.md).

---

## 0. Migration: REAPER → Ableton Live (do first)

**Why.** Live is what gets used for live performance; REAPER isn't used often enough to be the
sound rack. REAPER was chosen for its MIDI routing and ReaScript, but the brain now does all the
routing itself (each output is one IAC bus + channel), so Live's simpler per-track MIDI input is
enough. What we lose is scripted setup (`setup.lua`); what we gain is Ableton Link and the
performer's usual instrument.

**What doesn't change.** The brain, the protocol, the surface and performance files. The brain
sends MIDI on IAC buses to whatever listens, so the pivot is almost entirely on the DAW side.
"Outputs" stay (IAC port, channel) pairs; each becomes a Live MIDI track instead of a REAPER track.

### 0.1 Routing: a Live Set that listens to the brain

- A template Live Set, `ableton/Perturbed.als` (in `ableton/`, replacing `reaper/`), with one MIDI
  track per default output: *Piano 1* = MIDI From *IAC Driver (Bus 1)*, Ch. 1; *Piano 2* = Bus 1,
  Ch. 2; Monitor **In** (plays incoming MIDI without arming or recording), instrument loaded.
- One-time Live setup: Preferences → Link, Tempo & MIDI → MIDI Ports: IAC Bus 1 and 2 with
  **Track** on for input. Remote/Sync stay off for these ports so Live doesn't treat the brain's
  notes as control messages.
- Keep the performer's keyboard out of the IAC buses. It reaches the brain directly, and a Live
  track only hears it through a passthrough generator (or an ordinary Live track set to it, if wanted).
- **Verify:** `tests/demo.scd` plays on both tracks; `tests/run.sh` still passes (it plays on
  Bus 1 ch 1–2, so Live will sound it, as REAPER did).

### 0.2 Setting up outputs without `setup.lua`

Live has no ReaScript; options, in order:

1. **Manual, by convention (start here):** the Outputs pane shows each output's bus/channel; the
   performer adds a Live MIDI track with that input. Name tracks after outputs. The template
   covers the defaults.
2. **AbletonOSC** (an open-source Live remote script exposing the Live Object Model over OSC):
   the brain (or `tools/perturbed`) creates and names tracks and sets their input routing and
   monitoring from the output list. Loading third-party instruments through the API is limited,
   so instruments likely stay a manual step (or come from a template track the script duplicates).
3. **Max for Live device** in the set doing the same from inside Live (needs Live Suite / M4L).

The brain's `destinations.json` writer and `reaper/setup.lua` are retired once (1) or (2) works.

### 0.3 Tempo and transport: Ableton Link

- Make the brain's main clock a **LinkClock** (built into SuperCollider) so Live and the brain
  share tempo and beat phase. Metric modulation and the tempo dial then change Live's tempo too,
  and Live's tempo changes reach the brain (the surface shows them; the brain stays authoritative
  for everything else).
- Extra clocks (ratio/factor/free) stay local TempoClocks derived from main, as now.
- Decide who owns play: Perturbed's Play (as now), with Link start/stop sync optional so Live's
  transport follows (useful when recording the performance into Live).
- **Verify:** with Link on, the timing test's grid still holds; Live's metronome and the brain's
  beat pulse agree.

### 0.4 Retire REAPER

- Remove `reaper/` and the `destinations.json` writer (or retarget it if AbletonOSC setup uses it).
- Update README (setup steps), AGENTS.md ("each output is a Live track"; outputs need a Live
  track rather than `setup.lua`), `run.sh` comments, the Outputs pane hint, and §5 below.
- §2.2 becomes **Claude and Live**: AbletonOSC (or an Ableton MCP server) lets Claude create and
  route tracks, arm/record, set levels and devices, and launch clips for a performance.
- The Live Set is saved alongside the performance file (it holds instruments and their state).

### 0.5 Open questions

- Live edition: Suite (Max for Live) or Standard? Decides whether option 3 in §0.2 is available.
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

### 2.2 Claude and REAPER *(superseded: becomes Claude and Live, see §0.4)*

Claude sets up the sound side too: adds the tracks a performance needs, loads instruments and
presets, sets levels and effects.

- **Run `setup.lua` automatically:** REAPER's OSC control surface (`/action/<command id>`)
  triggers the script when outputs change (also useful without Claude: the surface's Outputs
  pane could do it).
- **Richer control:** ReaScript beyond setup (instrument choice per track, FX chains, volume) via
  a command file the brain writes and a deferred script in REAPER that polls it, or REAPER's web
  interface. Expose it as `perturbed reaper ...` commands.
- The REAPER project is saved alongside the performance file.

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
  - ~~REAPER headless/scripted testing~~ (moot after §0):  can REAPER run a setup script and render from the command
    line well enough for automated checks? Nice to have; the brain is verified on its own.
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
                         │ BRAIN (sclang)               │ ──MIDI──▶ REAPER
 Perturbed app ◀──OSC──▶ │ clocks · chord · generators  │  IAC       tracks: instrument,
                         │ outputs · state · files      │  buses     effects, mixer
                         └──────────────────────────────┘
```

- **Brain (SuperCollider, `brain/`):** owns time and all musical state; runs generators; emits
  MIDI. Authoritative: surfaces (and Claude's tools) send intents and render what it reports.
  Saves/loads performances (JSON; plugin state lives in the REAPER project).
- **Sound rack (REAPER, `reaper/`):** one track per output, record-armed in monitor-only mode,
  listening to an IAC bus + channel; `setup.lua` builds them from `destinations.json`.
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
- **Outputs** (the brain's *destinations*): (IAC port, channel) pairs, one REAPER track each.

### 5.3 Timing

- All scheduling runs on TempoClocks in logical time; onsets land within a few ms of the grid
  (`tests/timing.scd`). MIDI is timestamped 50 ms ahead (`latency` in `brain/config.scd`);
  surface feedback (`/beat`, `/note`) is sent at the same delay so it lines up with the sound.
- Onsets fall on `k · num/den` beats from play; changing num/den (or clock) restarts on the next
  point of the new grid, so generators keep their ratios. A sounding note is released by the next.
- Passthrough notes go out immediately (or after their delay), not through the scheduling latency.

### 5.4 REAPER integration *(until the Live migration, §0)*

- `reaper/setup.lua` reads `reaper/destinations.json` (written by the brain) and creates/updates
  one track per output: name, MIDI input (IAC bus found by name, channel), monitor-only arm,
  instrument by name. Idempotent; tracks without a MIDI input are left unarmed (no feedback).
- Run it from REAPER's Actions list after output changes (automating this: §2.2).
- One-time: enable the IAC buses as MIDI inputs in REAPER's preferences.
