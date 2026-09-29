// protocol.js — acts as a surface against a running brain (test mode) and checks the OSC protocol:
// snapshot framing, schema, echoes of every accepted change, ping/pong, removals.
// Run via tests/run.sh.
const dgram = require('dgram');
const { encode, decode } = require('../surface/osc');

const sock = dgram.createSocket('udp4');
const inbox = [];
let waiters = [];
sock.on('message', (buf) => {
  const msg = decode(buf);
  inbox.push(msg);
  waiters = waiters.filter((w) => !w(msg));
});
const send = (addr, ...args) => sock.send(encode(addr, args), +process.env.PERFORMED_PORT, '127.0.0.1');

// Resolves with the first message (from now on) matching addr and pred.
const next = (addr, pred = () => true, ms = 1000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${addr}`)), ms);
  waiters.push((m) => {
    if (m.addr !== addr || !pred(...m.args)) return false;
    clearTimeout(t); resolve(m.args); return true;
  });
});

let failed = false;
const check = (ok, what) => { if (!ok) failed = true; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); };

sock.bind(0, async () => {
  try {
    const end = next('/state/end');
    send('/hello');
    await end;
    const addrs = inbox.map((m) => m.addr);
    check(addrs[0] === '/state/begin', 'snapshot starts with /state/begin');
    check(addrs.includes('/transport') && addrs.includes('/ports'), 'snapshot has /transport and /ports');
    const schema = inbox.filter((m) => m.addr === '/gen/schema' && m.args[0] === 'basic').map((m) => m.args[1]);
    check(['note', 'velocity', 'num', 'den'].every((p) => schema.includes(p)), `basic schema (${schema.join(' ')})`);

    const pong = next('/pong');
    send('/ping');
    const [bootId] = await pong;
    check(Number.isInteger(bootId), 'ping → pong <bootId>');

    // /hello <port>: replies go to that port, not the sender's (Max's udpsend case)
    const other = dgram.createSocket('udp4');
    await new Promise((r) => other.bind(0, r));
    const otherEnd = new Promise((resolve) => other.on('message', (b) => decode(b).addr === '/state/end' && resolve()));
    send('/hello', other.address().port);
    check(await Promise.race([otherEnd.then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]),
      '/hello <port> sends the snapshot to that port');
    other.close();

    const dest = next('/dest', (id, name) => name === 'proto');
    send('/dest/add', 'proto', 2, 16, 'none');
    const [destId, , port, channel] = await dest;
    check(port === 2 && channel === 16, 'dest/add echoed with port and channel');

    const gen = next('/gen');
    send('/gen/add', 'basic');
    const [genId, type, , active] = await gen;
    check(type === 'basic' && active === 0, 'gen/add echoed, inactive by default');

    const param = next('/gen/param', (id, p, v) => id === genId && p === 'note' && v === 67);
    send('/gen/set', genId, 'note', 67);
    await param;
    check(true, 'gen/set param echoed');

    const destSet = next('/gen', (id, t, d) => id === genId && d === destId);
    send('/gen/set', genId, 'dest', destId);
    await destSet;
    check(true, 'gen/set dest echoed');

    const tempo = next('/transport', (p, bpm) => Math.abs(bpm - 97.5) < 1e-3);
    send('/transport/tempo', 97.5);
    await tempo;
    check(true, 'tempo echoed');

    const up = next('/transport', (p, bpm) => Math.abs(bpm - 146.25) < 1e-3);
    send('/transport/scale', 3, 2);
    await up;
    const back = next('/transport', (p, bpm) => Math.abs(bpm - 97.5) < 1e-3);
    send('/transport/scale', 2, 3);
    await back;
    check(true, 'scale 3/2 then 2/3 returns to the same tempo');

    // clocks: ratio and factor follow main tempo changes, free doesn't
    const [ratioId] = await (() => { const c = next('/clock'); send('/clock/add'); return c; })();
    const [freeId] = await (() => { const c = next('/clock'); send('/clock/add'); return c; })();
    send('/clock/set', ratioId, 'num', 3);
    send('/clock/set', ratioId, 'den', 2);
    send('/clock/set', freeId, 'mode', 'free');
    send('/clock/set', freeId, 'bpm', 77);
    await new Promise((r) => setTimeout(r, 100));
    const ratioFollows = next('/clock', (id, n, mode, num, den, f, b, tempo) => id === ratioId && Math.abs(tempo - 150) < 1e-3);
    const freeStays = next('/clock', (id, n, mode, num, den, f, b, tempo) => id === freeId && Math.abs(tempo - 77) < 1e-3);
    send('/transport/tempo', 100);
    await Promise.all([ratioFollows, freeStays]);
    check(true, 'clock ratio 3/2 follows main tempo; free clock stays');
    const factorFollows = next('/clock', (id, n, mode, num, den, f, b, tempo) => id === ratioId && Math.abs(tempo - 125) < 1e-2);
    send('/clock/set', ratioId, 'mode', 'factor');
    send('/clock/set', ratioId, 'factor', 1.25);
    await factorFollows;
    check(true, 'clock factor 1.25');
    const onClock = next('/gen');
    send('/gen/add', 'basic');
    const [clockGen] = await onClock;
    send('/gen/set', clockGen, 'clock', freeId);
    const backToMain = next('/gen/param', (id, p, v) => id === clockGen && p === 'clock' && v === 0);
    send('/clock/remove', freeId);
    await backToMain;
    check(true, 'removing a clock moves its generators to main');
    send('/gen/remove', clockGen);

    const noteMsg = next('/note', (id) => id === genId, 1500);
    const beat = next('/beat', () => true, 1500);
    send('/gen/set', genId, 'active', 1);
    send('/transport/play', 1);
    await Promise.all([noteMsg, beat]);
    check(true, 'playing sends /note and /beat');
    send('/transport/play', 0);

    const destGone = next('/dest/removed', (id) => id === destId);
    const genCleared = next('/gen', (id, t, d) => id === genId && d === 0);
    send('/dest/remove', destId);
    await Promise.all([destGone, genCleared]);
    check(true, 'dest/remove echoed, generator unassigned');

    const genGone = next('/gen/removed', (id) => id === genId);
    send('/gen/remove', genId);
    await genGone;
    check(true, 'gen/remove echoed');

    // save → change → load: state comes back in a full snapshot
    const file = require('path').join(require('os').tmpdir(), `performed-test-${process.pid}.json`);
    const d2 = next('/dest', (id, name) => name === 'saved');
    send('/dest/add', 'saved', 1, 3, 'Pianoteq 9');
    const [savedDest] = await d2;
    const g2 = next('/gen');
    send('/gen/add', 'basic');
    const [savedGen] = await g2;
    send('/gen/set', savedGen, 'dest', savedDest);
    send('/gen/set', savedGen, 'num', 5);
    send('/gen/set', savedGen, 'rate', 0.25);  // fractional value of a float param
    send('/gen/set', savedGen, 'source', 'arpeggio');
    send('/chord/mode', 'arm');
    send('/chord/set', 62, 65, 69);
    const tempo2 = next('/transport', (p, bpm) => bpm === 111);
    send('/transport/tempo', 111);
    await tempo2;
    const pg = next('/gen', (id, t) => t === 'passthrough');
    send('/gen/add', 'passthrough');
    const [passGen] = await pg;
    send('/gen/set', passGen, 'delay', 0.5);
    await new Promise((r) => setTimeout(r, 100));
    send('/save', file);
    await new Promise((r) => setTimeout(r, 200));
    send('/gen/remove', savedGen);
    send('/dest/remove', savedDest);
    send('/chord/clear');
    send('/chord/mode', 'auto');
    send('/transport/tempo', 90);
    await new Promise((r) => setTimeout(r, 200));
    inbox.length = 0;
    const loaded = next('/state/end');
    send('/load', file);
    await loaded;
    const has = (addr, pred) => inbox.some((m) => m.addr === addr && pred(...m.args));
    check(has('/transport', (p, bpm) => bpm === 111), 'load restores tempo');
    check(has('/clock', (id, n, mode, num, den, factor) => id === ratioId && mode === 'factor' && Math.abs(factor - 1.25) < 1e-3), 'load restores clocks');
    check(has('/chord', (mode, armed, ...ps) => mode === 'arm' && ps.join() === '62,65,69'), 'load restores chord and mode');
    check(has('/dest', (id, name, port, ch, inst) => id === savedDest && name === 'saved' && ch === 3 && inst === 'Pianoteq 9'), 'load restores destinations');
    check(has('/gen', (id, t, d) => id === savedGen && d === savedDest), 'load restores generators with their dest');
    check(has('/gen/param', (id, p, v) => id === savedGen && p === 'num' && v === 5)
      && has('/gen/param', (id, p, v) => id === savedGen && p === 'source' && v === 'arpeggio')
      && has('/gen/param', (id, p, v) => id === savedGen && p === 'rate' && Math.abs(v - 0.25) < 1e-6), 'load restores params');
    check(has('/gen/param', (id, p, v) => id === passGen && p === 'delay' && Math.abs(v - 0.5) < 1e-6), 'load keeps 0.5 for a param defaulting to 0');
    require('fs').unlinkSync(file);
  } catch (e) {
    check(false, e.message);
  }
  console.log(failed ? 'PROTOCOL FAILED' : 'PROTOCOL PASSED');
  process.exit(failed ? 1 : 0);
});
