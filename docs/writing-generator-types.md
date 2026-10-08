# Writing your own generator types

A **generator type** is a small SuperCollider file that teaches Perturbed a new way to play: a
strum, an echo of another voice, a drone that breathes. You write the file, Perturbed loads it while
it runs, and it shows up in the app with its own card, controls and **+** button.

Claude can write these for you (they're called *AdHoc* types), but nothing about them is special to
Claude. This guide is for writing them by hand.

You need to know a little SuperCollider, but less than you might think: a type is one Event with a
list of settings and one function that plays.

---

## Contents

1. [Your first type](#1-your-first-type)
2. [Where files go, and how they load](#2-where-files-go-and-how-they-load)
3. [The anatomy of a type](#3-the-anatomy-of-a-type)
4. [Time: playing on the grid](#4-time-playing-on-the-grid)
5. [Playing notes](#5-playing-notes)
6. [Reading the world](#6-reading-the-world)
7. [Making the card nice](#7-making-the-card-nice)
8. [When something goes wrong](#8-when-something-goes-wrong)
9. [Recipes](#9-recipes)
10. [Cheat sheet](#10-cheat-sheet)

---

## 1. Your first type

Save this as `adhoc/pulse.scd`:

```supercollider
// pulse — plays one note on every grid step.
(
params: [
	[\note, 60, \note],                  // a note picker, starting at C4
	[\velocity, 90, \range, 1, 127],     // a slider from 1 to 127
	[\every, 1, \range, 0.25, 4, 0.25],  // grid step in beats
],
run: { |g, p|
	~grid.(p[\every], { |k|
		~strike.(g, p[\note], p[\velocity]);
	});
},
)
```

Then, in Perturbed, open **Library ▾**: *Pulse* is listed, with the sentence from its first line.
Press **+ Add**, pick an output on the new card, turn it **On** and press **Play**.

That's a complete generator. Line by line:

- **`// pulse — plays one note on every grid step.`** The first line is the type's name and a
  one-sentence description. The Library shows that sentence, so say what the type *does*.
- **`params`** is the list of settings. Each becomes a control on the card. `p[\note]` is the
  setting's current value, read live: move the slider and the next note changes.
- **`run`** is what plays while the transport runs. `g` is this generator, `p` its settings.
- **`~grid.(beats, fn)`** calls `fn` on every grid point, `beats` apart, in step with every other
  generator. `k` counts the grid points.
- **`~strike.(g, note, velocity)`** plays a note on the card's output and releases the previous one.

---

## 2. Where files go, and how they load

| | |
|---|---|
| **Your types** | `adhoc/<name>.scd` at the repo root, one per file. Lowercase, hyphens: `rolling-strum.scd`. The file name is the type's name. |
| **Built-in types** | `brain/types/` (`basic`, `passthrough`, `lfo`). Read them: they're the best examples. Don't edit them; copy one into `adhoc/` under a new name instead. |
| **Loading** | **Library ▾ → + Add** loads a type and adds a generator. Or from a terminal: `tools/perturbed adhoc load <name>`. |
| **Editing** | Save the file, then press **Reload** next to it in the Library (it appears when the file changed), or run `adhoc load` again. Running generators switch to the new version and keep their settings. |
| **Old versions** | Each reload keeps the replaced version in `adhoc/old/`. Deleting a type (× in the Library) moves it there too. |
| **Favorites** | ☆ in the Library puts a type on the add bar for good. |
| **Pieces** | A saved performance carries a copy of every type it uses, so editing a type later never changes a piece you've saved. |

The terminal tool is handy while you work:

```sh
tools/perturbed adhoc check pulse     # syntax errors, with the line and a caret
tools/perturbed adhoc load pulse      # load or reload
tools/perturbed add pulse output="Piano 1" note=E4 active=on
tools/perturbed chord C3 E3 G3        # give chord-reading types something to read
```

---

## 3. The anatomy of a type

A type file is one SuperCollider **Event** (the `( key: value, ... )` block). Two keys matter most:

### `params`: the settings

Each setting is `[name, default, kind, ...]`:

| kind | written as | the card shows | `p[\name]` is |
|---|---|---|---|
| number | `[\speed, 1, \range, 0, 8]` | a field (or slider, for wide ranges) | a number |
| number with a step | `[\spread, 0.25, \range, 0, 2, 0.05]` | the same, in steps of 0.05 | a number |
| note | `[\root, 60, \note]` | note name + octave, and a **Set** button that takes the next key you play | a MIDI number (60 = C4) |
| menu | `[\mode, "up", \choice, "up", "down", "random"]` | a menu | the chosen option, **as a Symbol** (compare with `p[\mode].asString == "up"`) |
| text | `[\pattern, "1 0 1 1", \text]` | a text field | a String |
| clock | `~clockParam` | a menu of clocks (A, B, …) | which clock `run` plays on |

Settings are read live: every time your code reads `p[\speed]` it gets the current value.

### `run` and `key`: what plays

| | called | use it for |
|---|---|---|
| `run: { \|g, p\| ... }` | once when the transport starts; it loops for as long as it plays | anything that plays in time |
| `key: { \|g, p, note, vel\| ... }` | for every key the performer plays (`vel` 0 = key up), whether or not the transport runs | anything that reacts to the keyboard |

A type needs at least one of them. It can have both.

### Optional keys

| key | example | what it does |
|---|---|---|
| `labels` | `(spread: "spread (beats)")` | the name shown on the card instead of the setting's name |
| `sections` | `(spread: "Strum")` | a titled divider on the card, above that setting |
| `showWhen` | `(steps: [\mode, "random"])` | show `steps` only when `mode` is `random` |
| `sliders` | `(speed: \log)` | force a slider (`\lin` or `\log`) for a number setting |
| `restartOn` | `[\every, \clock]` | restart `run` when these change (needed for anything `run` reads only once, like the grid step) |
| `onChange` | `(scale: { \|g, p, old, new\| ... })` | a function called when that setting changes (see §6) |
| `actions` | `(Reset: { \|g, p\| ... })` | buttons on the card that run a function |
| `globals` | `[\density]` | global parameters this type reads (created if missing; see §6) |
| `output: false` | | the type plays into no output (like `lfo`, which sends control changes) |
| `maps: true` | | the type drives other generators' settings (like `lfo`): its card gets a **Map** button and a list of targets, and `run` calls `~drive.(g, x)` with `x` from 0 to 1 to move them |

---

## 4. Time: playing on the grid

Everything in `run` is measured in **beats** of the generator's clock (A, the main clock, unless a
`~clockParam` setting says otherwise). `1.wait` waits one beat; `0.25.wait` a sixteenth.

**Use `~grid`** instead of bare waits. Generators start when the performer presses Play, wherever the
bar happens to be; `~grid` waits for the next grid point, so every generator lines up with every
other one, and with Live's bars:

```supercollider
run: { |g, p|
	~grid.(1/4, { |k|                    // every sixteenth; k = 0, 1, 2, ... counted from the bar
		if(k % 4 == 0) { ~strike.(g, 48, 110) } { ~strike.(g, 60, 70) };
	});
},
```

**A step that follows a setting:** give `~grid` a *function* instead of a number. It's read before
every grid point, so moving the setting changes the step at once; the grid jumps to the next point
of the new step, so it stays in line with everything else:

```supercollider
params: [[\num, 1, \range, 1, 32], [\den, 4, \range, 1, 32]],
run: { |g, p| ~grid.({ p[\num] / p[\den] }, { |k| ... }) },   // note the { }
```

With a plain number (`~grid.(p[\num] / p[\den], ...)`) the step is read once, when `run` starts;
then list the settings in `restartOn: [\num, \den]`, which restarts `run` (and anything it counts)
when they change.

**Something later than the grid point** (a strum, an echo): schedule it on the same clock, in beats
from now:

```supercollider
thisThread.clock.sched(0.5, { ~strike.(g, 67, 80); nil });   // half a beat later; return nil
```

`~beats.()` is the time in beats since the grid's start, if you need it.

---

## 5. Playing notes

### One note at a time: `~strike`

```supercollider
~strike.(g, note, velocity);   // releases the previous note, plays this one
~release.(g);                  // just release (a rest)
```

`~strikeFor.(g, note, velocity, beats)` is the same with a length: the note is released after
`beats` beats, unless another has been struck by then.

`~strike` does the bookkeeping for you: it plays on the card's output, flashes the card's light,
stays silent when the generator's group is muted, and releases its note when the generator stops.
Use it whenever you can.

### Several notes at once

For chords and overlapping notes, play them yourself and keep track of what you hold:

```supercollider
var d = ~dests[g[\dest]];                     // the card's output (nil if none)
if(d.notNil and: { ~sounds.(g) }) {           // ~sounds: not muted by its group
	g[\held][note] !? { |h| ~noteOff.(h[0], h[1]) };   // let go of this pitch if it's held
	~noteOn.(d, note, velocity);
	g[\held][note] = [d, note];               // remember it: released on stop, mute, removal
};
```

Anything in `g[\held]` is released for you when the generator stops, is muted or is removed. To end a
note yourself: `g[\held].removeAt(note) !? { |h| ~noteOff.(h[0], h[1]) }`.

From a `key` function, add `true` to play immediately instead of on the brain's schedule (the
keyboard doesn't wait): `~noteOn.(d, note, vel, true)`, `~noteOff.(d, note, true)`.

### Control changes

`~cc.(bus, channel, cc, value)` sends a MIDI CC on one of the control buses (bus 1 = *Perturbed CTL
1*), for Live's MIDI mapping. See `brain/types/lfo.scd`.

---

## 6. Reading the world

| | |
|---|---|
| `~chord` | the current chord: MIDI numbers, low to high. **It can be empty**: rest (`~release.(g)`) rather than fail. |
| `p[\name]` | this generator's settings, live |
| `~global.(\density)` | a global parameter's value, 0–1 (0 if there's none). List it in `globals: [\density]` and it's created when the type loads. |
| `~gens` | every generator, by id. `~gens[3][\sounding]` is `[output, note]` for what generator 3 is playing now, or nil. |
| `~beats.()` | beats since the grid's start |

**Global parameters** are where a type can be more than a list of settings. A setting is one
number; a global can *mean* something. Here, "density" adds notes and widens the spread at once:

```supercollider
globals: [\density],
run: { |g, p|
	~grid.(1, { |k|
		var n = 1 + (~global.(\density) * 5).round;   // 1 to 6 notes
		...
	});
},
```

### Reacting to a change: `onChange`

Sometimes a type should *do* something the moment a setting moves, not just read the new value on
its next step. Give it an `onChange` function per setting; it gets the generator, its settings, and
the old and new values:

```supercollider
onChange: (
	scale: { |g, p, old, new| g[\table] = ~buildTable.(new) },          // recompute something once
	mode:  { |g, p, old, new| if(new.asString == "random") { ~restart.(g) } },   // restart, sometimes
	level: { |g, p, old, new| ~cc.(1, 1, 20, new) },                     // send it right away
),
```

- It runs whenever the setting really changes, wherever the change came from: the card, a pin, a
  global, `perturbed`, Claude.
- `~restart.(g)` restarts `run` on the grid (it's what `restartOn` does, for every change).
- An error inside it is reported in the status bar; the setting still changes and the generator
  keeps playing.
- Keep it quick: a global sweeping across a mapped setting calls it many times a second.

### Moving other generators' settings: your own LFOs

The built-in `lfo` isn't special: any type can drive settings. Say so with `maps: true`, and its
card gets the **Map** button and the list of what it moves (each target with its own *from → to*,
set by the performer). Your job is one number: call `~drive.(g, x)` with `x` between 0 and 1, as
often as you like, and every target follows over its own range.

```supercollider
maps: true,
output: false,            // usually: it plays no notes, so it needs no output
run: { |g, p|
	~tick.({ |seconds, beats|      // about 50 times a second
		~drive.(g, 0.5 + (0.5 * sin(2pi * seconds * p[\hz])));
	});
},
```

- **`~tick.(fn)`** calls `fn` about 50 times a second with the seconds since it started and the
  beats since the bar: use it for anything that moves continuously. Use `~grid` instead when it
  should change on the beat (a new value every bar, a stepped sequence).
- **`~drive.(g, x)`** does nothing while the generator is off or muted by its group, and only
  sends real changes, so call it freely.
- Targets are locked on their cards and tagged with your generator's name. A setting follows one
  driver at a time.
- `x` is all you decide. The performer decides what it moves and how far.

### Reusing the built-in building blocks

The `basic` type is assembled from three modules you can use too. Each gives you a block of
settings to add to `params` and a function to call:

```supercollider
params: ~pitchParams ++ ~rhythmParams ++ ~velocityParams ++ [~clockParam],
showWhen: ~pitchShow ++ ~rhythmShow ++ ~velocityShow,
labels: ~pitchLabels ++ ~rhythmLabels ++ ~velocityLabels,
run: { |g, p|
	var step = 0;
	~grid.(p[\num] / p[\den], { |k|
		var note;
		if(~rhythmGate.(p, k)) {                      // does grid step k play? (every/euclid/random/phrase)
			note = ~pitch.(p, step);                  // which note (a fixed note, or from the chord; nil: rest)
			if(note.notNil) { ~strike.(g, note, ~velocity.(g, p, k)) } { ~release.(g) };   // how loud: accent, drift, ...
			step = step + 1;
		};
	});
},
```

See `brain/types/basic.scd` and `brain/core/pitch.scd`, `rhythm.scd`, `velocity.scd`.

---

## 7. Making the card nice

- **Labels and sections** make long cards readable: `labels: (spread: "spread (beats)")`,
  `sections: (velocity: "Dynamics")`.
- **`showWhen`** hides settings that don't apply: `showWhen: (steps: [\mode, "random"])`.
- **Steps on number settings** (`[\spread, 0.25, \range, 0, 2, 0.05]`) keep values tidy.
- **The header line** is your documentation: `// name — what it does, in one sentence.` A second line
  for when and why you wrote it is a kindness to yourself later.

---

## 8. When something goes wrong

| what you see | what happened | what to do |
|---|---|---|
| *"type x didn't load: it has a syntax error"* in the app's status bar | the file doesn't parse | `tools/perturbed adhoc check x` shows the line and where |
| *"type x didn't load: …"* with another reason | it parsed, but isn't a usable type (no `params`, no `run`/`key`, or an error while evaluating) | read the message; the previous version stays loaded |
| *"generator 3 (x) stopped: …"* | your `run` or `key` hit an error while playing | only that generator stops and switches off; fix, reload, turn it on again |
| it plays on the off-beat, or drifts | bare `wait`s from the moment Play was pressed | use `~grid` (§4) |
| changing a setting does nothing | `run` read it once (e.g. the grid step) | read it inside the loop, give `~grid` a function (§4), or add it to `restartOn` |
| silence | the card has no output, the generator is off, its group is muted, or the chord is empty | check the card; `tools/perturbed state` shows `sounding` |

### SuperCollider traps

- **No operator precedence.** `a + b * c` is `(a + b) * c`. Parenthesize everything.
- **`var` only at the top** of a function, before anything else.
- **No early `return`** from a function: use `if(...) { ... } { ... }`.
- **Menu values are Symbols.** `p[\mode] == "up"` is false; `p[\mode].asString == "up"` works.
- **`arg` is a reserved word.** Don't name a variable `arg`.
- **`sched` functions must return nil** (or a number of beats, to repeat).

---

## 9. Recipes

Each recipe is a complete file: save it in `adhoc/` under its name and load it.

### Rolling strum

Strums the current chord upward on every grid step.

```supercollider
// rolling-strum — strums the current chord upward on each grid step, spread over `spread` beats.
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

### Shadow

Follows another generator, a fixed interval away, a little later.

```supercollider
// shadow — repeats what another generator plays, transposed, `delay` beats later.
(
params: [
	[\source, 1, \range, 1, 99],
	[\interval, 7, \range, -24, 24],
	[\delay, 0.5, \range, 0, 4, 0.25],
	[\velocity, 70, \range, 1, 127],
],
labels: (source: "follows generator", interval: "interval (semitones)", delay: "delay (beats)"),
run: { |g, p|
	var last;
	~grid.(1/8, { |k|
		var playing = ~gens[p[\source].asInteger] !? { |s| s[\sounding] };
		var note = playing !? { |sn| sn[1] };
		if(note.notNil and: { note != last }) {
			thisThread.clock.sched(p[\delay], { ~strike.(g, (note + p[\interval]).clip(0, 127), p[\velocity]); nil });
		};
		last = note;
	});
},
)
```

### Breathing drone

Holds the lowest note of the chord; a global parameter shapes how it breathes.

```supercollider
// breathing-drone — holds the chord's lowest note, re-struck every `bars`, louder as `breath` rises.
(
params: [
	[\bars, 1, \range, 1, 8],
	[\octave, -1, \range, -3, 1],
],
globals: [\breath],
restartOn: [\bars],
run: { |g, p|
	~grid.(4 * p[\bars], { |k|
		var low = ~chord.first;
		if(low.isNil) { ~release.(g) } {
			~strike.(g, (low + (12 * p[\octave])).clip(0, 127), (30 + (~global.(\breath) * 90)).round.asInteger);
		};
	});
},
)
```

### Wander (an LFO of your own)

A random walk for settings: drifts instead of cycling. Map it like an LFO.

```supercollider
// wander — moves the settings mapped to it in a slow random walk, `speed` setting how restless.
(
params: [
	[\speed, 2, \range, 0.1, 20, 0.1],
	[\center, 0.5, \range, 0, 1, 0.01],     // where it tends to return to
	[\pull, 0.2, \range, 0, 1, 0.01],       // how strongly
],
labels: (pull: "pull to center"),
sliders: (speed: \log, center: \lin, pull: \lin),
output: false,
maps: true,
run: { |g, p|
	var x = p[\center];
	~tick.({ |seconds, beats|
		x = x + (p[\speed] * 0.02).rand2 + ((p[\center] - x) * p[\pull] * 0.02);
		x = x.fold(0, 1);
		~drive.(g, x);
	});
},
)
```

### Stepper (changes on the beat)

A new random value on every grid step: sample and hold, in time.

```supercollider
// stepper — gives the settings mapped to it a new random value on every grid step.
(
params: [
	[\num, 1, \range, 1, 32], [\den, 1, \range, 1, 32],
	[\levels, 0, \range, 0, 16],            // 0: any value; n: one of n evenly spaced levels
	~clockParam,
],
restartOn: [\clock],
output: false,
maps: true,
run: { |g, p|
	~grid.({ p[\num] / p[\den] }, { |k|
		var x = 1.0.rand, n = p[\levels].asInteger;
		if(n > 1) { x = (x * n).floor / (n - 1) };
		~drive.(g, x);
	});
},
)
```

### Keyboard harmonizer

Adds the next chord tone above every key you play (keyboard-driven, no transport needed).

```supercollider
// harmonizer — adds the nearest tone of the current chord above each key played.
(
params: [[\velocity, 70, \range, 1, 127]],
key: { |g, p, note, vel|
	var d = ~dests[g[\dest]];
	if(vel > 0) {
		var above = ~chord.collect { |c| c + (12 * ((note - c) div: 12 + 1)) }.select(_ > note).minItem;
		if(above.notNil and: { d.notNil } and: { ~sounds.(g) }) {
			~noteOn.(d, above, p[\velocity], true);
			g[\held][note] = [d, above];
		};
	} {
		g[\held].removeAt(note) !? { |h| ~noteOff.(h[0], h[1], true) };
	};
},
)
```

---

## 10. Cheat sheet

| | |
|---|---|
| **file** | `adhoc/<name>.scd`, first line `// <name> — <one sentence>.` |
| **settings** | `[\name, default, \range, min, max, (step)]`, `[\name, 60, \note]`, `[\name, "a", \choice, "a", "b"]`, `[\name, "", \text]`, `~clockParam` |
| **play in time** | `run: { \|g, p\| ~grid.(beats, { \|k\| ... }) }`; `~grid.({ p[\x] }, ...)` follows a setting live |
| **react to keys** | `key: { \|g, p, note, vel\| ... }` (vel 0 = up) |
| **one note** | `~strike.(g, note, vel)`, `~strikeFor.(g, note, vel, beats)`, `~release.(g)` |
| **many notes** | `d = ~dests[g[\dest]]`; check `~sounds.(g)`; `~noteOn.(d, n, v)`; keep `g[\held][key] = [d, n]` |
| **later** | `thisThread.clock.sched(beats, { ...; nil })` |
| **read** | `p[\x]`, `~chord`, `~global.(\x)`, `~gens[id][\sounding]`, `~beats.()` |
| **CC** | `~cc.(bus, channel, cc, value)` |
| **move settings** | `maps: true`, then `~drive.(g, x)` with x in 0–1; `~tick.(fn)` for ~50 calls a second |
| **react** | `onChange: (x: { \|g, p, old, new\| ... })`, `~restart.(g)` |
| **card** | `labels`, `sections`, `showWhen`, `sliders`, `actions`, `restartOn`, `globals`, `output: false` |
| **tools** | `tools/perturbed adhoc check \| load \| show \| list`, `add <name> ...`, `state` |
