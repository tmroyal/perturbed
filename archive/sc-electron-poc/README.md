This project combines these techs:
- Supercollider
- VSTi
- UIs

To create an engaging way to perform algorithmic music.

## POC

```
./run.sh
```

Requires SuperCollider 3.14 with the [VSTPlugin](https://git.iem.at/pd/vstplugin) extension
in `~/Library/Application Support/SuperCollider/Extensions/`.

- `engine/main.scd` — entry point; boots, loads the pieces below.
- `engine/core.scd` — instruments (hosted VSTis), voices (generator → instrument), OSC API, MIDI. The OSC API is documented at the top.
- `engine/setup.scd` — **the rig**: which plugins, which voices, MIDI mappings. Edit this first.
- `engine/generators/*.scd` — one file per generator; the filename is its name. See `walk.scd` for the interface.
- `app/` — Electron UI (Nord theme). Builds itself from the schema the engine sends, so new voices/params need no UI code.

### Extending

- **New generator:** copy `engine/generators/walk.scd`, change `params` and `step`, then `~addVoice.(\name, \yourGen, \instrument)` in `setup.scd`.
- **New instrument:** `~addInstrument.(\name, "/Library/Audio/Plug-Ins/VST3/Some.vst3")` in `setup.scd`.
- **New param:** add it to a generator's `params`; it appears in the UI and can be mapped to a CC.

### Timing

Generators run on `SystemClock` in sclang; note on/offs are sent as bundles timestamped `s.latency` (50 ms) ahead,
so the server schedules them by timestamp rather than when sclang happens to send them. Live MIDI input is passed through immediately.
