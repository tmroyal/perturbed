// brain.js — a client for the brain's OSC protocol (brain/core/osc.scd) for tools (the perturbed
// CLI). It joins as a short-lived surface: /hello, mirror the snapshot and
// updates into a model, send intents and wait for the brain's echo, /bye.
//
// Settings are checked against the type schema before sending (the brain stores what it gets),
// and errors say what's allowed, so a caller (often Claude) can correct itself.
const dgram = require('node:dgram');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { encode, decode } = require('../../surface/osc');

const PORT = +(process.env.PERFORMED_PORT || 57120);
const ROOT = path.join(__dirname, '..', '..');
const ADHOC = process.env.PERFORMED_ADHOC || path.join(ROOT, 'adhoc');
const typePath = (name, builtin) => (builtin ? path.join(ROOT, 'brain', 'types', `${name}.scd`) : path.join(ADHOC, `${name}.scd`));
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (p) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;

class PerturbedError extends Error {}
const fail = (msg) => {
  throw new PerturbedError(msg);
};

// on/off settings (active, a group's on, solo, collapsed) -> 1 | 0
const FLAG = { on: 1, true: 1, 1: 1, yes: 1, off: 0, false: 0, 0: 0, no: 0 };
const listed = (map) => [...map.values()].map((x) => `${x.id} ${x.name}`).join(', ') || 'none';
const flag = (name, v) => FLAG[String(v).toLowerCase()] ?? fail(`${name} is on or off, not "${v}"`);

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
      playing: false,
      tempo: 0,
      ports: [],
      chord: { mode: 'auto', armed: false, pitches: [] },
      types: new Map(), // name -> { params: [spec], output: bool, actions: [] }
      clocks: new Map(),
      dests: new Map(),
      gens: new Map(),
      globals: new Map(),
      groups: new Map(),
      live: null,
      library: new Map(), // every type, built-in and AdHoc
    };
    this.sock.on('message', (buf) => {
      let msg;
      try {
        msg = decode(buf);
      } catch {
        return;
      }
      this.apply(msg);
      this.waiters = this.waiters.filter((w) => !w(msg));
    });
  }

  // Connects and loads the full snapshot.
  static async connect({ timeout = 1500 } = {}) {
    const b = new Brain();
    await new Promise((r) => b.sock.bind(0, r));
    const end = b
      .waitFor('/state/end', () => true, timeout)
      .catch(() => {
        b.sock.close();
        fail(`the brain isn't answering on port ${PORT}: is Perturbed running?`);
      });
    b.send('/hello');
    await end;
    b.bootId = await b.ping();
    return b;
  }

  // The brain's boot id, or null if it doesn't answer (a new id means it restarted: reconnect).
  async ping(ms = 800) {
    try {
      return (await this.request('/ping', [], '/pong', () => true, ms))[0];
    } catch {
      return null;
    }
  }

  close() {
    return new Promise((r) =>
      this.sock.send(encode('/bye', []), PORT, '127.0.0.1', () => {
        this.sock.close();
        r();
      }),
    );
  }

  send(addr, ...args) {
    this.sock.send(encode(addr, args), PORT, '127.0.0.1');
  }

  // Resolves with the args of the first message (from now on) matching addr and pred.
  waitFor(addr, pred = () => true, ms = 1500) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new PerturbedError(`no ${addr} from the brain`)), ms);
      this.waiters.push((m) => {
        if (m.addr === '/error') {
          clearTimeout(t);
          reject(new PerturbedError(m.args[0]));
          return true;
        }
        if (m.addr !== addr || !pred(...m.args)) return false;
        clearTimeout(t);
        resolve(m.args);
        return true;
      });
    });
  }

  // Sends an intent and waits for its echo.
  async request(addr, args, echo, pred, ms) {
    const done = this.waitFor(echo, pred, ms);
    this.send(addr, ...args);
    return done;
  }

  // Sends an add intent; resolves with the new object's id (the first echo with an id not in map).
  async create(addr, args, echo, map) {
    const before = new Set(map.keys());
    return (await this.request(addr, args, echo, (id) => !before.has(id)))[0];
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
      case '/state/begin':
        m.types.clear();
        m.clocks.clear();
        m.dests.clear();
        m.gens.clear();
        m.groups.clear();
        m.globals.clear();
        m.library.clear();
        m.live = null;
        break;
      case '/library/type':
        m.library.set(a[0], {
          name: a[0],
          builtin: !!a[1],
          favorite: !!a[2],
          loaded: !!a[3],
          on_bar: !!a[4],
          changed: !!a[5],
          description: a[6],
          modified: new Date(a[7] * 1000).toISOString().slice(0, 16),
        });
        break;
      case '/group':
        m.groups.set(a[0], {
          id: a[0],
          name: a[1],
          on: !!a[2],
          solo: !!a[3],
          collapsed: !!a[4],
          key: a[5] >= 0 ? a[5] : null, // its on/off switch key (a MIDI note)
          pins: m.groups.get(a[0])?.pins ?? [],
        });
        break;
      case '/group/pins': {
        const g = m.groups.get(a[0]);
        if (g) {
          g.pins = [];
          for (let i = 1; i + 1 < a.length; i += 2) g.pins.push({ generator: a[i], setting: a[i + 1] });
        }
        break;
      }
      case '/global':
        m.globals.set(a[0], {
          id: a[0],
          name: a[1],
          value: +a[2].toFixed(4),
          knob: a[3] ? { channel: a[3], cc: a[4] } : null,
          response: a[5] ?? 'linear', // how it answers its knob; `formula` (in x) when response is formula
          ...(a[5] === 'formula' ? { formula: a[6] } : {}),
          mappings: m.globals.get(a[0])?.mappings ?? [],
        });
        break;
      case '/global/mappings':
      case '/gen/targets': {
        const g = (addr === '/gen/targets' ? m.gens : m.globals).get(a[0]); // a driver: a global, or a generator that maps
        if (g) {
          g.mappings = [];
          for (let i = 1; i + 5 < a.length; i += 6) {
            g.mappings.push({
              generator: a[i],
              setting: a[i + 1],
              from: a[i + 2],
              to: a[i + 3],
              curve: a[i + 4],
              amount: a[i + 5] < 0 ? null : a[i + 5],
            });
          }
        }
        break;
      }
      case '/global/removed':
        m.globals.delete(a[0]);
        break;
      case '/group/removed':
        m.groups.delete(a[0]);
        break;
      case '/file':
        m.file = a[0] || null;
        break;
      case '/dirty':
        m.unsaved = !!a[0];
        break;
      case '/transport':
        m.playing = !!a[0];
        m.tempo = a[1];
        break;
      case '/ports':
        m.ports = a;
        break;
      case '/inputs':
        m.inputs = [];
        for (let i = 0; i + 2 < a.length; i += 3) m.inputs.push({ name: a[i], on: !!a[i + 1], role: a[i + 2] });
        break;
      case '/chord':
        m.chord = { mode: a[0], armed: !!a[1], pitches: a.slice(2) };
        break;
      case '/gen/schema':
        type(a[0]).params.push({ name: a[1], kind: a[2], default: a[3], args: a.slice(4) });
        break;
      case '/gen/label': {
        const s = spec(a[0], a[1]);
        if (s) s.label = a[2];
        break;
      }
      case '/gen/section': {
        const s = spec(a[0], a[1]);
        if (s) s.section = a[2];
        break;
      }
      case '/gen/show': {
        const s = spec(a[0], a[1]);
        if (s) s.showWhen = { param: a[2], values: a.slice(3).map(String) };
        break;
      }
      case '/gen/nooutput':
        type(a[0]).output = false;
        break;
      case '/gen/maps':
        type(a[0]).maps = true;
        break;
      case '/gen/action':
        type(a[0]).actions.push(a[1]);
        break;
      case '/clock':
        m.clocks.set(a[0], { id: a[0], name: a[1], mode: a[2], num: a[3], den: a[4], factor: a[5], bpm: a[6], tempo: a[7] });
        break;
      case '/clock/removed':
        m.clocks.delete(a[0]);
        break;
      case '/dest':
        m.dests.set(a[0], { id: a[0], name: a[1], port: a[2], channel: a[3], instrument: a[4] });
        break;
      case '/dest/removed':
        m.dests.delete(a[0]);
        break;
      case '/live/tracks':
        m.live = [];
        for (let i = 0; i + 3 < a.length; i += 4) m.live.push({ name: a[i], port: a[i + 1], channel: a[i + 2], instrument: a[i + 3] });
        break;
      case '/live/tracks/clear':
        m.live = null;
        break;
      case '/gen': {
        const g = m.gens.get(a[0]) ?? { id: a[0], params: {} };
        Object.assign(g, {
          type: a[1],
          dest: a[2],
          active: !!a[3],
          group: a[4] ?? 0,
          collapsed: !!a[5],
          key: a[6] >= 0 ? a[6] : null,
          order: a[7] ?? 0,
        });
        m.gens.set(a[0], g);
        break;
      }
      case '/gen/param': {
        const g = m.gens.get(a[0]);
        if (g) g.params[a[1]] = a[2];
        break;
      }
      case '/gen/removed':
        m.gens.delete(a[0]);
        break;
    }
  }

  // --- lookups: ids or names, with errors that list what exists ---
  gen(id) {
    return this.model.gens.get(+id) ?? fail(`no generator ${id} (generators: ${[...this.model.gens.keys()].join(', ') || 'none'})`);
  }
  // An output, clock or group by id or name (any case) -> its id; 0, '0' and the `none` words -> 0.
  find(map, v, what, listed, none = ['none']) {
    if (v === 0 || v === '0' || none.includes(String(v).toLowerCase())) return 0;
    const x = map.get(+v) ?? [...map.values()].find((o) => o.name.toLowerCase() === String(v).toLowerCase());
    return x ? x.id : fail(`no ${what} "${v}" (${what}s: ${listed})`);
  }
  dest(v) {
    return this.find(this.model.dests, v, 'output', listed(this.model.dests));
  }
  global(v) {
    return this.find(this.model.globals, v, 'global', listed(this.model.globals));
  }
  group(v) {
    return this.find(this.model.groups, v, 'group', listed(this.model.groups));
  }
  clock(v) {
    const names = [...this.model.clocks.values()].map((x) => `, ${x.name}`).join('');
    return this.find(this.model.clocks, v, 'clock', `A (main)${names}`, ['a', 'main']);
  }
  type(name) {
    return (
      this.model.types.get(name) ??
      fail(
        this.model.library.has(name)
          ? `type "${name}" isn't loaded (adhoc load ${name})`
          : `no generator type "${name}" (library: ${[...this.model.library.keys()].join(', ')})`,
      )
    );
  }

  param(typeName, name) {
    return this.type(typeName).params.find((p) => p.name === name);
  }

  // A generator setting, checked and converted for the brain.
  coerce(g, param, value) {
    if (param === 'active') return flag('active', value);
    if (param === 'output' || param === 'dest') return this.dest(value);
    if (param === 'group') return this.group(value);
    if (param === 'collapsed') return flag('collapsed', value);
    const t = this.type(g.type);
    const s =
      this.param(g.type, param) ??
      fail(
        `${g.type} has no setting "${param}" (settings: active, group, collapsed, ${t.output ? 'output, ' : ''}${t.params.map((p) => p.name).join(', ')})`,
      );
    switch (s.kind) {
      case 'choice': {
        const opt = s.args.find((o) => String(o).toLowerCase() === String(value).toLowerCase());
        return opt !== undefined ? String(opt) : fail(`${param} is one of ${s.args.join(', ')}, not "${value}"`);
      }
      case 'note': {
        const n = parseNote(value);
        return n >= 0 && n <= 127 ? n : fail(`${param} is a note from C-1 (0) to G9 (127)`);
      }
      case 'clock':
        return this.clock(value);
      case 'range': {
        const [min, max, step = 1] = s.args,
          n = Number(value);
        if (!Number.isFinite(n) || n < min || n > max)
          fail(`${param} is a number from ${min} to ${max}${step !== 1 ? ` in steps of ${step}` : ''}, not "${value}"`);
        return step % 1 === 0 && Number.isInteger(step) ? Math.round(n) : n;
      }
      default:
        return String(value);
    }
  }

  // --- reading ---
  state() {
    const m = this.model;
    const destName = (id) => m.dests.get(id)?.name ?? null;
    return {
      playing: m.playing,
      file: m.file ?? null, // the performance's file (where save without a name goes)
      unsaved: !!m.unsaved, // changes since it was saved, opened or started new
      tempo: +m.tempo.toFixed(3),
      chord: { mode: m.chord.mode, armed: m.chord.armed, pitches: m.chord.pitches, names: m.chord.pitches.map(noteName) },
      clocks: [
        { id: 0, name: 'A', mode: 'main', tempo: +m.tempo.toFixed(3) },
        ...[...m.clocks.values()].map((c) => ({ ...c, tempo: +c.tempo.toFixed(3) })),
      ],
      outputs: [...m.dests.values()],
      live_tracks: m.live, // Live's tracks on the brain's buses (null: no bridge)
      groups: [...m.groups.values()],
      globals: [...m.globals.values()],
      generators: [...m.gens.values()]
        .sort((x, y) => x.order - y.order || x.id - y.id) // the performer's order (cards can be moved)
        .map((g) => ({
          id: g.id,
          type: g.type,
          active: g.active,
          sounding: this.sounds(g),
          collapsed: !!g.collapsed,
          ...(g.key == null ? {} : { key: g.key }), // its on/off switch key (a MIDI note)
          ...(this.model.types.get(g.type)?.maps ? { targets: g.mappings ?? [] } : {}), // what it drives
          group: g.group ? { id: g.group, name: m.groups.get(g.group)?.name ?? null } : null,
          ...(this.model.types.get(g.type)?.output === false ? {} : { output: g.dest ? { id: g.dest, name: destName(g.dest) } : null }),
          params: g.params,
          ...(this.mappedSettings(g.id) ? { follows: this.mappedSettings(g.id) } : {}), // setting -> global (locked)
        })),
    };
  }

  // { setting: global name } for a generator's settings that follow a global, or null
  mappedSettings(genId) {
    const out = {};
    for (const gl of this.model.globals.values()) for (const m of gl.mappings) if (m.generator === genId) out[m.setting] = gl.name;
    // generators that drive settings (lfo)
    for (const d of this.model.gens.values()) {
      for (const m of d.mappings ?? []) if (m.generator === genId) out[m.setting] = `${d.type[0].toUpperCase()}${d.type.slice(1)} ${d.id}`;
    }
    return Object.keys(out).length ? out : null;
  }

  // whether a generator sounds: on, its group on, and not soloed out (core/groups.scd)
  sounds(g) {
    const gr = this.model.groups.get(g.group);
    const anySolo = [...this.model.groups.values()].some((x) => x.solo);
    return g.active && (!gr || gr.on) && (!anySolo || !!gr?.solo);
  }

  schema(only) {
    const out = {};
    for (const [name, t] of this.model.types) {
      if (only && name !== only) continue;
      out[name] = {
        output: t.output,
        actions: t.actions,
        params: t.params.map((s) => ({
          name: s.name,
          kind: s.kind,
          default: s.default,
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
    if (!this.model.types.has(typeName) && this.model.library.has(typeName)) await this.loadType(typeName);
    const t = this.type(typeName);
    const before = new Set(this.model.gens.keys());
    // the brain sends /gen, then every default as /gen/param: wait for the last one, so the echoes
    // of our settings can't be confused with the defaults still arriving
    const last = t.params[t.params.length - 1]?.name;
    const defaults = this.waitFor('/gen/param', (gid, name) => !before.has(gid) && name === last);
    const [id] = await this.request('/gen/add', [typeName], '/gen', (gid) => !before.has(gid));
    if (last) await defaults;
    await this.setGen(id, settings);
    return this.state().generators.find((g) => g.id === id);
  }

  // settings: { param: value }; active is applied last, so a generator starts fully set up
  async setGen(id, settings) {
    const g = this.gen(id);
    const entries = Object.entries(settings).sort(([a], [b]) => (a === 'active') - (b === 'active'));
    const checked = entries.map(([p, v]) => [p === 'output' ? 'dest' : p, this.coerce(g, p, v)]);
    for (const [p, v] of checked) {
      if (['active', 'dest', 'group', 'collapsed'].includes(p)) await this.request('/gen/set', [g.id, p, v], '/gen', (gid) => gid === g.id);
      else await this.request('/gen/set', [g.id, p, v], '/gen/param', (gid, name) => gid === g.id && name === p);
    }
    return this.state().generators.find((x) => x.id === g.id);
  }

  // Moves a generator before another (`before`: an id; omitted: to the end) and, if `group` is given,
  // into that group ('none': out of any). Returns the generator ids in their new order.
  async moveGen(id, { before, group } = {}) {
    const g = this.gen(id);
    const b = before === undefined ? 0 : this.gen(before).id;
    const gr = group === undefined ? -1 : this.group(group);
    await this.request('/gen/move', [g.id, b, gr], '/gen', (gid) => gid === g.id);
    await new Promise((r) => setTimeout(r, 60)); // the others' new places follow
    return this.state().generators.map((x) => x.id);
  }

  // A copy: same type, settings, output and group, switched off.
  async duplicateGen(id) {
    const g = this.gen(id);
    const t = this.type(g.type);
    const last = t.params[t.params.length - 1]?.name;
    const before = new Set(this.model.gens.keys());
    // its settings arrive after it: wait for the last one, as addGen does
    const settled = this.waitFor('/gen/param', (gid, name) => !before.has(gid) && name === last);
    const copy = await this.create('/gen/duplicate', [g.id], '/gen', this.model.gens);
    if (last) await settled;
    return this.state().generators.find((x) => x.id === copy);
  }

  async removeGen(id) {
    const g = this.gen(id);
    await this.request('/gen/remove', [g.id], '/gen/removed', (gid) => gid === g.id);
  }

  async action(id, name) {
    const g = this.gen(id),
      t = this.type(g.type);
    const a =
      t.actions.find((x) => x.toLowerCase() === String(name).toLowerCase()) ??
      fail(`${g.type} has no action "${name}" (actions: ${t.actions.join(', ') || 'none'})`);
    this.send('/gen/do', g.id, a);
  }

  // --- outputs ---
  async addOutput(name, port, channel, instrument = '') {
    port = +port;
    channel = +channel;
    if (!(port >= 1 && port <= this.model.ports.length))
      fail(`port is 1 to ${this.model.ports.length} (${this.model.ports.map((p, i) => `${i + 1} = ${p}`).join(', ')})`);
    if (!(channel >= 1 && channel <= 16)) fail('channel is 1 to 16');
    const id = await this.create('/dest/add', [String(name), port, channel, String(instrument)], '/dest', this.model.dests);
    return this.model.dests.get(id);
  }

  async removeOutput(v) {
    const id = this.dest(v) || fail('which output?');
    await this.request('/dest/remove', [id], '/dest/removed', (did) => did === id);
  }

  // Live tracks (reported by the bridge) that aren't outputs yet -> outputs. which: a track name or "all".
  async outputsFromLive(which = 'all') {
    const m = this.model;
    if (m.live === null) fail("Live's tracks are unknown: the Perturbed Bridge isn't connected");
    const taken = (t) => [...m.dests.values()].some((d) => d.port === t.port && d.channel === t.channel);
    const fresh = m.live.filter((t) => t.channel > 0 && !taken(t));
    const pick = which === 'all' ? fresh : fresh.filter((t) => t.name.toLowerCase() === String(which).toLowerCase());
    if (!pick.length)
      fail(
        which === 'all'
          ? 'no Live tracks to add'
          : `no Live track "${which}" that isn't an output (new: ${fresh.map((t) => t.name).join(', ') || 'none'})`,
      );
    const added = [];
    for (const t of pick) added.push(await this.addOutput(t.name, t.port, t.channel, t.instrument));
    return added;
  }

  // --- groups ---
  async addGroup(name, settings = {}) {
    const id = await this.create('/group/add', name ? [String(name)] : [], '/group', this.model.groups);
    return Object.keys(settings).length ? this.setGroup(id, settings) : this.model.groups.get(id);
  }

  // settings: name, on (on|off), solo (on|off), collapsed (on|off)
  async setGroup(v, settings) {
    const id = this.group(v) || fail('which group?');
    for (const [k, val] of Object.entries(settings)) {
      if (!['name', 'on', 'solo', 'collapsed'].includes(k)) fail(`groups have name, on, solo, collapsed, not "${k}"`);
      await this.request('/group/set', [id, k, k === 'name' ? String(val) : flag(k, val)], '/group', (gid) => gid === id);
    }
    return this.model.groups.get(id);
  }

  // --- global parameters (core/globals.scd) ---
  async addGlobal(name, settings = {}) {
    const id = await this.create('/global/add', name ? [String(name)] : [], '/global', this.model.globals);
    return Object.keys(settings).length ? this.setGlobal(id, settings) : this.model.globals.get(id);
  }

  // settings: name, value (0–1), response (to its knob: linear|invert|exp|log|formula), formula (in x)
  async setGlobal(v, settings) {
    const id = this.global(v) || fail('which global?');
    for (const [k, val] of Object.entries(settings)) {
      if (k === 'value' && !(+val >= 0 && +val <= 1)) fail("a global's value is 0 to 1");
      if (!['name', 'value', 'response', 'formula'].includes(k)) fail(`globals have name, value, response and formula, not "${k}"`);
      if (k === 'response' && !['linear', 'invert', 'exp', 'log', 'formula'].includes(val))
        fail('response is linear, invert, exp, log or formula');
      await this.request('/global/set', [id, k, k === 'value' ? +val : String(val)], '/global', (gid) => gid === id);
    }
    return this.model.globals.get(id);
  }

  async removeGlobal(v) {
    const id = this.global(v) || fail('which global?');
    await this.request('/global/remove', [id], '/global/removed', (gid) => gid === id);
  }

  // Maps a generator's setting to a global. from/to in the setting's units (notes by name, menu
  // options by name), from > to inverts; curve linear|exp|steps|threshold, amount = steps or the
  // threshold point. Left out: from = the current value, to = the far end of the range.
  async map(globalRef, genId, param, from, to, curve = 'linear', amount) {
    return this.mapTo({ kind: 'global', id: this.global(globalRef) || fail('which global?') }, genId, param, from, to, curve, amount);
  }

  // The same from a generator that drives settings (lfo): `lfoId` moves the setting over from..to.
  async mapFrom(lfoId, genId, param, from, to, curve = 'linear', amount) {
    const d = this.gen(lfoId);
    if (!this.type(d.type).maps) fail(`generator ${d.id} (${d.type}) can't drive settings: an lfo can`);
    return this.mapTo({ kind: 'gen', id: d.id }, genId, param, from, to, curve, amount);
  }

  async unmapFrom(lfoId, genId, param) {
    const d = this.gen(lfoId);
    await this.request('/gen/unmap', [d.id, +genId, param], '/gen/targets', (gid) => gid === d.id);
    return this.state().generators.find((x) => x.id === d.id);
  }

  async mapTo(driver, genId, param, from, to, curve, amount) {
    const { id } = driver;
    const [addr, echo] = driver.kind === 'global' ? ['/global/map', '/global/mappings'] : ['/gen/map', '/gen/targets'];
    const g = this.gen(genId);
    const s = this.type(g.type).params.find((p) => p.name === param);
    if (!s || !['range', 'note', 'choice'].includes(s.kind))
      fail(`${g.type} has no mappable setting "${param}" (numbers, notes and menus)`);
    if (!['linear', 'exp', 'steps', 'threshold'].includes(curve)) fail(`curve is linear, exp, steps or threshold, not "${curve}"`);
    const unit = (v) => {
      if (v === undefined) return undefined;
      if (s.kind === 'note') return parseNote(v);
      if (s.kind === 'choice' && !/^\d+$/.test(String(v))) {
        const i = s.args.findIndex((o) => String(o).toLowerCase() === String(v).toLowerCase());
        return i >= 0 ? i : fail(`${param} is one of ${s.args.join(', ')}, not "${v}"`);
      }
      return Number.isFinite(+v) ? +v : fail(`"${v}" isn't a number`);
    };
    const args = [id, g.id, param];
    if (from !== undefined) args.push(unit(from), unit(to ?? from), curve, ...(amount !== undefined ? [+amount] : []));
    await this.request(
      addr,
      args,
      echo,
      (gid, ...flat) => gid === id && flat.some((x, i) => i % 6 === 0 && x === g.id && flat[i + 1] === param),
    );
    return driver.kind === 'global' ? this.model.globals.get(id) : this.state().generators.find((x) => x.id === id);
  }

  // A global follows a knob or fader (MIDI channel 1–16, cc 0–127); 'none' forgets it.
  async knob(globalRef, channel, cc) {
    const id = this.global(globalRef) || fail('which global?');
    const none = channel === undefined || channel === 'none';
    if (!none && !(+channel >= 1 && +channel <= 16 && +cc >= 0 && +cc <= 127)) fail('a knob is a channel 1–16 and a cc 0–127, or none');
    await this.request('/global/knob', [id, none ? 0 : +channel, none ? 0 : +cc], '/global', (gid) => gid === id);
    return this.model.globals.get(id);
  }

  async unmap(globalRef, genId, param) {
    const id = this.global(globalRef) || fail('which global?');
    await this.request('/global/unmap', [id, +genId, param], '/global/mappings', (gid) => gid === id);
    return this.model.globals.get(id);
  }

  // Pin a member's setting to the group's header (range, choice and note settings).
  async pin(groupRef, genId, param, on = true) {
    const id = this.group(groupRef) || fail('which group?'),
      g = this.gen(genId);
    if (g.group !== id) fail(`generator ${g.id} isn't in that group (put it there first: set ${g.id} group=...)`);
    const s = this.param(g.type, param);
    if (on && !(s && ['range', 'choice', 'note'].includes(s.kind)))
      fail(`${g.type} has no pinnable setting "${param}" (numbers, menus and notes)`);
    const want = (gid, ...flat) => gid === id && flat.some((x, i) => i % 2 === 0 && x === g.id && flat[i + 1] === param) === on;
    await this.request(on ? '/group/pin' : '/group/unpin', [id, g.id, param], '/group/pins', want);
    return this.model.groups.get(id);
  }

  async removeGroup(v) {
    const id = this.group(v) || fail('which group?');
    await this.request('/group/remove', [id], '/group/removed', (gid) => gid === id);
  }

  // --- the type library (built-in and AdHoc types; favorites are the add bar) ---
  library() {
    return [...this.model.library.values()];
  }

  libEntry(name) {
    return this.model.library.get(name) ?? fail(`no type "${name}" in the library (${[...this.model.library.keys()].join(', ')})`);
  }

  source(name) {
    return fs.readFileSync(typePath(name, this.libEntry(name).builtin), 'utf8');
  }

  // Loads (or reloads) a type from the library: resolves when it's in, rejects with the brain's error.
  async loadType(name) {
    await this.request('/adhoc/load', [String(name)], '/adhoc/loaded', (n) => n === String(name), 3000);
    return this.model.library.get(name);
  }

  // An AdHoc type's file moves to adhoc/old/; refused (with the reason) for built-ins and types in use.
  async deleteType(name) {
    this.libEntry(name);
    await this.request('/adhoc/delete', [String(name)], '/adhoc/deleted', (n) => n === String(name), 3000);
  }

  async favorite(name, on) {
    this.libEntry(name);
    await this.request('/favorite', [String(name), on ? 1 : 0], '/state/end', () => true, 3000);
    return this.model.library.get(name);
  }

  // Parses a type file with sclang (no evaluation) and returns its syntax error, or null if it parses.
  // The brain only says "syntax error"; sclang's message (with the line) goes to its own log.
  check(nameOrFile) {
    const file = fs.existsSync(nameOrFile) ? path.resolve(nameOrFile) : typePath(nameOrFile, this.model.library.get(nameOrFile)?.builtin);
    if (!fs.existsSync(file)) fail(`no file ${file}`);
    const script = path.join(os.tmpdir(), `perturbed-check-${process.pid}.scd`);
    fs.writeFileSync(script, `("CHECK:" ++ File.readAllString(${JSON.stringify(file)}).compile.notNil).postln;\n0.exit;\n`);
    const out =
      spawnSync('/Applications/SuperCollider.app/Contents/MacOS/sclang', [script], { encoding: 'utf8', timeout: 30000 }).stdout ?? '';
    fs.unlinkSync(script);
    if (/CHECK:true/.test(out)) return null;
    const err = out.slice(out.indexOf('ERROR:'));
    return err.startsWith('ERROR:')
      ? err
          .split('\n')
          .filter((l) => !/CHECK:|cleaning up|^\s*$/.test(l))
          .slice(0, 8)
          .join('\n')
      : "it doesn't parse";
  }

  // --- clocks ---
  async addClock(settings = {}) {
    const id = await this.create('/clock/add', [], '/clock', this.model.clocks);
    return Object.keys(settings).length ? this.setClock(id, settings) : this.model.clocks.get(id);
  }

  async setClock(v, settings) {
    const id = this.clock(v) || fail('clock A is the main clock: change it with tempo');
    const allowed = { mode: ['ratio', 'factor', 'free'], num: [1, 32], den: [1, 32], factor: [0.01, 16], bpm: [1, 999] };
    for (const [k, val] of Object.entries(settings)) {
      const a = allowed[k] ?? fail(`clocks have mode, num, den, factor, bpm, not "${k}"`);
      if (k === 'mode') {
        if (!a.includes(val)) fail(`mode is ratio, factor or free, not "${val}"`);
      } else if (!(+val >= a[0] && +val <= a[1])) fail(`${k} is ${a[0]} to ${a[1]}`);
      await this.request('/clock/set', [id, k, k === 'mode' ? val : +val], '/clock', (cid) => cid === id);
    }
    return this.model.clocks.get(id);
  }

  async removeClock(v) {
    const id = this.clock(v) || fail("clock A is the main clock and can't be removed");
    await this.request('/clock/remove', [id], '/clock/removed', (cid) => cid === id);
  }

  // --- transport, chord, control ---
  async tempo(bpm) {
    if (!(+bpm >= 20 && +bpm <= 400)) fail('tempo is 20 to 400 bpm');
    await this.request('/transport/tempo', [+bpm], '/transport');
    return this.model.tempo;
  }
  async scale(num, den) {
    await this.request('/transport/scale', [+num, +den], '/transport');
    return this.model.tempo;
  }
  async play(on) {
    await this.request('/transport/play', [on ? 1 : 0], '/transport', (p) => !!p === on);
  }
  async chord(notes) {
    const pitches = notes.map(parseNote);
    await this.request('/chord/set', pitches, '/chord');
    return this.state().chord;
  }
  async chordClear() {
    await this.request('/chord/clear', [], '/chord');
  }
  async chordMode(mode) {
    if (!['auto', 'arm'].includes(mode)) fail('chord mode is auto or arm');
    await this.request('/chord/mode', [mode], '/chord');
  }
  cc(bus, channel, cc, value) {
    for (const [n, v, lo, hi] of [
      ['bus', bus, 1, 8],
      ['channel', channel, 1, 16],
      ['cc', cc, 0, 127],
      ['value', value, 0, 127],
    ]) {
      if (!(Number.isInteger(+v) && +v >= lo && +v <= hi)) fail(`${n} is ${lo} to ${hi}`);
    }
    this.send('/cc', +bus, +channel, +cc, +value);
  }

  // --- files: paths are made absolute (the brain runs elsewhere) ---
  // --- MIDI inputs (keyboards, controllers): which ones the brain listens to ---
  inputs() {
    return this.model.inputs ?? [];
  }

  async rescanInputs() {
    await this.request('/inputs/rescan', [], '/inputs');
    return this.inputs();
  }

  // all: its keys play (chord, passthrough); control: a control surface (switch keys and knobs only)
  async setInputRole(name, role) {
    const i = this.inputs().find((x) => x.name.toLowerCase() === String(name).toLowerCase()) ?? fail(`no MIDI input "${name}"`);
    if (!['all', 'control'].includes(role)) fail('a role is all or control');
    await this.request('/inputs/role', [i.name, role], '/inputs');
    return this.inputs();
  }

  // The MIDI note that switches a generator or a group on and off (the chord ignores it); 'none' forgets it.
  async switchKey(kind, ref, note) {
    if (!['gen', 'group'].includes(kind)) fail('usage: key gen|group <id|name> <note|none>');
    const id = kind === 'group' ? this.group(ref) || fail('which group?') : this.gen(ref).id;
    const n = note === undefined || note === 'none' ? -1 : parseNote(note);
    await this.request('/key/set', [kind, id, n], kind === 'group' ? '/group' : '/gen', (x) => x === id);
    return kind === 'group' ? this.model.groups.get(id) : this.state().generators.find((x) => x.id === id);
  }

  async setInput(name, on) {
    const i =
      this.inputs().find((x) => x.name.toLowerCase() === String(name).toLowerCase()) ??
      fail(
        `no MIDI input "${name}" (inputs: ${
          this.inputs()
            .map((x) => x.name)
            .join(', ') || 'none: try inputs rescan'
        })`,
      );
    await this.request('/inputs/set', [i.name, on ? 1 : 0], '/inputs');
    return this.inputs();
  }

  // A new, empty performance (everything goes: save first).
  async newPerformance() {
    await this.request('/new', [], '/state/end', () => true, 3000);
  }

  // Without a file: to the performance's own file (fails if it has none yet).
  async save(file) {
    const args = file ? [path.resolve(file)] : [];
    return (await this.request('/save', args, '/saved'))[0];
  }
  async load(file) {
    const p = path.resolve(file);
    await this.request('/load', [p], '/state/end', () => true, 3000);
    return p;
  }
}

module.exports = { Brain, PerturbedError, parseNote, noteName };
