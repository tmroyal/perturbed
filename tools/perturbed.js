// perturbed — set up the running performance from the shell (PLAN §5.7). Talks to the brain like the
// app does, so every change shows on the surface at once. Built for Claude in the drawer, usable by
// anyone. PERFORMED_PORT picks the brain (default 57120).
const { Brain, PerturbedError } = require('./lib/brain');

const HELP = `perturbed — change the running performance

  state                              everything, as JSON (generators, outputs, clocks, chord, Live tracks)
  schema [type]                      generator types and their settings (ranges, options), as JSON

  add <type> [setting=value ...]     add a generator (basic, passthrough, lfo); prints it
  set <id> setting=value ...         change settings; also active=on|off, output=<name|id|none>
  on <id> | off <id>                 switch a generator
  duplicate <id>                     a copy of a generator (settings, output, group), off
  remove <id>
  do <id> <action>                   press a card button (lfo: Send)
  map <lfo id> <gen id> <setting> [from to]   the lfo moves that setting over from..to (and locks it);
                                     another lfo's hz, low or high works too
  unmap <lfo id> <gen id> <setting>

  group add [name] [on= solo= collapsed=]   a group: switch, solo and fold several generators
  group set <name|id> on=on|off solo=on|off collapsed=on|off name=...
  group remove <name|id>             (its generators stay, ungrouped)
  group pin <name|id> <gen id> <setting>     show a member's setting on the group's header
  group unpin <name|id> <gen id> <setting>
  set <id> group=<name|id|none>      put a generator in a group (also: add basic group=...)

  global add [name] [value=]          a global parameter (Meta 1, ...): one control, 0–1, for many settings
  global set <name|id> value=0.7 name=...
  global remove <name|id>
  global map <global> <gen id> <setting> [from to [curve [amount]]]
                                     the setting follows the global (and is locked): from..to in its units
                                     (from > to inverts); curve linear|exp|steps|threshold
  global unmap <global> <gen id> <setting>
  global knob <global> <channel> <cc> | none   a knob or fader on the controller drives it (or learn
                                     it in the app: Knob, then turn it)

  adhoc list                         the type library: built-in and AdHoc types, stars, descriptions
  adhoc show <name>                  a type's source
  adhoc load <name>                  load or reload a type (after writing or editing adhoc/<name>.scd)
  adhoc check <name|file>            sclang's syntax error for a type file, if any
  adhoc delete <name>                remove an AdHoc type from the library (its file moves to adhoc/old/)
  favorite <name> | unfavorite <name>   star a type: favorites are the add bar

  output add <name> <port> <channel> [instrument]
  output remove <name|id>
  output live [<track name>|all]     make Live's tracks (from the bridge) outputs

  clock add [mode=ratio|factor|free num= den= factor= bpm=]
  clock set <B|id> setting=value ...
  clock remove <B|id>

  tempo <bpm>                        main clock (A)
  scale <num> <den>                  metric modulation: tempo × num/den
  chord <note ...>                   set the chord (MIDI numbers or names: C4 E4 G4)
  chord clear | chord mode auto|arm
  cc <bus> <channel> <cc> <value>    one MIDI CC on a control bus (1 = Perturbed CTL 1)
  inputs | inputs rescan             the keyboards and controllers the brain listens to
  inputs on|off <name>               listen to one, or ignore it (remembered)
  play | stop                        (the performer owns these: only when asked)
  save [file] | load <file>          performance files (save alone: to its own file; load replaces everything)
  new                                a new, empty performance (everything goes: save first)

Notes are MIDI numbers or names (C4 = 60). Values with spaces need quotes: set 2 phrase="1 2 1".`;

