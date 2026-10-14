// cli.js — drives a running test brain through tools/perturbed and checks the results:
// adding and setting generators by name, validation errors, outputs, clocks, chord, save/load.
// Run via tests/run.sh (PERFORMED_PORT points the CLI at the test brain).
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const CLI = path.join(__dirname, '..', 'tools', 'perturbed');
const run = (...args) => {
  try {
    return { ok: true, out: execFileSync(CLI, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: String(e.stderr) };
  }
};
const json = (...args) => JSON.parse(run(...args).out);

let failed = false;
const check = (ok, what) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
};

try {
  const schema = json('schema');
  check(
    schema.basic && schema.lfo && schema.lfo.output === false && schema.lfo.actions.includes('Send'),
    'schema: types, lfo has no output and a Send action',
  );

  const out = json('output', 'add', 'cli', '1', '4', 'none');
  check(out.name === 'cli' && out.channel === 4, `output add (${out.id})`);

  const g = json('add', 'basic', 'source=arpeggio', 'note=E4', 'output=cli', 'num=1', 'den=2');
  check(
    g.params.source === 'arpeggio' && g.params.note === 64 && g.output?.name === 'cli' && g.params.den === 2 && !g.active,
    `add basic with settings by name (gen ${g.id})`,
  );

  let r = run('set', String(g.id), 'source=nope');
  check(!r.ok && /one of note, index/.test(r.out), 'bad choice is refused with the options');
  r = run('set', String(g.id), 'velocity=200');
  check(!r.ok && /1 to 127/.test(r.out), 'out-of-range value is refused with the range');
  r = run('set', String(g.id), 'wobble=1');
  check(!r.ok && /no setting "wobble"/.test(r.out), 'unknown setting is refused with the list');

  check(json('on', String(g.id)).active === true && json('off', String(g.id)).active === false, 'on / off');
  const twin = json('duplicate', String(g.id));
  check(
    twin.id !== g.id &&
      twin.params.source === 'arpeggio' &&
      twin.params.note === 64 &&
      twin.output?.name === 'cli' &&
      twin.active === false,
    'duplicate: a copy with the same settings and output, off',
  );
  run('remove', String(twin.id));
  check(json('set', String(g.id), 'collapsed=on').collapsed === true, 'a generator folds (collapsed)');

  const grp = json('group', 'add', 'Layer A');
  const inG = json('set', String(g.id), 'group=Layer A', 'active=on');
  check(inG.group?.name === 'Layer A' && inG.sounding, 'group add; generator into it by name, sounding');
  const pinned = json('group', 'pin', 'Layer A', String(g.id), 'velocity');
  check(
    pinned.pins.some((p) => p.generator === g.id && p.setting === 'velocity'),
    'group pin',
  );
  const badPin = run('group', 'pin', 'Layer A', String(g.id), 'phrase');
  check(!badPin.ok && /no pinnable setting/.test(badPin.out), "text settings can't be pinned");
  check(json('group', 'unpin', 'Layer A', String(g.id), 'velocity').pins.length === 0, 'group unpin');
  json('group', 'set', 'Layer A', 'on=off', 'collapsed=on');
  const muted = json('state');
  check(
    muted.groups.some((x) => x.name === 'Layer A' && !x.on && x.collapsed) &&
      muted.generators.find((x) => x.id === g.id).sounding === false,
    'group off: generator still on, not sounding',
  );
  run('group', 'remove', 'Layer A');
  run('off', String(g.id));
  check(json('state').generators.find((x) => x.id === g.id).group === null && grp.id > 0, 'group remove: generator ungrouped');

  // global parameters: inverted, curves, menus, locking, cleanup
  const meta = json('global', 'add');
  check(meta.name === 'Meta 1' && meta.value === 0, 'global add: Meta 1 at 0');
  const param = (v, name) => {
    json('global', 'set', 'Meta 1', `value=${v}`);
    return json('state').generators.find((x) => x.id === g.id).params[name];
  };
  json('global', 'map', 'Meta 1', String(g.id), 'velocity', '50', '30');
  check(param(0, 'velocity') === 50 && param(1, 'velocity') === 30 && param(0.5, 'velocity') === 40, 'inverted mapping 0..1 -> 50..30');
  json('global', 'map', 'Meta 1', String(g.id), 'velocity', '20', '120', 'exp');
  check(param(0.5, 'velocity') < 70 && param(1, 'velocity') === 120, 'exp curve: below the midpoint at 0.5');
  json('global', 'map', 'Meta 1', String(g.id), 'accent', '60', '120');
  const order = json('global', 'map', 'Meta 1', String(g.id), 'velocity', '20', '120', 'exp').mappings.map((m) => m.setting);
  check(order.join() === 'velocity,accent', `editing a mapping keeps its place in the list (${order.join(', ')})`);
  json('global', 'unmap', 'Meta 1', String(g.id), 'accent');
  json('global', 'map', 'Meta 1', String(g.id), 'prob', '0', '100', 'threshold', '0.7');
  check(param(0.6, 'prob') === 0 && param(0.7, 'prob') === 100, 'threshold jumps at its point');
  json('global', 'map', 'Meta 1', String(g.id), 'rhythm', 'every', 'phrase');
  check(param(0.34, 'rhythm') === 'euclid', 'menus map over their options');
  const byDefault = json('global', 'map', 'Meta 1', String(g.id), 'humanize').mappings.find((m) => m.setting === 'humanize');
  check(
    byDefault?.curve === 'linear' && byDefault.from === 0 && byDefault.to === 32,
    'a mapping made with no range: current value -> max, linear',
  );
  const locked = run('set', String(g.id), 'velocity=99');
  check(!locked.ok && /follows Meta 1/.test(locked.out), 'a mapped setting is locked');
  check(json('state').generators.find((x) => x.id === g.id).follows?.velocity === 'Meta 1', 'state shows what follows a global');
  check(!run('global', 'map', 'Meta 1', String(g.id), 'num').ok, "settings that restart the generator can't be mapped");
  json('global', 'unmap', 'Meta 1', String(g.id), 'velocity');
  check(run('set', String(g.id), 'velocity=99').ok, 'unmapped: settable again');
  check(json('global', 'knob', 'Meta 1', '1', '74').knob?.cc === 74, 'global knob');
  const shaped = json('global', 'set', 'Meta 1', 'response=formula', 'formula=x * x');
  check(shaped.response === 'formula' && shaped.formula === 'x * x', 'global response: a formula for its knob');
  check(!run('global', 'set', 'Meta 1', 'response=wobbly').ok, 'an unknown response is refused');
  json('global', 'set', 'Meta 1', 'response=linear');

  // an lfo drives settings: its own range per target, locked, taken over from a global, moving while it plays
  const lfo = json('add', 'lfo', 'shape=square', 'num=1', 'den=4', 'sendCC=off', 'active=on');
  const driven = json('map', String(lfo.id), String(g.id), 'humanize', '2', '30');
  check(
    driven.targets.some((t) => t.generator === g.id && t.setting === 'humanize' && t.from === 2 && t.to === 30),
    'lfo map: a target with its range',
  );
  check(
    !json('state')
      .globals.find((x) => x.name === 'Meta 1')
      .mappings.some((m) => m.setting === 'humanize'),
    'a setting has one driver: the global let go',
  );
  const lfoLock = run('set', String(g.id), 'humanize=5');
  check(!lfoLock.ok && /follows Lfo \d+/.test(lfoLock.out), 'a setting driven by an lfo is locked');
  run('play');
  const seen = new Set();
  for (let i = 0; i < 10; i++) seen.add(json('state').generators.find((x) => x.id === g.id).params.humanize);
  run('stop');
  check(seen.has(2) && seen.has(30) && seen.size === 2, `the lfo moves the setting between its ends (${[...seen].join(', ')})`);
  // scale and add: how much of the wave gets through (2..30 → 2..16 at half scale, 16..30 with add 0.5)
  const ends = (settings) => {
    run('set', String(lfo.id), ...settings);
    run('play');
    const got = new Set();
    for (let i = 0; i < 10; i++) got.add(json('state').generators.find((x) => x.id === g.id).params.humanize);
    run('stop');
    return [...got].sort((x, y) => x - y).join(',');
  };
  check(ends(['scale=0.5']) === '2,16', 'lfo scale 0.5: half the range');
  check(ends(['scale=0.5', 'add=0.5']) === '16,30', 'lfo add 0.5: shifted up');
  run('set', String(lfo.id), 'scale=1', 'add=0');
  json('global', 'map', 'Meta 1', String(lfo.id), 'scale', '0', '1');
  check(json('state').generators.find((x) => x.id === lfo.id).follows?.scale === 'Meta 1', "a global can drive an lfo's scale");
  json('global', 'unmap', 'Meta 1', String(lfo.id), 'scale');
  run('set', String(lfo.id), 'scale=1');
  check(!run('map', String(lfo.id), String(lfo.id), 'hz').ok, "an lfo can't drive its own settings");
  check(!run('map', String(g.id), String(lfo.id), 'hz').ok, 'only generators that map (lfo) can drive settings');
  // free mode integrates its phase: halving Hz mid-cycle slows it down from where it is, no jump
  const ramp = json('add', 'lfo', 'shape=saw up', 'rate=free', 'hz=0.5', 'sendCC=off', 'active=on');
  json('map', String(ramp.id), String(g.id), 'accent', '1', '101');
  const probNow = () => json('state').generators.find((x) => x.id === g.id).params.accent;
  run('play');
  execFileSync('sleep', ['0.9']);
  const before = probNow();
  run('set', String(ramp.id), 'hz=0.25');
  const after = probNow();
  run('stop');
  check(before > 30 && Math.abs(after - before) < 20, `changing Hz doesn't reset a free lfo's position (${before} then ${after})`);
  run('remove', String(ramp.id));

  const lfo2 = json('add', 'lfo', 'sendCC=off');
  check(
    json('map', String(lfo2.id), String(lfo.id), 'phase', '0', '1').targets.some((t) => t.generator === lfo.id && t.setting === 'phase'),
    "lfo to lfo: one lfo drives another's phase",
  );

  const c = json('clock', 'add', 'mode=factor', 'factor=1.01');
  check(c.mode === 'factor' && Math.abs(c.factor - 1.01) < 1e-3, `clock add (${c.name})`);
  check(json('set', String(g.id), `clock=${c.name}`).params.clock === c.id, 'generator onto the clock by name');

  check(json('chord', 'C4', 'E4', 'G4').pitches.join() === '60,64,67', 'chord by note names');

  // MIDI inputs (the test brain's keyboard is IAC Bus 2)
  const bus2 = json('inputs').find((i) => /Bus 2/.test(i.name));
  check(bus2?.on === true, 'inputs: listed, on');
  check(json('inputs', 'off', bus2.name).find((i) => i.name === bus2.name).on === false, 'inputs off');
  check(json('inputs', 'on', bus2.name).find((i) => i.name === bus2.name).on === true, 'inputs on');
  check(
    json('inputs', 'rescan').some((i) => i.name === bus2.name),
    'inputs rescan keeps the list',
  );
  check(!run('inputs', 'off', 'no such keyboard').ok, 'an unknown input is refused');
  check(
    json('inputs', 'role', bus2.name, 'control').find((i) => i.name === bus2.name).role === 'control',
    'inputs role: a control surface',
  );
  json('inputs', 'role', bus2.name, 'all');
  check(
    json('key', 'gen', String(g.id), 'C2').key === 36 && json('key', 'gen', String(g.id), 'none').key === undefined,
    'key: set and forget a switch key',
  );

  // the type library (the test brain's is a temp copy of tests/adhoc/)
  const lib = json('adhoc', 'list');
  check(lib.some((t) => t.name === 'basic' && t.builtin && t.favorite) && lib.some((t) => t.name === 'broken' && !t.loaded), 'adhoc list');
  const bad = run('adhoc', 'check', 'broken');
  check(!bad.ok && /syntax error/.test(bad.out) && /line \d+/.test(bad.out), "adhoc check shows sclang's syntax error with the line");
  check(run('adhoc', 'check', 'crashy').ok, 'adhoc check passes a file that parses');
  // (crashy, left off: adhoc.js, which runs next, expects echo-up unloaded)
  const viaAdd = json('add', 'crashy', 'note=D4');
  check(viaAdd.type === 'crashy' && viaAdd.params.note === 62, 'add loads a library type first');
  run('remove', String(viaAdd.id));

  const file = path.join(os.tmpdir(), `perturbed-cli-${process.pid}.json`);
  check(run('save', file).ok && fs.existsSync(file), 'save writes the file');
  run('remove', String(g.id));
  check(!json('state').generators.some((x) => x.id === g.id), 'remove');
  check(!json('state').globals.find((x) => x.name === 'Meta 1').mappings.length, 'removing a generator drops its mappings');
  check(
    run('load', file).ok && json('state').generators.some((x) => x.id === g.id && x.params.source === 'arpeggio'),
    'load brings it back',
  );
  check(json('state').generators.find((x) => x.id === g.id).collapsed === true, 'load keeps a folded generator folded');
  check(
    json('state')
      .generators.find((x) => x.id === lfo.id)
      ?.targets.some((t) => t.generator === g.id && t.setting === 'humanize' && t.to === 30),
    "load keeps an lfo's targets",
  );
  const back = json('state').globals.find((x) => x.name === 'Meta 1');
  check(
    back?.mappings.some((m) => m.setting === 'prob' && m.curve === 'threshold' && Math.abs(m.amount - 0.7) < 1e-6) && back?.knob?.cc === 74,
    'load keeps globals, their mappings and knobs',
  );
  fs.unlinkSync(file);

  r = run('load', '/nonexistent/perturbed.json');
  check(!r.ok && /load failed/.test(r.out), 'a failed load reports the error');

  run('remove', String(g.id));
  run('output', 'remove', 'cli');
  run('clock', 'remove', c.name);
  run('chord', 'clear');
  run('global', 'remove', 'Meta 1');
  const s = json('state');
  check(
    !s.generators.some((x) => x.id === g.id) && !s.outputs.some((o) => o.name === 'cli') && !s.clocks.some((x) => x.id === c.id),
    'cleaned up',
  );

  // new: everything goes (the test brain's leftovers from earlier tests too), the tempo stays
  run('output', 'add', 'gone', '1', '5');
  run('add', 'basic');
  run('group', 'add', 'gone');
  run('global', 'add');
  run('chord', 'C4', 'E4');
  const tempo = json('state').tempo;
  check(run('new').ok, 'new');
  const fresh = json('state');
  check(
    fresh.generators.length === 1 &&
      fresh.generators[0].type === 'chord' &&
      !fresh.outputs.length &&
      !fresh.groups.length &&
      !fresh.globals.length &&
      fresh.clocks.length === 1 &&
      !fresh.chord.pitches.length &&
      fresh.tempo === tempo,
    'new: one empty chord strip; no outputs, other generators, groups, globals or extra clocks; tempo kept',
  );
  // the order of the cards: move before another, to the end, into a group; saved
  const [m1, m2, m3] = ['basic', 'lfo', 'passthrough'].map((t) => json('add', t).id);
  const chordStrip = fresh.generators[0].id;
  check(json('move', String(m3), `before=${m1}`).join() === [chordStrip, m3, m1, m2].join(), 'move a generator before another');
  check(json('move', String(m3)).join() === [chordStrip, m1, m2, m3].join(), 'move it to the end');
  run('group', 'add', 'Shelf');
  json('move', String(m2), 'group=Shelf');
  check(json('state').generators.find((x) => x.id === m2).group?.name === 'Shelf', 'move into a group');
  const copyId = json('duplicate', String(m1)).id;
  check(
    json('state')
      .generators.map((x) => x.id)
      .indexOf(copyId) === 2,
    'a duplicate sits right after its original',
  );
  // a group's own global: on its header; back to performance-wide when asked, or when the group goes
  run('group', 'add', 'Shelf 2');
  const shelfId = json('state').groups.find((x) => x.name === 'Shelf').id;
  check(json('global', 'add', 'layer', 'group=Shelf').group === shelfId, "global add group=: a group's own global");
  check(json('global', 'set', 'layer', 'group=none').group === undefined, 'global set group=none: performance-wide again');
  json('global', 'add', 'gone with it', 'group=Shelf 2');
  run('group', 'remove', 'Shelf 2');
  check(
    json('state').globals.find((x) => x.name === 'gone with it')?.group === undefined,
    'removing a group keeps its globals, performance-wide',
  );
  json('global', 'set', 'layer', 'group=Shelf');
  const orderFile = path.join(os.tmpdir(), `perturbed-cli-order-${process.pid}.json`);
  json('move', String(m3), `before=${m1}`);
  const wanted = json('state')
    .generators.map((x) => x.id)
    .join();
  run('save', orderFile);
  run('load', orderFile);
  check(
    json('state')
      .generators.map((x) => x.id)
      .join() === wanted,
    `the order survives save and open (${wanted})`,
  );
  check(json('state').globals.find((x) => x.name === 'layer')?.group === shelfId, "a group's global survives save and open");
  fs.unlinkSync(orderFile);
  run('new');
  check(json('state').unsaved === false, 'a new performance has nothing to save');
  check(fresh.file === null && !run('save').ok, 'a new performance has no file: save needs a name');
  check(json('add', 'basic').id === 2, 'ids start over in a new performance (1 is its chord strip)');
  check(json('state').unsaved === true, 'a change makes it unsaved');
  const kept = path.join(os.tmpdir(), `perturbed-cli-unsaved-${process.pid}.json`);
  run('save', kept);
  check(json('state').unsaved === false, 'saving clears that');
  check(json('state').file === kept, 'the performance knows its file');
  run('add', 'lfo');
  check(
    run('save').ok && json('state').unsaved === false && JSON.parse(fs.readFileSync(kept, 'utf8')).generators.length === 3,
    'save with no name goes to that file',
  );
  run('tempo', String(tempo));
  check(json('state').unsaved === true, 'a tempo change counts too');
  run('load', kept);
  check(json('state').unsaved === false, 'opening a file clears it');
  fs.unlinkSync(kept);
  run('remove', '1');
} catch (e) {
  check(false, e.message);
}
console.log(failed ? 'CLI FAILED' : 'CLI PASSED');
process.exit(failed ? 1 : 0);
