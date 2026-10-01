// brain.js — a client for the brain's OSC protocol (brain/core/osc.scd) for tools: the perturbed
// CLI now, an MCP server later. It joins as a short-lived surface: /hello, mirror the snapshot and
// updates into a model, send intents and wait for the brain's echo, /bye.
//
// Settings are checked against the type schema before sending (the brain stores what it gets),
// and errors say what's allowed, so a caller (often Claude) can correct itself.
const dgram = require('dgram');
const path = require('path');
const { encode, decode } = require('../../surface/osc');

const PORT = +(process.env.PERFORMED_PORT || 57120);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (p) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;

class PerturbedError extends Error {}
const fail = (msg) => { throw new PerturbedError(msg); };

// "C4", "F#3", "Bb2" or a MIDI number -> MIDI number (C4 = 60)
function parseNote(v) {
  if (typeof v === 'number' || /^-?\d+$/.test(String(v))) return +v;
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d+)$/.exec(String(v).trim());
  if (!m) fail(`"${v}" is not a note (use a MIDI number or a name like C4, F#3, Bb2)`);
  const acc = { '#': 1, '♯': 1, b: -1, '♭': -1 }[m[2]] ?? 0;
  return (+m[3] + 1) * 12 + NOTE[m[1].toUpperCase()] + acc;
}

class Brain {
  constructor() {
    this.sock = dgram.createSocket('udp4');
    this.waiters = [];
    this.model = {
      playing: false, tempo: 0, ports: [],
      chord: { mode: 'auto', armed: false, pitches: [] },
      types: new Map(),   // name -> { params: [spec], output: bool, actions: [] }
      clocks: new Map(), dests: new Map(), gens: new Map(), live: null,
    };
    this.sock.on('message', (buf) => {
      let msg;
      try { msg = decode(buf); } catch { return; }
      this.apply(msg);
      this.waiters = this.waiters.filter((w) => !w(msg));
    });
  }

  // Connects and loads the full snapshot.
  static async connect({ timeout = 1500 } = {}) {
    const b = new Brain();
    await new Promise((r) => b.sock.bind(0, r));
    const end = b.waitFor('/state/end', () => true, timeout)
      .catch(() => fail(`the brain isn't answering on port ${PORT}: is Perturbed running?`));
    b.send('/hello');
    await end;
    return b;
  }

  close() {
    return new Promise((r) => this.sock.send(encode('/bye', []), PORT, '127.0.0.1', () => { this.sock.close(); r(); }));
  }

  send(addr, ...args) { this.sock.send(encode(addr, args), PORT, '127.0.0.1'); }

