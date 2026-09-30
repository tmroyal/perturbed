# AGENTS.md

This repo is **Perturbed**, an algorithmic performance instrument (see [README.md](README.md)).
Agents work here in one of two roles. Check which one you are in before doing anything.

- **Performance assistant** — you were started from the terminal inside the Perturbed app
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
  README/PLAN/AGENTS. If what the performer wants needs a new kind of generator or a code change,
  say so and suggest they ask a developer (AdHoc generators, written by you, are planned: PLAN §2.1).
- **You may write** performance files in `performances/`.
- **The performer owns play/stop.** Don't start or stop the transport unless asked.
- **Don't lose work.** Before replacing the current performance, save it
  (e.g. `performances/before-<time>.json`) or confirm with the performer.
- Explain what you set up in musical terms (which generator plays what, against what) so the
  performer can adjust it by hand on the surface.

### How to set up a performance

Write a performance file to `performances/<name>.json` (format below), then ask the performer to
open it (**Open…** in the transport bar). Opening replaces the current performance and stops the
transport; generators keep their on/off state, so Play starts the piece.

A `tools/perturbed` command for changing the running performance directly is planned (PLAN §1.2);
until it exists, performance files are the way. `performances/example.json` is a complete,
working example.

### Performance file format

```json
{
  "tempo": 96,                        // main clock (A), bpm 20–400
  "chordMode": "auto",                // "auto" | "arm"
  "chord": [57, 60, 64, 67],          // starting chord, MIDI pitches (the performer's playing replaces it)
  "clocks": [                         // extra clocks B (id 1), C (id 2), ...
    {"id": 1, "mode": "factor", "factor": 1.01, "num": 1, "den": 1, "bpm": 96}
  ],
  "destinations": [                   // outputs: one Live MIDI track each
    {"id": 1, "name": "Piano 1", "port": 1, "channel": 1, "instrument": "Pianoteq 9"}
  ],
  "generators": [
    {"id": 1, "type": "basic", "dest": 1, "active": true, "params": {"source": "arpeggio"}}
  ]
}
```

(Comments are for this document only; JSON files can't contain them.) Params left out keep their
defaults. `dest` is an output id (0 = none); `active` true means on.

**Outputs.** `port` is an IAC bus (1 = Bus 1, 2 = Bus 2), `channel` 1–16. Each output is a Live
MIDI track the performer makes (MIDI From that bus and channel, Monitor In, an instrument
loaded); the Perturbed Bridge reports those tracks and the app offers them as outputs.
`instrument` is only a label. Reuse existing outputs where you can (the
defaults are *Piano 1* = port 1 ch 1 and *Piano 2* = port 1 ch 2, Pianoteq 9), and tell the
performer when a new one needs a Live track, with its bus, channel and the instrument you had in mind.

**Clocks.** `mode` is `ratio` (main × num/den), `factor` (main × factor; 1.01 phases slowly
against main) or `free` (its own `bpm`). Ratio and factor clocks follow main tempo changes.

### Generator types and params

**basic** — one note at a time on a grid of num/den beats, each note released by the next.

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
| `velMode` | set, accent, random, drift, ramp, pattern (set) | velocity mode |
| `velocity` | 1–127 (80) | `set`; also the unaccented value for `accent` |
| `accent`, `every` | 1–127 (110), 1–32 (4) | `accent`: accent on every n-th grid step |
| `low`, `high` | 1–127 (40, 100) | range for `random`, `drift`, `ramp` |
| `rate` | 0.05–8 (0.5) | `drift`: new targets per beat |
| `attack`, `decay` | 0–64 beats (4, 4) | `ramp`: rise and fall times |
| `pattern` | text ("110 60 80 60") | `pattern`: velocities per grid step, cycling |
| `humanize` | 0–32 (0) | random ± on top of any mode |
| `clock` | 0 = A (main), or a clock id (0) | which clock's beats it runs on |

**passthrough** — plays the keyboard into its output while on (transport running or not).

| param | values (default) | meaning |
|---|---|---|
| `octave`, `semitone` | −4–4, −12–12 (0, 0) | transpose |
| `lo`, `hi` | 0–127 (0, 127) | only keys in this range pass (a zone; the key as played) |
| `delay` | 0–16 beats of the main tempo, quarter steps (0) | delay notes (and note-offs) |

### Musical building blocks

- **Polyrhythm:** generators on one clock with different `num/den` (1/1 against 3/4 meet every 3 beats).
- **Phasing:** identical generators on A and on a `factor` clock of 1.005–1.02.
- **Polytempo:** a `ratio` clock (e.g. 3/2) keeps a fixed relation to main.
- **Harmony follows the player:** chord sources (`index`, `arpeggio`, `permute`, `lowest`/`highest`)
  re-voice whenever the performer plays a new chord; `note` stays fixed.
- **Splits and echoes:** passthroughs with different zones and outputs; a delayed, transposed
  passthrough makes a live canon.

---

## Developing Perturbed

Read [PLAN.md](PLAN.md): what's next, the backlog, the system reference and the gotchas.

- Run `./tests/run.sh` (~30 s) after changes; keep it green and short. It uses its own brain on
  port 57140, so it doesn't touch a running performance.
- The brain is authoritative; the surface renders what it reports. New generator types need only
  a file in `brain/types/` (the surface builds cards from the schema); reuse the pitch, rhythm and
  velocity modules. Keep this file's param tables in sync when params change.
- Match the surrounding code's style and comment density. Commit messages explain why.
