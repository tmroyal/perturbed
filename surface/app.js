// app.js — the surface's mirror of the brain's state, the connection, and every message the brain
// sends. The brain is authoritative: controls send intents over OSC, and the UI is built and
// updated only from what the brain reports (protocol: brain/core/osc.scd).
const model = {
  playing: false,
  bpm: 120,
  ports: [],
  types: new Map(), // name -> [{ name, kind, def, args, label?, section?, show?: { param, values } }]
  chord: { mode: 'auto', armed: false, pitches: [] },
  clocks: new Map(), // id -> { id, name, mode, num, den, factor, bpm, tempo }  (A = main, implicit)
  dests: new Map(), // id -> { id, name, port, channel, instrument }
  live: null, // Live's tracks on the brain's buses [{ name, port, channel, instrument }]; null = no bridge
  gens: new Map(), // id -> { id, type, dest, active, group, params, card }
  groups: new Map(), // id -> { id, name, on, solo, collapsed, pins: [[genId, param], ...] }
  globals: new Map(), // id -> { id, name, value, knob: { channel, cc } | null, mappings: [{ gen, param, from, to, curve, amount }] }
  knobLearning: null, // the global waiting for a knob to be turned
  library: new Map(), // type name -> { name, builtin, favorite, loaded, bar, changed, description, mtime }
};
let inSnapshot = false;

// --- connection: /hello until a snapshot arrives, /ping to notice a restarted or missing brain ---
let connected = false,
  bootId = null,
  lastPong = 0;

// Errors from the brain (a type that didn't load or stopped) show in the transport bar for a while.
let errorTimer = null;
function showError(message) {
  $('status').textContent = message;
  $('status').title = message;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => {
    if (connected) $('status').textContent = '';
  }, 8000);
}

function setConnected(on) {
  connected = on;
  document.body.classList.toggle('offline', !on);
  $('status').textContent = on ? '' : 'waiting for the brain…';
  if (!on) showBeat(-1);
}

setInterval(() => {
  if (!connected) osc.send('/hello');
  else if (Date.now() - lastPong > 3000) setConnected(false);
  osc.send('/ping');
}, 1000);

function renderAll() {
  renderTransport();
  renderFile();
  renderLibrary();
  renderPorts();
  renderInputs();
  renderChord();
  renderClocks();
  renderGlobals();
  renderOutputs();
  renderGens();
}