// "a=1" "b=two words" -> { a: '1', b: 'two words' }; also accepts "a 1 b 2"
function settings(args) {
  if (args.every((a) => a.includes('=')))
    return Object.fromEntries(args.map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
  if (args.length % 2) throw new PerturbedError(`settings come as name=value (got: ${args.join(' ')})`);
  const o = {};
  for (let i = 0; i < args.length; i += 2) o[args[i]] = args[i + 1];
  return o;
}

const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

// "<command>" or "<command> <sub>": [least args, usage, (brain, args) => what to print]
const COMMANDS = {
  state: [0, '', (b) => b.state()],
  schema: [0, '[type]', (b, [type]) => b.schema(type)],
  add: [1, '<type> [setting=value ...]', (b, [type, ...s]) => b.addGen(type, settings(s))],
  set: [2, '<id> setting=value ...', (b, [id, ...s]) => b.setGen(id, settings(s))],
  on: [1, '<id>', (b, [id]) => b.setGen(id, { active: 'on' })],
  off: [1, '<id>', (b, [id]) => b.setGen(id, { active: 'off' })],
  remove: [
    1,
    '<id>',
    async (b, [id]) => {
      await b.removeGen(id);
      return `removed generator ${id}`;
    },
  ],
  do: [
    2,
    '<id> <action>',
    async (b, [id, a]) => {
      await b.action(id, a);
      return `${a} on generator ${id}`;
    },
  ],

  duplicate: [1, '<id>', (b, [id]) => b.duplicateGen(id)],
  map: [3, '<lfo id> <gen id> <setting> [from to [curve [amount]]]', (b, [d, id, st, ...r]) => b.mapFrom(d, id, st, ...r)],
  unmap: [3, '<lfo id> <gen id> <setting>', (b, [d, id, st]) => b.unmapFrom(d, id, st)],

  'group add': [
    0,
    '[name] [setting=value ...]',
    (b, r) => {
      const named = r[0] && !r[0].includes('=');
      return b.addGroup(named ? r[0] : undefined, settings(named ? r.slice(1) : r));
    },
  ],
  'group set': [2, '<name|id> setting=value ...', (b, [g, ...s]) => b.setGroup(g, settings(s))],
  'group remove': [
    1,
    '<name|id>',
    async (b, [g]) => {
      await b.removeGroup(g);
      return `removed group ${g}`;
    },
  ],
  'group pin': [3, '<name|id> <gen id> <setting>', (b, [g, id, s]) => b.pin(g, id, s, true)],
  'group unpin': [3, '<name|id> <gen id> <setting>', (b, [g, id, s]) => b.pin(g, id, s, false)],

  'global add': [
    0,
    '[name] [value=0..1]',
    (b, r) => {
      const named = r[0] && !r[0].includes('=');
      return b.addGlobal(named ? r[0] : undefined, settings(named ? r.slice(1) : r));
    },
  ],
  'global set': [2, '<name|id> value=0..1 name=...', (b, [g, ...s]) => b.setGlobal(g, settings(s))],
  'global remove': [
    1,
    '<name|id>',
    async (b, [g]) => {
      await b.removeGlobal(g);
      return `removed global ${g}`;
    },
  ],
  'global map': [3, '<global> <gen id> <setting> [from to [curve [amount]]]', (b, [g, id, s, ...r]) => b.map(g, id, s, ...r)],
  'global knob': [2, '<global> <channel> <cc> | none', (b, [g, ch, cc]) => b.knob(g, ch, cc)],
  'global unmap': [3, '<global> <gen id> <setting>', (b, [g, id, s]) => b.unmap(g, id, s)],

  'adhoc list': [0, '', (b) => b.library()],
  'adhoc show': [1, '<name>', (b, [name]) => b.source(name)],
  'adhoc load': [
    1,
    '<name>',
    async (b, [name]) => {
      await b.loadType(name);
      return `loaded ${name}`;
    },
  ],
  'adhoc check': [
    1,
    '<name|file>',
    (b, [name]) => {
      const e = b.check(name);
      if (e) throw new PerturbedError(e);
      return `${name} parses`;
    },
  ],
  'adhoc delete': [
    1,
    '<name>',
    async (b, [name]) => {
      await b.deleteType(name);
      return `deleted ${name} (kept in adhoc/old/)`;
    },
  ],
  favorite: [1, '<name>', (b, [name]) => b.favorite(name, true)],
  unfavorite: [1, '<name>', (b, [name]) => b.favorite(name, false)],

  'output add': [3, '<name> <port> <channel> [instrument]', (b, r) => b.addOutput(...r)],
  'output remove': [
    1,
    '<name|id>',
    async (b, [o]) => {
      await b.removeOutput(o);
      return `removed output ${o}`;
    },
  ],
  'output live': [0, '[<track name>|all]', (b, [which]) => b.outputsFromLive(which ?? 'all')],

  'clock add': [0, '[setting=value ...]', (b, s) => b.addClock(settings(s))],
  'clock set': [2, '<B|id> setting=value ...', (b, [c, ...s]) => b.setClock(c, settings(s))],
  'clock remove': [
    1,
    '<B|id>',
    async (b, [c]) => {
      await b.removeClock(c);
      return `removed clock ${c}`;
    },
  ],

  tempo: [1, '<bpm>', async (b, [bpm]) => `tempo ${await b.tempo(bpm)}`],
  scale: [2, '<num> <den>', async (b, [num, den]) => `tempo ${await b.scale(num, den)}`],
  chord: [1, '<note ...>', (b, notes) => b.chord(notes)],
  'chord clear': [
    0,
    '',
    async (b) => {
      await b.chordClear();
      return 'chord cleared';
    },
  ],
  'chord mode': [
    1,
    'auto|arm',
    async (b, [mode]) => {
      await b.chordMode(mode);
      return `chord mode ${mode}`;
    },
  ],
  inputs: [0, '', (b) => b.inputs()],
  'inputs rescan': [0, '', (b) => b.rescanInputs()],
  'inputs on': [1, '<name>', (b, [name]) => b.setInput(name, true)],
  'inputs off': [1, '<name>', (b, [name]) => b.setInput(name, false)],
  cc: [
    4,
    '<bus> <channel> <cc> <value>',
    (b, a) => {
      b.cc(...a);
      return `cc ${a[2]} = ${a[3]} on bus ${a[0]} ch ${a[1]}`;
    },
  ],
  play: [
    0,
    '',
    async (b) => {
      await b.play(true);
      return 'playing';
    },
  ],
  stop: [
    0,
    '',
    async (b) => {
      await b.play(false);
      return 'stopped';
    },
  ],
  new: [
    0,
    '',
    async (b) => {
      await b.newPerformance();
      return 'new, empty performance';
    },
  ],
  save: [0, '[file]', async (b, [file]) => `saved ${await b.save(file)}`],
  load: [1, '<file>', async (b, [file]) => `loaded ${await b.load(file)}`],
};

const known = (name) => Object.hasOwn(COMMANDS, name);

async function run(b, [cmd, ...a]) {
  const name = known(`${cmd} ${a[0]}`) ? `${cmd} ${a.shift()}` : cmd;
  if (!known(name)) {
    const subs = Object.keys(COMMANDS)
      .filter((k) => k.startsWith(`${cmd} `))
      .map((k) => k.split(' ')[1]);
    throw new PerturbedError(subs.length ? `usage: perturbed ${cmd} ${subs.join('|')} ...` : `unknown command "${cmd}"\n\n${HELP}`);
  }
  const [least, usage, fn] = COMMANDS[name];
  if (a.length < least) throw new PerturbedError(`usage: perturbed ${name} ${usage}`);
  print(await fn(b, a));
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length || ['help', '-h', '--help'].includes(args[0])) {
    console.log(HELP);
    return;
  }
  let b;
  try {
    b = await Brain.connect();
    await run(b, args);
  } catch (e) {
    console.error(e instanceof PerturbedError ? `perturbed: ${e.message}` : e.stack);
    process.exitCode = 1;
  } finally {
    await b?.close();
  }
})();
