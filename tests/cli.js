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

  const c = json('clock', 'add', 'mode=factor', 'factor=1.01');
  check(c.mode === 'factor' && Math.abs(c.factor - 1.01) < 1e-3, `clock add (${c.name})`);
  check(json('set', String(g.id), `clock=${c.name}`).params.clock === c.id, 'generator onto the clock by name');

  check(json('chord', 'C4', 'E4', 'G4').pitches.join() === '60,64,67', 'chord by note names');

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
  const back = json('state').globals.find((x) => x.name === 'Meta 1');
  check(
    back?.mappings.some((m) => m.setting === 'prob' && m.curve === 'threshold' && Math.abs(m.amount - 0.7) < 1e-6),
    'load keeps globals and their mappings',
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
} catch (e) {
  check(false, e.message);
}
console.log(failed ? 'CLI FAILED' : 'CLI PASSED');
process.exit(failed ? 1 : 0);
