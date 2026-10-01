// cli.js — drives a running test brain through tools/perturbed and checks the results:
// adding and setting generators by name, validation errors, outputs, clocks, chord, save/load.
// Run via tests/run.sh (PERFORMED_PORT points the CLI at the test brain).
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CLI = path.join(__dirname, '..', 'tools', 'perturbed');
const run = (...args) => {
  try { return { ok: true, out: execFileSync(CLI, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: String(e.stderr) }; }
};
const json = (...args) => JSON.parse(run(...args).out);

let failed = false;
const check = (ok, what) => { if (!ok) failed = true; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); };

try {
  const schema = json('schema');
  check(schema.basic && schema.lfo && schema.lfo.output === false && schema.lfo.actions.includes('Send'), 'schema: types, lfo has no output and a Send action');

  const out = json('output', 'add', 'cli', '1', '4', 'none');
  check(out.name === 'cli' && out.channel === 4, `output add (${out.id})`);

  const g = json('add', 'basic', 'source=arpeggio', 'note=E4', 'output=cli', 'num=1', 'den=2');
  check(g.params.source === 'arpeggio' && g.params.note === 64 && g.output?.name === 'cli' && g.params.den === 2 && !g.active,
    `add basic with settings by name (gen ${g.id})`);

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
  json('group', 'set', 'Layer A', 'on=off', 'collapsed=on');
  const muted = json('state');
  check(muted.groups.some((x) => x.name === 'Layer A' && !x.on && x.collapsed) && muted.generators.find((x) => x.id === g.id).sounding === false,
    'group off: generator still on, not sounding');
  run('group', 'remove', 'Layer A');
  run('off', String(g.id));
  check(json('state').generators.find((x) => x.id === g.id).group === null && grp.id > 0, 'group remove: generator ungrouped');

  const c = json('clock', 'add', 'mode=factor', 'factor=1.01');
  check(c.mode === 'factor' && Math.abs(c.factor - 1.01) < 1e-3, `clock add (${c.name})`);
  check(json('set', String(g.id), `clock=${c.name}`).params.clock === c.id, 'generator onto the clock by name');

  check(json('chord', 'C4', 'E4', 'G4').pitches.join() === '60,64,67', 'chord by note names');

  const file = path.join(os.tmpdir(), `perturbed-cli-${process.pid}.json`);
  check(run('save', file).ok && fs.existsSync(file), 'save writes the file');
  run('remove', String(g.id));
  check(!json('state').generators.some((x) => x.id === g.id), 'remove');
  check(run('load', file).ok && json('state').generators.some((x) => x.id === g.id && x.params.source === 'arpeggio'), 'load brings it back');
  fs.unlinkSync(file);

  r = run('load', '/nonexistent/perturbed.json');
  check(!r.ok && /load failed/.test(r.out), 'a failed load reports the error');

  run('remove', String(g.id)); run('output', 'remove', 'cli'); run('clock', 'remove', c.name); run('chord', 'clear');
  const s = json('state');
  check(!s.generators.some((x) => x.id === g.id) && !s.outputs.some((o) => o.name === 'cli') && !s.clocks.some((x) => x.id === c.id), 'cleaned up');
} catch (e) {
  check(false, e.message);
}
console.log(failed ? 'CLI FAILED' : 'CLI PASSED');
process.exit(failed ? 1 : 0);