// --- brain messages: each handler updates the model and returns what to re-render, which runs at
// once, or not during a snapshot (everything renders at /state/end). Momentary events (beats,
// notes, learning, errors) show directly. ---
const specOf = (type, name) => model.types.get(type)?.find((s) => s.name === name);
const setSpec = (key) => (type, name, value) => {
  const s = specOf(type, name);
  if (s) s[key] = value;
};
const chunks = (a, n) => Array.from({ length: Math.floor(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const handlers = {
  '/pong': (id) => {
    lastPong = Date.now();
    if (bootId !== null && id !== bootId) setConnected(false); // brain restarted: re-/hello
    bootId = id;
  },
  '/state/begin': () => {
    inSnapshot = true;
    Object.values(model).forEach((v) => {
      if (v instanceof Map) v.clear();
    });
    model.live = null;
  },
  '/state/end': () => {
    inSnapshot = false;
    lastPong = Date.now();
    setConnected(true);
    return renderAll;
  },
  '/transport': (playing, bpm) => {
    Object.assign(model, { playing: !!playing, bpm });
    return () => {
      renderTransport();
      renderMainClock();
    };
  },
  '/ports': (...names) => {
    model.ports = names;
    return renderPorts;
  },
  '/inputs': (...a) => {
    model.inputs = chunks(a, 3).map(([name, on, role]) => ({ name, on: !!on, role }));
    return renderInputs;
  },
  '/chord': (mode, armed, ...pitches) => {
    model.chord = { mode, armed: !!armed, pitches };
    return renderChord;
  },

  '/library/type': (name, builtin, favorite, loaded, bar, changed, description, mtime) => {
    model.library.set(name, {
      name,
      builtin: !!builtin,
      favorite: !!favorite,
      loaded: !!loaded,
      bar: !!bar,
      changed: !!changed,
      description,
      mtime,
    });
  },
  '/adhoc/loaded': (name) => {
    typeLoaded(name);
  },
  '/dirty': (on) => {
    model.unsaved = !!on;
    return renderFile;
  },
  '/file': (file) => {
    model.file = file;
    return renderFile;
  },
  '/error': (message) => {
    showError(message);
  },
  '/gen/schema': (type, name, kind, def, ...args) => {
    if (!model.types.has(type)) model.types.set(type, []);
    model.types.get(type).push({ name, kind, def, args });
  },
  '/gen/label': setSpec('label'),
  '/gen/section': setSpec('section'),
  '/gen/slider': setSpec('slider'),
  '/gen/action': (type, name) => {
    const specs = model.types.get(type);
    if (specs) specs.actions = [...(specs.actions ?? []), name];
  },
  '/gen/maps': (type) => {
    const specs = model.types.get(type);
    if (specs) specs.maps = true;
  },
  '/gen/targets': (id, ...flat) => {
    const gen = model.gens.get(id);
    if (!gen) return;
    gen.mappings = chunks(flat, 6).map(([g, param, from, to, curve, amount]) => ({
      gen: g,
      param,
      from,
      to,
      curve,
      amount: amount < 0 ? null : amount,
    }));
    return renderCards;
  },
  '/gen/nooutput': (type) => {
    const specs = model.types.get(type);
    if (specs) specs.noOutput = true;
  },
  '/gen/show': (type, name, param, ...values) => setSpec('show')(type, name, { param, values: values.map(String) }),

  '/clock': (id, name, mode, num, den, factor, bpm, tempo) => {
    const c = { id, name, mode, num, den, factor, bpm, tempo };
    model.clocks.set(id, c);
    return () => updateClock(c);
  },
  '/clock/removed': (id) => {
    model.clocks.delete(id);
    return renderClocks;
  },

  '/dest': (id, name, port, channel, instrument) => {
    model.dests.set(id, { id, name, port, channel, instrument });
    return renderOutputs;
  },
  '/dest/removed': (id) => {
    model.dests.delete(id);
    return renderOutputs;
  },
  '/live/tracks': (...a) => {
    model.live = chunks(a, 4).map(([name, port, channel, instrument]) => ({ name, port, channel, instrument }));
    return renderOutputs;
  },
  '/live/tracks/clear': () => {
    model.live = null;
    return renderOutputs;
  },

  '/gen': (id, type, dest, active, group = 0, collapsed = 0, key = -1, order = 0) => {
    let gen = model.gens.get(id);
    if (!gen) {
      gen = { id, type, params: {}, card: null };
      model.gens.set(id, gen);
    }
    const moved = gen.group !== group || gen.order !== order;
    Object.assign(gen, { dest, active: !!active, group, collapsed: !!collapsed, key: key < 0 ? null : key, order });
    return () => updateGen(gen, moved);
  },
  '/group': (id, name, on, solo, collapsed, key = -1) => {
    model.groups.set(id, {
      id,
      name,
      on: !!on,
      solo: !!solo,
      collapsed: !!collapsed,
      key: key < 0 ? null : key,
      pins: model.groups.get(id)?.pins ?? [],
    });
    return renderGroups;
  },
  '/group/pins': (id, ...flat) => {
    const g = model.groups.get(id);
    if (!g) return;
    g.pins = chunks(flat, 2);
    return renderGroups;
  },
  '/global': (id, name, value, channel = 0, cc = 0, response = 'linear', formula = 'x', group = 0) => {
    const known = model.globals.get(id);
    const gl = { id, name, value, knob: channel ? { channel, cc } : null, response, formula, group, mappings: known?.mappings ?? [] };
    model.globals.set(id, gl);
    // a new response, formula or group changes the row's controls or place; a value or name only updates them
    const same = known && known.response === response && known.formula === formula && known.group === group;
    return same ? () => updateGlobal(gl) : renderGlobals;
  },
  '/global/mappings': (id, ...flat) => {
    const gl = model.globals.get(id);
    if (!gl) return;
    gl.mappings = chunks(flat, 6).map(([gen, param, from, to, curve, amount]) => ({
      gen,
      param,
      from,
      to,
      curve,
      amount: amount < 0 ? null : amount,
    }));
    return () => {
      renderGlobals();
      renderCards();
    };
  },
  '/key/learn': (kind, id, on) => {
    model.keyLearning = on ? { kind, id } : null; // a generator or group waiting for its switch key
    return () => {
      renderCards();
      renderGroups();
    };
  },
  '/global/learn': (id, on) => {
    model.knobLearning = on ? id : null;
    return renderGlobals;
  },
  '/global/removed': (id) => {
    model.globals.delete(id);
    if (isMapping('global', id)) toggleMapMode('global', id);
    return () => {
      renderGlobals();
      renderCards();
    };
  },
  '/group/removed': (id) => {
    model.groups.delete(id);
    return renderGroups;
  },
  '/gen/param': (id, name, value) => {
    const gen = model.gens.get(id);
    if (!gen) return;
    gen.params[name] = value;
    return () => {
      gen.card?.param(name, value);
      updatePin(id, name, value);
    };
  },
  '/gen/removed': (id) => {
    const gen = model.gens.get(id);
    model.gens.delete(id);
    return () => {
      unmountCard(gen);
      if (isMapping('gen', id)) toggleMapMode('gen', id); // it was in Map mode: leave it
    };
  },

  '/gen/learn': (id, name, on) => {
    model.gens.get(id)?.card?.learning(name, !!on);
  },
  '/beat': (b) => {
    if (model.playing) showBeat(b);
  },
  '/note': (id) => {
    model.gens.get(id)?.card?.flash();
    flashSummary(id);
  },
};
osc.on(({ addr, args }) => {
  const render = handlers[addr]?.(...args);
  if (render && !inSnapshot) render();
});

setConnected(false);
tempoDial.set(model.bpm);
osc.send('/hello');
