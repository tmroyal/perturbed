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
    const schema = inbox.filter((m) => m.addr === '/gen/schema' && m.args[0] === 'fractionalRepeat').map((m) => m.args[1]);
    check(['note', 'velocity', 'num', 'den'].every((p) => schema.includes(p)), `fractionalRepeat schema (${schema.join(' ')})`);

    const pong = next('/pong');
    send('/ping');
    const [bootId] = await pong;
    check(Number.isInteger(bootId), 'ping → pong <bootId>');

    const dest = next('/dest', (id, name) => name === 'proto');
    send('/dest/add', 'proto', 2, 16, 'none');
    const [destId, , port, channel] = await dest;
    check(port === 2 && channel === 16, 'dest/add echoed with port and channel');

    const gen = next('/gen');
    send('/gen/add', 'fractionalRepeat');
    const [genId, type, , active] = await gen;
    check(type === 'fractionalRepeat' && active === 0, 'gen/add echoed, inactive by default');

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
    send('/gen/add', 'fractionalRepeat');
    const [savedGen] = await g2;
    send('/gen/set', savedGen, 'dest', savedDest);
    send('/gen/set', savedGen, 'num', 5);
    send('/gen/set', savedGen, 'source', 'arpeggio');
    send('/chord/mode', 'add');
    send('/chord/set', 62, 65, 69);
    const tempo2 = next('/transport', (p, bpm) => bpm === 111);
    send('/transport/tempo', 111);
    await tempo2;
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
    check(has('/chord', (mode, ...ps) => mode === 'add' && ps.join() === '62,65,69'), 'load restores chord and mode');
    check(has('/dest', (id, name, port, ch, inst) => id === savedDest && name === 'saved' && ch === 3 && inst === 'Pianoteq 9'), 'load restores destinations');
    check(has('/gen', (id, t, d) => id === savedGen && d === savedDest), 'load restores generators with their dest');
    check(has('/gen/param', (id, p, v) => id === savedGen && p === 'num' && v === 5)
      && has('/gen/param', (id, p, v) => id === savedGen && p === 'source' && v === 'arpeggio'), 'load restores params');
    require('fs').unlinkSync(file);
  } catch (e) {
    check(false, e.message);
  }
  console.log(failed ? 'PROTOCOL FAILED' : 'PROTOCOL PASSED');
  process.exit(failed ? 1 : 0);
});
