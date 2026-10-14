# AGENTS.md

This repo is **Perturbed**, an algorithmic performance instrument (see [README.md](README.md)).
Agents work here in one of two roles. Check which one you are in before doing anything.

- **Performance assistant** — you were started from the Claude drawer inside the Perturbed app
  (`PERTURBED_AGENT=1` is set in your environment). Follow *Setting up performances* below.
- **Developer** — you were started in this repo to change Perturbed itself. Follow
  *Developing Perturbed* at the end, and [PLAN.md](PLAN.md).

---

## Setting up performances

Your job is to **set up the performance interface** for the performer: outputs, clocks,
generators and their settings, tempo, the starting chord. You arrange the instrument; you do not
change it.

### Rules

- **Do not edit the app:** nothing under `brain/`, `surface/`, `ableton/`, `tests/`, and not
  README/PLAN/AGENTS. If a piece needs a kind of generator that doesn't exist, **write an AdHoc
  type** (below); if it needs a change to the app itself, suggest they ask a developer.
- **You may write** performance files in `performances/` and AdHoc types in `adhoc/`.
- **The performer owns play/stop.** Don't start or stop the transport unless asked
  (`tools/perturbed play`/`stop` exist for when they do).
- **Don't lose work.** Before replacing the current performance (`load`, `new`, or removing most of it),
  save it (`tools/perturbed save performances/before-<time>.json`) or confirm with the performer.
- Explain what you set up in musical terms (which generator plays what, against what) so the
  performer can adjust it by hand on the surface.

### How to set up a performance

Use **`tools/perturbed`** to change the running performance directly: every change shows on the
performer's surface at once, and they can adjust it by hand. Start with `tools/perturbed state`
(what's there now) and `tools/perturbed schema` (every setting's range and options). Settings are
checked before they're sent, and errors say what's allowed.

```sh
tools/perturbed state                                   # generators, outputs, clocks, chord, Live tracks (JSON)
tools/perturbed add basic source=arpeggio direction=up-down num=1 den=4 output="Piano 1"
tools/perturbed set 3 rhythm=euclid pulses=5 steps=8 velMode=accent
tools/perturbed on 3                                    # off 3, remove 3
tools/perturbed clock add mode=factor factor=1.01       # then: set 3 clock=B
tools/perturbed output live "Rhodes"                    # a Live track (from the bridge) -> an output
tools/perturbed output add "Piano 3" 1 3 "Pianoteq 9"
tools/perturbed tempo 84                                # scale 3 2 for metric modulation
tools/perturbed chord C3 G3 E4 B4                       # audition a chord; the performer's playing replaces it
tools/perturbed add lfo shape=triangle num=16 den=1 port="Perturbed CTL 1" channel=1 cc=20
tools/perturbed add lfo shape=sine num=8 den=1 sendCC=off   # then: map <its id> 3 velocity 40 110
tools/perturbed save performances/<name>.json           # load replaces everything
```

**Build pieces in groups,** one per layer (`tools/perturbed group add "Phasing pianos"`, then
`group="Phasing pianos"` on its generators). The performer brings layers in and out with the
group's On/Off and Solo, which mute without losing time, and folds finished groups away; fold the
ones you set up (`group set "Phasing pianos" collapsed=on`) so the surface stays readable. Pin
the few settings worth playing live to the group's header (`group pin "Phasing pianos" 3 velocity`):
they stay visible when the group is folded.

**Give pieces a few global parameters:** one control that reshapes a lot at once (a global, 0–1,
in the sidebar), each mapped setting with its own range and curve. Name them for what they do to
the music ("density", "brightness"; the default is "Meta 1"), and tell the performer what each one
moves:

```sh
tools/perturbed global add density
tools/perturbed global map density 3 prob 20 90            # from → to, in the setting's units
tools/perturbed global map density 4 pulses 3 7 steps      # curves: linear, exp, steps, threshold
tools/perturbed global map density 2 velocity 100 60 exp   # from > to inverts it
tools/perturbed global set density value=0.3
```

A global can belong to a group (`global add intensity group="Phasing pianos"`, or `global set intensity
group=...`; `group=none` takes it back): it's the same thing, shown on the group's header, where it stays at
hand when the group is folded. Give each layer one or two of these for what the performer will play.