  // Resolves with the args of the first message (from now on) matching addr and pred.
  waitFor(addr, pred = () => true, ms = 1500) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new PerturbedError(`no ${addr} from the brain`)), ms);
      this.waiters.push((m) => {
        if (m.addr === '/error') { clearTimeout(t); reject(new PerturbedError(m.args[0])); return true; }
        if (m.addr !== addr || !pred(...m.args)) return false;
        clearTimeout(t); resolve(m.args); return true;
      });
    });
  }

  // Sends an intent and waits for its echo.
  async request(addr, args, echo, pred, ms) {
    const done = this.waitFor(echo, pred, ms);
    this.send(addr, ...args);
    return done;
  }

  // --- the model, kept up to date from what the brain reports (like surface/app.js) ---
  apply({ addr, args: a }) {
    const m = this.model;
    const type = (name) => {
      if (!m.types.has(name)) m.types.set(name, { params: [], output: true, actions: [] });
      return m.types.get(name);
    };
    const spec = (t, p) => type(t).params.find((s) => s.name === p);
    switch (addr) {
      case '/state/begin': m.types.clear(); m.clocks.clear(); m.dests.clear(); m.gens.clear(); m.live = null; break;
      case '/transport': m.playing = !!a[0]; m.tempo = a[1]; break;
      case '/ports': m.ports = a; break;
      case '/chord': m.chord = { mode: a[0], armed: !!a[1], pitches: a.slice(2) }; break;
      case '/gen/schema': type(a[0]).params.push({ name: a[1], kind: a[2], default: a[3], args: a.slice(4) }); break;
      case '/gen/label': { const s = spec(a[0], a[1]); if (s) s.label = a[2]; break; }
      case '/gen/section': { const s = spec(a[0], a[1]); if (s) s.section = a[2]; break; }
      case '/gen/show': { const s = spec(a[0], a[1]); if (s) s.showWhen = { param: a[2], values: a.slice(3).map(String) }; break; }
      case '/gen/nooutput': type(a[0]).output = false; break;
      case '/gen/action': type(a[0]).actions.push(a[1]); break;
      case '/clock': m.clocks.set(a[0], { id: a[0], name: a[1], mode: a[2], num: a[3], den: a[4], factor: a[5], bpm: a[6], tempo: a[7] }); break;
      case '/clock/removed': m.clocks.delete(a[0]); break;
      case '/dest': m.dests.set(a[0], { id: a[0], name: a[1], port: a[2], channel: a[3], instrument: a[4] }); break;
      case '/dest/removed': m.dests.delete(a[0]); break;
      case '/live/tracks': m.live = []; for (let i = 0; i + 3 < a.length; i += 4) m.live.push({ name: a[i], port: a[i + 1], channel: a[i + 2], instrument: a[i + 3] }); break;
      case '/live/tracks/clear': m.live = null; break;
      case '/gen': { const g = m.gens.get(a[0]) ?? { id: a[0], params: {} }; Object.assign(g, { type: a[1], dest: a[2], active: !!a[3] }); m.gens.set(a[0], g); break; }
      case '/gen/param': { const g = m.gens.get(a[0]); if (g) g.params[a[1]] = a[2]; break; }
      case '/gen/removed': m.gens.delete(a[0]); break;
    }
  }

  // --- lookups: ids or names, with errors that list what exists ---
  gen(id) {
    return this.model.gens.get(+id) ?? fail(`no generator ${id} (generators: ${[...this.model.gens.keys()].join(', ') || 'none'})`);
  }
  dest(v) {
    const m = this.model;
    if (v === 0 || v === '0' || v === 'none') return 0;
    const d = m.dests.get(+v) ?? [...m.dests.values()].find((x) => x.name.toLowerCase() === String(v).toLowerCase());
    return d ? d.id : fail(`no output "${v}" (outputs: ${[...m.dests.values()].map((x) => `${x.id} ${x.name}`).join(', ') || 'none'})`);
  }
  clock(v) {
    const m = this.model;
    if (v === 0 || v === '0' || String(v).toUpperCase() === 'A' || v === 'main') return 0;
    const c = m.clocks.get(+v) ?? [...m.clocks.values()].find((x) => x.name.toUpperCase() === String(v).toUpperCase());
    return c ? c.id : fail(`no clock "${v}" (clocks: A (main)${[...m.clocks.values()].map((x) => `, ${x.name}`).join('')})`);
  }
  type(name) {
    return this.model.types.get(name) ?? fail(`no generator type "${name}" (types: ${[...this.model.types.keys()].join(', ')})`);
  }

  // A generator setting, checked and converted for the brain.
  coerce(g, param, value) {
    if (param === 'active') {
      const on = { on: 1, true: 1, 1: 1, off: 0, false: 0, 0: 0 }[String(value).toLowerCase()];
      return on ?? fail(`active is on or off, not "${value}"`);
    }
    if (param === 'output' || param === 'dest') return this.dest(value);
    const t = this.type(g.type);
    const s = t.params.find((p) => p.name === param)
      ?? fail(`${g.type} has no setting "${param}" (settings: active, ${t.output ? 'output, ' : ''}${t.params.map((p) => p.name).join(', ')})`);
    switch (s.kind) {
      case 'choice': {
        const opt = s.args.find((o) => String(o).toLowerCase() === String(value).toLowerCase());
        return opt !== undefined ? String(opt) : fail(`${param} is one of ${s.args.join(', ')}, not "${value}"`);
      }
      case 'note': {
        const n = parseNote(value);
        return n >= 0 && n <= 127 ? n : fail(`${param} is a note from C-1 (0) to G9 (127)`);
      }
      case 'clock': return this.clock(value);
      case 'range': {
        const [min, max, step = 1] = s.args, n = Number(value);
        if (!Number.isFinite(n) || n < min || n > max) fail(`${param} is a number from ${min} to ${max}${step !== 1 ? ` in steps of ${step}` : ''}, not "${value}"`);
        return step % 1 === 0 && Number.isInteger(step) ? Math.round(n) : n;
      }
      default: return String(value);
    }
  }

  // --- reading ---
  state() {
    const m = this.model;
    const destName = (id) => m.dests.get(id)?.name ?? null;
    return {
      playing: m.playing,
      tempo: +m.tempo.toFixed(3),
      chord: { mode: m.chord.mode, armed: m.chord.armed, pitches: m.chord.pitches, names: m.chord.pitches.map(noteName) },
      clocks: [{ id: 0, name: 'A', mode: 'main', tempo: +m.tempo.toFixed(3) },
        ...[...m.clocks.values()].map((c) => ({ ...c, tempo: +c.tempo.toFixed(3) }))],
      outputs: [...m.dests.values()],
      live_tracks: m.live,  // Live's tracks on the brain's buses (null: no bridge)
      generators: [...m.gens.values()].map((g) => ({
        id: g.id, type: g.type, active: g.active,
        ...(this.model.types.get(g.type)?.output === false ? {} : { output: g.dest ? { id: g.dest, name: destName(g.dest) } : null }),
        params: g.params,
      })),
    };
  }

  schema(only) {
    const out = {};
    for (const [name, t] of this.model.types) {
      if (only && name !== only) continue;
      out[name] = {
        output: t.output,
        actions: t.actions,
        params: t.params.map((s) => ({
          name: s.name, kind: s.kind, default: s.default,
          ...(s.kind === 'range' ? { min: s.args[0], max: s.args[1], step: s.args[2] ?? 1 } : {}),
          ...(s.kind === 'choice' ? { options: s.args } : {}),
          ...(s.label ? { label: s.label } : {}),
          ...(s.section ? { section: s.section } : {}),
          ...(s.showWhen ? { shown_when: s.showWhen } : {}),
        })),
      };
    }
    if (only && !out[only]) this.type(only);
    return out;
  }

  // --- generators ---
  async addGen(typeName, settings = {}) {
    this.type(typeName);
    const before = new Set(this.model.gens.keys());
    const [id] = await this.request('/gen/add', [typeName], '/gen', (gid) => !before.has(gid));
    await this.setGen(id, settings);
    return this.state().generators.find((g) => g.id === id);
  }

  // settings: { param: value }; active is applied last, so a generator starts fully set up
  async setGen(id, settings) {
    const g = this.gen(id);
    const entries = Object.entries(settings).sort(([a], [b]) => (a === 'active') - (b === 'active'));
    const checked = entries.map(([p, v]) => [p === 'output' ? 'dest' : p, this.coerce(g, p, v)]);
    for (const [p, v] of checked) {
      if (p === 'active' || p === 'dest') await this.request('/gen/set', [g.id, p, v], '/gen', (gid) => gid === g.id);
      else await this.request('/gen/set', [g.id, p, v], '/gen/param', (gid, name) => gid === g.id && name === p);
    }
    return this.state().generators.find((x) => x.id === g.id);
  }

  async removeGen(id) {
    const g = this.gen(id);
    await this.request('/gen/remove', [g.id], '/gen/removed', (gid) => gid === g.id);
  }

  async action(id, name) {
    const g = this.gen(id), t = this.type(g.type);
    const a = t.actions.find((x) => x.toLowerCase() === String(name).toLowerCase())
      ?? fail(`${g.type} has no action "${name}" (actions: ${t.actions.join(', ') || 'none'})`);
    this.send('/gen/do', g.id, a);
  }

  // --- outputs ---
  async addOutput(name, port, channel, instrument = '') {
    port = +port; channel = +channel;
    if (!(port >= 1 && port <= this.model.ports.length)) fail(`port is 1 to ${this.model.ports.length} (${this.model.ports.map((p, i) => `${i + 1} = ${p}`).join(', ')})`);
    if (!(channel >= 1 && channel <= 16)) fail('channel is 1 to 16');
    const before = new Set(this.model.dests.keys());
    const [id] = await this.request('/dest/add', [String(name), port, channel, String(instrument)], '/dest', (did) => !before.has(did));
    return this.model.dests.get(id);
  }

  async removeOutput(v) {
    const id = this.dest(v);
    if (!id) fail('which output?');
    await this.request('/dest/remove', [id], '/dest/removed', (did) => did === id);
  }

  // Live tracks (reported by the bridge) that aren't outputs yet -> outputs. which: a track name or "all".
  async outputsFromLive(which = 'all') {
    const m = this.model;
    if (m.live === null) fail('Live\'s tracks are unknown: the Perturbed Bridge isn\'t connected');
    const taken = (t) => [...m.dests.values()].some((d) => d.port === t.port && d.channel === t.channel);
    const fresh = m.live.filter((t) => t.channel > 0 && !taken(t));
    const pick = which === 'all' ? fresh : fresh.filter((t) => t.name.toLowerCase() === String(which).toLowerCase());
    if (!pick.length) fail(which === 'all' ? 'no Live tracks to add' : `no Live track "${which}" that isn't an output (new: ${fresh.map((t) => t.name).join(', ') || 'none'})`);
    const added = [];
    for (const t of pick) added.push(await this.addOutput(t.name, t.port, t.channel, t.instrument));
    return added;
  }

  // --- clocks ---
  async addClock(settings = {}) {
    const before = new Set(this.model.clocks.keys());
    const [id] = await this.request('/clock/add', [], '/clock', (cid) => !before.has(cid));
    return Object.keys(settings).length ? this.setClock(id, settings) : this.model.clocks.get(id);
  }

  async setClock(v, settings) {
    const id = this.clock(v);
    if (!id) fail('clock A is the main clock: change it with tempo');
    const allowed = { mode: ['ratio', 'factor', 'free'], num: [1, 32], den: [1, 32], factor: [0.01, 16], bpm: [1, 999] };
    for (const [k, val] of Object.entries(settings)) {
      const a = allowed[k] ?? fail(`clocks have mode, num, den, factor, bpm, not "${k}"`);
      if (k === 'mode') { if (!a.includes(val)) fail(`mode is ratio, factor or free, not "${val}"`); }
      else if (!(+val >= a[0] && +val <= a[1])) fail(`${k} is ${a[0]} to ${a[1]}`);
      await this.request('/clock/set', [id, k, k === 'mode' ? val : +val], '/clock', (cid) => cid === id);
    }
    return this.model.clocks.get(id);
  }

  async removeClock(v) {
    const id = this.clock(v);
    if (!id) fail('clock A is the main clock and can\'t be removed');
    await this.request('/clock/remove', [id], '/clock/removed', (cid) => cid === id);
  }

  // --- transport, chord, control ---
  async tempo(bpm) {
    if (!(+bpm >= 20 && +bpm <= 400)) fail('tempo is 20 to 400 bpm');
    await this.request('/transport/tempo', [+bpm], '/transport');
    return this.model.tempo;
  }
  async scale(num, den) { await this.request('/transport/scale', [+num, +den], '/transport'); return this.model.tempo; }
  async play(on) { await this.request('/transport/play', [on ? 1 : 0], '/transport', (p) => !!p === on); }
  async chord(notes) {
    const pitches = notes.map(parseNote);
    await this.request('/chord/set', pitches, '/chord');
    return this.state().chord;
  }
  async chordClear() { await this.request('/chord/clear', [], '/chord'); }
  async chordMode(mode) {
    if (!['auto', 'arm'].includes(mode)) fail('chord mode is auto or arm');
    await this.request('/chord/mode', [mode], '/chord');
  }
  cc(bus, channel, cc, value) {
    for (const [n, v, lo, hi] of [['bus', bus, 1, 8], ['channel', channel, 1, 16], ['cc', cc, 0, 127], ['value', value, 0, 127]]) {
      if (!(Number.isInteger(+v) && +v >= lo && +v <= hi)) fail(`${n} is ${lo} to ${hi}`);
    }
    this.send('/cc', +bus, +channel, +cc, +value);
  }

  // --- files: paths are made absolute (the brain runs elsewhere) ---
  async save(file) {
    const p = path.resolve(file);
    await this.request('/save', [p], '/saved');
    return p;
  }
  async load(file) {
    const p = path.resolve(file);
    await this.request('/load', [p], '/state/end', () => true, 3000);
    return p;
  }
}

module.exports = { Brain, PerturbedError, parseNote, noteName };
