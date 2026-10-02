// adhoc.js — the type library against a running test brain whose library ($PERFORMED_ADHOC) is a
// temp copy of tests/adhoc/: listing, loading on demand, guarded loads and runs, favorites, keeping
// replaced versions, and performance files carrying their AdHoc types. Run via tests/run.sh.
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { encode, decode } = require('../surface/osc');

const DIR = process.env.PERFORMED_ADHOC;
const sock = dgram.createSocket('udp4');
let inbox = [], waiters = [];
sock.on('message', (b) => { const m = decode(b); inbox.push(m); waiters = waiters.filter((w) => !w(m)); });
const send = (a, ...args) => sock.send(encode(a, args), +process.env.PERFORMED_PORT, '127.0.0.1');
const next = (addr, pred = () => true, ms = 1500) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${addr}`)), ms);
  waiters.push((m) => { if (m.addr !== addr || !pred(...m.args)) return false; clearTimeout(t); resolve(m.args); return true; });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lib = (name) => { const m = [...inbox].reverse().find((x) => x.addr === '/library/type' && x.args[0] === name); return m && { builtin: m.args[1], favorite: m.args[2], loaded: m.args[3], bar: m.args[4], changed: m.args[5], description: m.args[6] }; };

let failed = false;
const check = (ok, what) => { if (!ok) failed = true; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); };

sock.bind(0, async () => {
  try {
    let end = next('/state/end'); send('/hello'); await end;
    check(lib('basic')?.builtin && lib('basic')?.favorite && lib('basic')?.bar, 'built-ins are favorites, on the bar');
    check(lib('echo-up') && !lib('echo-up').loaded && lib('echo-up').description.startsWith('test fixture'), 'AdHoc types listed with their description, not loaded');

    let loaded = next('/adhoc/loaded'); send('/adhoc/load', 'echo-up'); await loaded;
    check(lib('echo-up').loaded && lib('echo-up').bar && inbox.some((m) => m.addr === '/gen/schema' && m.args[0] === 'echo-up'), 'load on demand: schema sent, on the bar for the session');

    const gen = next('/gen', (id, t) => t === 'echo-up'); send('/gen/add', 'echo-up'); const [g] = await gen;
    send('/gen/set', g, 'active', 1);
    const note = next('/note', (id) => id === g); send('/transport/play', 1); await note; send('/transport/play', 0);
    check(true, 'an AdHoc generator plays');

    const err = next('/error', (m) => /broken didn't load/.test(m)); send('/adhoc/load', 'broken'); await err;
    check(!lib('broken').loaded && lib('echo-up').loaded, 'a broken file is reported and changes nothing');

    loaded = next('/adhoc/loaded'); send('/adhoc/load', 'crashy'); await loaded;
    const cg = next('/gen', (id, t) => t === 'crashy'); send('/gen/add', 'crashy'); const [c] = await cg;
    send('/gen/set', c, 'active', 1);
    const stopped = next('/error', (m) => /generator \d+ \(crashy\) stopped/.test(m));
    const off = next('/gen', (id, t, d, a) => id === c && a === 0);
    send('/transport/play', 1); await stopped; await off; send('/transport/play', 0);
    const pong = next('/pong'); send('/ping'); await pong;
    check(true, 'a type failing while running stops only its generator (reported, switched off; brain fine)');

    let snap = next('/state/end'); send('/favorite', 'echo-up', 1); await snap;
    const favs = JSON.parse(fs.readFileSync(path.join(DIR, 'favorites.json'), 'utf8'));
    check(lib('echo-up').favorite && favs.includes('echo-up') && favs.includes('basic'), 'favorite: starred and written to favorites.json');
    snap = next('/state/end'); send('/favorite', 'basic', 0); await snap;
    check(!lib('basic').favorite && !lib('basic').bar && lib('basic').loaded, 'unstarring a built-in takes it off the bar (still loaded)');
    snap = next('/state/end'); send('/favorite', 'basic', 1); await snap;

    // an edited file: shown as changed until reloaded; reloading keeps the old version and the settings
    send('/gen/set', g, 'note', 72); await next('/gen/param', (id, p) => id === g && p === 'note');
    const file = path.join(DIR, 'echo-up.scd');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('params: [[\\note, 60, \\note]]', 'params: [[\\note, 60, \\note], [\\vel, 80, \\range, 1, 127]]'));
    snap = next('/state/end'); send('/library/rescan'); await snap;
    check(lib('echo-up').changed, 'an edited file is marked changed');
    inbox = [];
    loaded = next('/adhoc/loaded'); send('/adhoc/load', 'echo-up'); await loaded;
    const params = inbox.filter((m) => m.addr === '/gen/param' && m.args[0] === g);
    check(params.some((m) => m.args[1] === 'note' && m.args[2] === 72) && params.some((m) => m.args[1] === 'vel'), 'reload: new params, settings kept');
    check(fs.readdirSync(path.join(DIR, 'old')).some((f) => f.startsWith('echo-up-')), 'the replaced version is kept in old/');

    // a performance carries its AdHoc type, even once the library's file is gone
    const perf = path.join(os.tmpdir(), `perturbed-adhoc-${process.pid}.json`);
    send('/gen/remove', c);
    const saved = next('/saved'); send('/save', perf); await saved;
    check(/vel/.test(JSON.parse(fs.readFileSync(perf, 'utf8')).adhoc['echo-up']), 'the performance file embeds the type');
    fs.renameSync(file, file + '.away');
    snap = next('/state/end'); send('/library/rescan'); await snap;
    inbox = [];
    snap = next('/state/end'); send('/load', perf); await snap;
    check(inbox.some((m) => m.addr === '/gen' && m.args[0] === g && m.args[1] === 'echo-up') && inbox.some((m) => m.addr === '/gen/schema' && m.args[0] === 'echo-up'),
      'opening it restores the AdHoc generator from the embedded copy');
    fs.renameSync(file + '.away', file);
    fs.unlinkSync(perf);
    send('/gen/remove', g);
  } catch (e) {
    check(false, e.message);
  }
  console.log(failed ? 'ADHOC FAILED' : 'ADHOC PASSED');
  process.exit(failed ? 1 : 0);
});