A mapped setting is locked (setting it says so); `global unmap` frees it. A global can follow a
knob on the performer's controller (they learn it in the app with **Knob**; or `global knob density
1 74` for channel 1, CC 74), which puts everything it moves under one hand. Several globals can
share a knob and answer it differently: `global set density response=invert` (linear, invert, exp,
log, or `response=formula formula="x * x"`, an expression in x from 0 to 1). Settings that restart a
generator (num, den, clock) can't be mapped.

A generator or group can have an on/off key, a MIDI note the performer hits to switch it (the
chord ignores it): `tools/perturbed key gen 3 C1`, `key group "Phasing pianos" D1`, `none` to forget.

Cards show in the order of `state`'s generators; arrange them so related ones sit together
(`tools/perturbed move 5 before=2`, `move 5 group="Phasing pianos"`, `move 5` for the end).

Fold generators the performer won't touch (`set 3 collapsed=on`): a folded card is one line.

Notes are MIDI numbers or names (C4 = 60); outputs and clocks can be named (`output="Piano 1"`,
`clock=B`). Add generators off, set them up, then turn them on (or leave that to the performer).
`tools/perturbed help` lists every command.

**Whole pieces** can also be a performance file in `performances/` (format below) that the
performer opens (**Open…**), or `tools/perturbed load <file>`. Loading replaces everything and
stops the transport; generators keep their on/off state, so Play starts the piece.
`performances/example.json` is a complete, working example.

### Performance file format

```json
{
  "tempo": 96,                        // main clock (A), bpm 20–400
  "clocks": [                         // extra clocks B (id 1), C (id 2), ...
    {"id": 1, "mode": "factor", "factor": 1.01, "num": 1, "den": 1, "bpm": 96}
  ],
  "destinations": [                   // outputs: one Live MIDI track each
    {"id": 1, "name": "Piano 1", "port": 1, "channel": 1, "instrument": "Pianoteq 9"}
  ],
  "globals": [                        // optional: global parameters and what they move
    {"id": 1, "name": "density", "value": 0.3,       // "group": 1 puts it on that group's header
     "mappings": [{"gen": 1, "param": "prob", "from": 20, "to": 90, "curve": "linear"}]}
  ],
  "groups": [                         // optional: layers the performer switches, solos and folds
    {"id": 1, "name": "Phasing pianos", "on": true, "solo": false, "collapsed": true,
     "pins": [[1, "velocity"]]}            // [generator id, setting] shown on the folded header
  ],
  "generators": [
    {"id": 1, "type": "chord", "dest": 0, "active": true, "params": {"notes": "A3 C4 E4 G4"}},   // the main chord
    {"id": 2, "type": "basic", "dest": 1, "group": 1, "active": true, "params": {"source": "arpeggio"}}
  ]
}
```

(Comments are for this document only; JSON files can't contain them.) Params left out keep their
defaults. `dest` is an output id (0 = none), `group` a group id (0 = none); `active` true means on.
A generator sounds when it's on, its group is on, and no other group is soloed.

**Outputs.** `port` is an IAC bus (1 = Bus 1, 2 = Bus 2), `channel` 1–16. Each output is a Live
MIDI track the performer makes (MIDI From that bus and channel, Monitor In, an instrument
loaded); the Perturbed Bridge reports those tracks and the app offers them as outputs.
`instrument` is only a label. A new performance has no outputs: look at `live_tracks` in `state`
and make outputs from Live's tracks (`tools/perturbed output live`), reuse existing outputs where
you can, and tell the performer when a new one needs a Live track, with its bus, channel and the
instrument you had in mind.

**Clocks.** `mode` is `ratio` (main × num/den), `factor` (main × factor; 1.01 phases slowly
against main) or `free` (its own `bpm`). Ratio and factor clocks follow main tempo changes.

### Generator types and params

**basic** — one note at a time on a grid of num/den beats, each note released by the next (or
after its own `duration`).

| param | values (default) | meaning |
|---|---|---|
| `source` | note, index, lowest, highest, arpeggio, permute (note) | where the pitch comes from; all but `note` read the current chord and rest while it is empty |
| `note` | 0–127 (60) | pitch for `source: note` (60 = C4) |
| `index` | −16–16 (0) | chord note for `index`: 0 = lowest, −1 = highest, wraps |
| `direction` | up, down, up-down (up) | for `arpeggio` |
| `permutation`, `advance` | 0–719 (0), 0–32 (1) | for `permute`: plays chord.permute(n), n starting at `permutation`, moving ahead by `advance` each pass |
| `num`, `den` | 1–32 (1, 1) | grid step = num/den beats |
| `rhythm` | every, euclid, random, phrase (every) | which grid steps play; a skipped step lets the previous note ring on |
| `interval`, `offset` | 1–32 (1), 0–31 (0) | `every`: every interval-th step from offset (offset also rotates `euclid`) |
| `pulses`, `steps` | 1–19 (3), 2–19 (8) | `euclid`: pulses spread over steps |
| `prob` | 0–100 (50) | `random`: chance per step, % |
| `phrase` | text ("1 2 1 1 2") | `phrase`: gaps between notes in steps, cycling |
| `chance` | 0–100 (100) | % of the rhythm's notes that actually play (the pattern keeps its place) |
| `length`, `duration` | hold, percent (hold); 1–400 (100) | `hold`: each note lasts until the next; `percent`: `duration` % of the grid step (over 100 rings into skipped steps) |
| `velMode` | set, accent, random, drift, ramp, pattern (set) | velocity mode |
| `velocity` | 1–127 (80) | `set`; also the unaccented value for `accent` |
| `accent`, `every` | 1–127 (110), 1–32 (4) | `accent`: accent on every n-th grid step |
| `low`, `high` | 1–127 (40, 100) | range for `random`, `drift`, `ramp` |
| `rate` | 0.05–8 (0.5) | `drift`: new targets per beat |
| `attack`, `decay` | 0–64 beats (4, 4) | `ramp`: rise and fall times |
| `pattern` | text ("110 60 80 60") | `pattern`: velocities per grid step, cycling |
| `humanize` | 0–32 (0) | random ± on top of any mode |
| `chord` | main, or a chord strip's id (main) | which chord strip the chord sources read; main = the first in the rack |
| `clock` | 0 = A (main), or a clock id (0) | which clock's beats it runs on |

**chord** — a chord strip: listens to the keyboard and holds a chord for generators to read. It makes
no sound. A new performance has one (the main chord); add more so layers can follow different chords,
or the same playing at different transpositions (`add chord semitone=7`, then `set 3 chord=<its id>`).
`tools/perturbed chord C3 G3 E4` sets the main one.

| param | values (default) | meaning |
|---|---|---|
| `take` | every chord, next chord, hold (every chord) | which chords it takes; `next chord` takes one, then holds (the strip's **Arm**) |
| `build` | on release, as played (on release) | on release: replaced when the last key comes up; as played: built key by key until the last key comes up |
| `notes` | text ("") | the chord it holds, as note names (`"A2 C3 E3"`); set it to give a starting chord |
| `octave`, `semitone` | −4–4, −12–12 (0, 0) | transpose what generators hear |
| `input` | any, or an input's name (any) | listen to one keyboard only |
| `lo`, `hi` | 0–127 (0, 127) | listen to this key range only |

On = listening; off, it keeps its chord.

**passthrough** — plays the keyboard into its output while on (transport running or not).

| param | values (default) | meaning |
|---|---|---|
| `octave`, `semitone` | −4–4, −12–12 (0, 0) | transpose |
| `lo`, `hi` | 0–127 (0, 127) | only keys in this range pass (a zone; the key as played) |
| `delay` | 0–16 beats of the main tempo, quarter steps (0) | delay notes (and note-offs) |

**lfo** — a slow wave that moves things. It can **drive settings of other generators**
(`tools/perturbed map <lfo id> <gen id> <setting> <from> <to>`: each target has its own range, is
locked while driven, and follows one driver, an lfo or a global; another lfo's `hz`, `phase`, `low`
or `high` can be a target), and/or send **MIDI CC** on a control bus for Live to map to a parameter
(MIDI Map mode; tell the performer which channel/cc you used and what it's meant to move, since that
mapping is done by hand in Live). Set `sendCC=off` for an lfo that only moves settings. It only
moves things while it's on and the transport runs.

| param | values (default) | meaning |
|---|---|---|
| `shape` | sine, triangle, saw up, saw down, square, random, smooth random (sine) | wave |
| `rate` | sync, free (sync) | sync: a cycle per num/den beats of `clock`, lined up with the bar; free: `hz` |
| `num`, `den` | 1–64, 1–32 (4, 1) | cycle length in beats, for sync |
| `hz` | 0.01–20 (0.25) | cycles per second, for free |
| `phase` | 0–1 (0) | start point in the cycle |
| `scale`, `add` | 0–1 (1), −1–1 (0) | how much gets through: wave × scale + add, for its targets and CC alike; map a global to `scale` to fade an lfo's effect in and out |
| `sendCC` | on, off (on) | whether it sends MIDI CC (the settings below) |
| `low`, `high` | 0–127 (0, 127) | CC range (low > high inverts) |
| `port` | a control bus by name ("Perturbed CTL 1") | which control bus |
| `channel`, `cc` | "1"–"16" ("1"), 0–127 (1) | where it goes on that bus (channel is a menu: a string) |
| `clock` | clock id (0) | for sync |

### Musical building blocks

- **Polyrhythm:** generators on one clock with different `num/den` (1/1 against 3/4 meet every 3 beats).
- **Phasing:** identical generators on A and on a `factor` clock of 1.005–1.02.
- **Polytempo:** a `ratio` clock (e.g. 3/2) keeps a fixed relation to main.
- **Harmony follows the player:** chord sources (`index`, `arpeggio`, `permute`, `lowest`/`highest`)
  re-voice whenever the performer plays a new chord; `note` stays fixed.
- **Splits and echoes:** passthroughs with different zones and outputs; a delayed, transposed
  passthrough makes a live canon.

### Writing AdHoc generators

When no existing type does what the piece needs (a strum, a canon of another generator, a
tintinnabuli voice, a drone that breathes), write one. Every type you write is kept in the
performer's library (`adhoc/`, in git): they can star it as a favorite, and bring it back for
another piece, so write it to last.

**First, look in the library:** `tools/perturbed adhoc list` (names, descriptions, stars). The
performer may mean one that exists ("the rolling strum from last week"): `adhoc show <name>`, then
`add <name>` (loads it if needed).

**Workflow:**
1. Write `adhoc/<name>.scd` (lowercase, hyphens: `rolling-strum`).
2. `tools/perturbed adhoc check <name>`: sclang's syntax error with the line, if any.
3. `tools/perturbed add <name> output="Piano 1" group=...`: loads it and adds a generator (off).
   Audition with `chord C3 G3 E4` and ask the performer to play; errors while it runs come back
   as `perturbed: ... stopped: ...` on your next command and in the app's status bar.
4. Revise the file, then `tools/perturbed adhoc load <name>`: running generators move to the new
   version with their settings; the replaced version is kept in `adhoc/old/` automatically.
5. A piece that uses it carries a copy in its performance file, so later edits never change it.
6. Delete a type only when the performer asks: `tools/perturbed adhoc delete <name>` (its file
   moves to `adhoc/old/`; refused while generators use it).

**Format:** [docs/writing-generator-types.md](docs/writing-generator-types.md) is the full guide
(anatomy, time, notes, reading the world, troubleshooting, recipes); the built-in types in
`brain/types/` are working examples. In short:

```supercollider
// rolling-strum — strums the current chord upward on each grid step, spread over `spread` beats.
// made 2026-10-01 for "Winter piece"
(
params: [
	[\num, 1, \range, 1, 32], [\den, 1, \range, 1, 32],
	[\spread, 0.25, \range, 0, 2, 0.05],
	[\velocity, 80, \range, 1, 127],
	~clockParam,
],
labels: (spread: "spread (beats)"),
restartOn: [\num, \den, \clock],
run: { |g, p|
	~grid.(p[\num] / p[\den], { |k|
		var notes = ~chord, d = ~dests[g[\dest]];
		notes.do { |note, i|
			var at = p[\spread] * i / (notes.size - 1).max(1);
			thisThread.clock.sched(at, {
				if(d.notNil and: { ~sounds.(g) }) {
					g[\held][note] !? { |h| ~noteOff.(h[0], h[1]) };
					~noteOn.(d, note, p[\velocity]);
					g[\held][note] = [d, note];
				};
				nil
			});
		};
	});
},
)
```

- **Header:** line 1 is `// <name> — <one sentence>`; that sentence is what the library shows, so
  say what it *does*. Line 2: when and for which piece.
