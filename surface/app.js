// app.js — the surface's mirror of the brain's state, the connection, and every message the brain
// sends. The brain is authoritative: controls send intents over OSC, and the UI is built and
// updated only from what the brain reports (protocol: brain/core/osc.scd).
const model = {
  playing: false, bpm: 120, ports: [],
  types: new Map(),  // name -> [{ name, kind, def, args, label?, section?, show?: { param, values } }]
  chord: { mode: 'auto', armed: false, pitches: [] },
  clocks: new Map(), // id -> { id, name, mode, num, den, factor, bpm, tempo }  (A = main, implicit)
  dests: new Map(),  // id -> { id, name, port, channel, instrument }
  live: null,        // Live's tracks on the brain's buses [{ name, port, channel, instrument }]; null = no bridge
  gens: new Map(),   // id -> { id, type, dest, active, group, params, card }
  groups: new Map(), // id -> { id, name, on, solo, collapsed, pins: [[genId, param], ...] }
  library: new Map(), // type name -> { name, builtin, favorite, loaded, bar, changed, description, mtime }
};
let inSnapshot = false;

// --- connection: /hello until a snapshot arrives, /ping to notice a restarted or missing brain ---
let connected = false, bootId = null, lastPong = 0;

// Errors from the brain (a type that didn't load or stopped) show in the transport bar for a while.
let errorTimer = null;
function showError(message) {
  $('status').textContent = message;
  $('status').title = message;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { if (connected) $('status').textContent = ''; }, 8000);
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
  renderTypes();
  renderLibrary();
  renderPorts();
  renderChord();
  renderClocks();
  renderOutputs();
  renderGens();
}

// --- brain messages; during a snapshot the model is filled and rendered once at /state/end ---
const specOf = (type, name) => model.types.get(type)?.find((s) => s.name === name);
const live = (render) => { if (!inSnapshot) render(); };

const handlers = {
  '/pong': (id) => {
    lastPong = Date.now();
    if (bootId !== null && id !== bootId) setConnected(false);  // brain restarted: re-/hello
    bootId = id;
  },
  '/state/begin': () => {
    inSnapshot = true;
    model.types.clear(); model.clocks.clear(); model.dests.clear(); model.gens.clear(); model.groups.clear(); model.library.clear();
    model.live = null;
  },
  '/state/end': () => {
    inSnapshot = false;
    lastPong = Date.now();
    setConnected(true);
    renderAll();
  },
  '/transport': (playing, bpm) => {
    Object.assign(model, { playing: !!playing, bpm });
    live(() => { renderTransport(); $('clocks').firstChild?.replaceWith(mainClockRow()); });
  },
  '/ports': (...names) => { model.ports = names; live(renderPorts); },
  '/chord': (mode, armed, ...pitches) => { model.chord = { mode, armed: !!armed, pitches }; live(renderChord); },

  '/library/type': (name, builtin, favorite, loaded, bar, changed, description, mtime) => {
    model.library.set(name, { name, builtin: !!builtin, favorite: !!favorite, loaded: !!loaded, bar: !!bar, changed: !!changed, description, mtime });
  },
  '/adhoc/loaded': (name) => { if (pendingAdd === name) { pendingAdd = null; osc.send('/gen/add', name); } },
  '/error': (message) => showError(message),
  '/gen/schema': (type, name, kind, def, ...args) => {
    if (!model.types.has(type)) model.types.set(type, []);
    model.types.get(type).push({ name, kind, def, args });
  },
  '/gen/label': (type, name, label) => { const s = specOf(type, name); if (s) s.label = label; },
  '/gen/section': (type, name, title) => { const s = specOf(type, name); if (s) s.section = title; },
  '/gen/action': (type, name) => { const specs = model.types.get(type); if (specs) (specs.actions ??= []).push(name); },
  '/gen/slider': (type, name, scale) => { const s = specOf(type, name); if (s) s.slider = scale; },
  '/gen/nooutput': (type) => { const specs = model.types.get(type); if (specs) specs.noOutput = true; },
  '/gen/show': (type, name, param, ...values) => {
    const s = specOf(type, name);
    if (s) s.show = { param, values: values.map(String) };
  },

  '/clock': (id, name, mode, num, den, factor, bpm, tempo) => {
    const c = { id, name, mode, num, den, factor, bpm, tempo };
    model.clocks.set(id, c);
    live(() => updateClock(c));
  },
  '/clock/removed': (id) => { model.clocks.delete(id); renderClocks(); },

  '/dest': (id, name, port, channel, instrument) => {
    model.dests.set(id, { id, name, port, channel, instrument });
    live(renderOutputs);
  },
  '/dest/removed': (id) => { model.dests.delete(id); renderOutputs(); },
  '/live/tracks': (...a) => {
    model.live = [];
    for (let i = 0; i + 3 < a.length; i += 4) model.live.push({ name: a[i], port: a[i + 1], channel: a[i + 2], instrument: a[i + 3] });
    live(renderOutputs);
  },
  '/live/tracks/clear': () => { model.live = null; live(renderOutputs); },

  '/gen': (id, type, dest, active, group = 0) => {
    let gen = model.gens.get(id);
    if (!gen) model.gens.set(id, gen = { id, type, params: {}, card: null });
    const moved = gen.group !== group;
    Object.assign(gen, { dest, active: !!active, group });
    live(() => { if (!gen.card) mountCard(gen); else { gen.card.render(); if (moved) placeCard(gen); } renderGroupSummaries(); });
  },
  '/group': (id, name, on, solo, collapsed) => {
    const known = model.groups.get(id);
    const g = { id, name, on: !!on, solo: !!solo, collapsed: !!collapsed, pins: known?.pins ?? [] };
    model.groups.set(id, g);
    live(() => (known ? updateGroup(g) : renderGroups()));
  },
  '/group/pins': (id, ...flat) => {
    const g = model.groups.get(id);
    if (!g) return;
    g.pins = [];
    for (let i = 0; i + 1 < flat.length; i += 2) g.pins.push([flat[i], flat[i + 1]]);
    live(renderGroups);
  },
  '/group/removed': (id) => { model.groups.delete(id); renderGroups(); },
  '/gen/param': (id, name, value) => {
    const gen = model.gens.get(id);
    if (!gen) return;
    gen.params[name] = value;
    live(() => { gen.card?.param(name, value); pinUpdaters.get(`${id}:${name}`)?.(value); });
  },
  '/gen/learn': (id, name, on) => model.gens.get(id)?.card?.learning(name, !!on),
  '/gen/removed': (id) => { model.gens.get(id)?.card?.root.remove(); model.gens.delete(id); renderGroupSummaries(); },

  '/beat': (b) => { if (model.playing) showBeat(b); },
  '/note': (id) => { model.gens.get(id)?.card?.flash(); flashSummary(id); },
};
osc.on(({ addr, args }) => handlers[addr]?.(...args));

setConnected(false);
tempoDial.set(model.bpm);
osc.send('/hello');
