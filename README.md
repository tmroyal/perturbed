# performed

An algorithmic performance toolbox: generators on a shared clock read the chord you play and
send MIDI to instruments in REAPER, played from an Electron surface. Design and protocol: [PLAN.md](PLAN.md).

```
brain/     SuperCollider: clock, current chord, generators, MIDI out, OSC (the authority)
surface/   Electron UI; renders what the brain reports, sends intents over OSC
reaper/    setup.lua builds monitor-only tracks from destinations.json (written by the brain)
tests/     run.sh: timing, basic generator and OSC protocol tests against a test brain
archive/   the first proof of concept
```

## Run

```
./run.sh            # brain + surface; quitting the surface stops the brain
./tests/run.sh      # ~25 s; plays MIDI on IAC Bus 1 ch 1–2 (REAPER will sound it)
```

One-time setup: IAC Driver buses 1 and 2 enabled (Audio MIDI Setup), and enabled as inputs in
REAPER (Preferences → Audio → MIDI Inputs). In REAPER, run `reaper/setup.lua` from the Actions list
whenever destinations change. The brain listens to every MIDI input except the IAC Driver; plug the
keyboard in before starting it. Rig settings live in `brain/config.scd`.

## Adding a generator type

Copy `brain/types/basic.scd`: a type is `params` (the surface builds its controls from them) and a
`run` routine. Reuse `~pitchParams`/`~pitch` and `~velocityParams`/`~velocity` for note and velocity.