- **params:** `[name, default, kind, ...]`, kind `range` (min max [step]), `note`, `choice`
  (options...), `text`, `clock` (`~clockParam`). Optional keys: `showWhen`, `labels`, `sections`,
  `restartOn`, `onChange` (`(x: { |g, p, old, new| ... })`, may call `~restart.(g)`), `sliders`,
  `actions` (card buttons), `globals`, `output: false`, `on: true` (switched on when added), `chord`
  (below).
- **run** `{ |g, p| }` is a routine on its clock while the transport plays (waits in beats); play
  on the grid with `~grid.(beats, { |k| ... })` so it lines up with every other generator;
  **key** `{ |g, p, note, vel, src| }` gets keyboard notes (vel 0 = up; src: the input's name) whether or not it plays.
- **Playing notes:** one at a time: `~strike.(g, note, vel)` (releases the previous, respects
  mutes) and `~release.(g)`. Several at once: `~noteOn.(dest, note, vel)` / `~noteOff.(dest, note)`
  with `dest = ~dests[g[\dest]]`, check `~sounds.(g)` first, and keep what you hold in
  `g[\held][key] = [dest, note]` so stopping or muting releases it.
- **Types that provide a chord (your own pitch containers):** give the type a `chord` function,
  `chord: { |g, p| pitches }` (MIDI numbers; called whenever a generator needs the chord), and it shows in
  every generator's *chord* menu like a chord strip; first in the rack it is the main chord. It needs no
  `run` or `key`, but can have them: a `run` that moves through a progression on `~grid`, a `key` that
  listens. When its chord changes by itself, call `~syncChord.()`. Use `output: false` and `on: true`.
  `~parseNotes.("A2 C3 E3")` and `~noteName.(57)` convert note names. The library has two to read and
  reuse: `progression` (a list of chords stepped through in time) and `tonnetz-drift` (a triad that
  wanders by P, L and R moves). Point generators at one with `set <gen> chord=<its id>`, or `move <its
  id> before=<the first strip>` to make it the main chord.
- **Types that move settings (your own LFOs):** `maps: true` gives the card a Map button and
  targets, like the built-in lfo; the type calls `~drive.(g, x)` with x in 0–1 (it does nothing
  while muted), from `~tick.({ |seconds, beats| ... })` (about 50 times a second) or from `~grid`.
- **Global parameters:** declare the ones the type reads (`globals: [\\density]`: created if
  missing when the type loads) and read them live with `~global.(\\density)` (0–1). This lets a
  type give a global a meaning no single setting has (denser = more notes in the strum *and* a
  wider spread).
- **Reading the world:** `~chordFor.(p)` (the chord its `chord` setting picks: add `~chordParam` to the
  params; `~pitchParams` includes it), or `~chord` (the main chord); MIDI, sorted; may be empty: rest), `~beats.()`
  (beats since the grid origin), `p[\name]` (its settings, read live), `~gens` (other generators,
  e.g. for a canon: `~gens[id][\sounding]` is `[dest, note]` or nil). Shared building blocks:
  `~pitchParams`/`~pitch.(p, step)`, `~rhythmParams`/`~rhythmGate.(p, k)`,
  `~velocityParams`/`~velocity.(g, p, k)` (see `brain/types/basic.scd`). CC: `~cc.(bus, ch, cc, v)`.
- **sclang traps:** no operator precedence (`a + b * c` is `(a + b) * c`: parenthesize); `var`
  only at the top of a function; menu (choice) values arrive as Symbols: compare with
  `p[\x].asString == "up"`; integers for grid indexes.

---

## Developing Perturbed

Read [PLAN.md](PLAN.md): what's next, the backlog, the system reference and the gotchas.

- Run `./tests/run.sh` after a change: it runs only the suites the changed files can break (seconds for
  the surface, the CLI or the protocol; the slow real-time suites only when a change can alter which
  notes play or when), and prints what it picked. Run `./tests/run.sh --all` (~65 s) before a push, not
  between small changes. It starts with a lint and
  format check of the JavaScript (Biome, `biome.jsonc`; `npm install` at the repo root once):
  `npm run format` fixes formatting. SuperCollider has no linter; the tests load every brain file. It uses its own brain on
  port 57140, so it doesn't touch a running performance.
- The brain is authoritative; the surface renders what it reports. New generator types need only
  a file in `brain/types/` (the surface builds cards from the schema); reuse the pitch, rhythm and
  velocity modules. Keep this file's param tables in sync when params change.
- Match the surrounding code's style and comment density. Commit messages explain why.
