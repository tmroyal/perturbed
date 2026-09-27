// Surface renderer. The brain is authoritative: controls send intents over OSC, and the UI is
// built and updated only from what the brain reports (see brain/core/osc.scd for the protocol).
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

// --- mirror of the brain's state ---
const model = {
  playing: false, bpm: 120, ports: [],
  types: new Map(),  // name -> [{ name, kind, def, args }]
  chord: { mode: 'auto', armed: false, pitches: [] },
  dests: new Map(),  // id -> { id, name, port, channel, instrument }
  gens: new Map(),   // id -> { id, type, dest, active, params, card }
};
let inSnapshot = false;

// --- connection: /hello until a snapshot arrives, /ping to notice a restarted or missing brain ---
let connected = false, bootId = null, lastPong = 0;

function setConnected(on) {
  connected = on;
  document.body.classList.toggle('offline', !on);
  $('status').textContent = on ? '' : 'waiting for brain…';
  if (!on) showBeat(-1);
}

setInterval(() => {
  if (!connected) osc.send('/hello');
  else if (Date.now() - lastPong > 3000) setConnected(false);
  osc.send('/ping');
}, 1000);

// --- transport ---
$('play').onclick = () => osc.send('/transport/play', model.playing ? 0 : 1);
document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'SELECT'].includes(e.target.tagName) && e.target.type !== 'range';
  if (e.code === 'Space' && !typing) { e.preventDefault(); $('play').blur(); osc.send('/transport/play', model.playing ? 0 : 1); }
});

function renderTransport() {
  $('play').classList.toggle('on', model.playing);
  $('play').textContent = model.playing ? 'Stop' : 'Play';
  if (!model.playing) showBeat(-1);
  if (!dialDragging) showTempo(model.bpm);
}

function showBeat(b) {
  [...$('beats').children].forEach((d, i) => d.classList.toggle('lit', b >= 0 && b % 4 === i));
}

// --- save / load: the brain writes and reads the file ---
$('save').onclick = async () => { const p = await files.pick('save'); if (p) osc.send('/save', p); };
$('load').onclick = async () => { const p = await files.pick('load'); if (p) osc.send('/load', p); };

// --- tempo dial: drag vertically (shift = fine), scroll, or double-click to type ---
const BPM_MIN = 20, BPM_MAX = 400, SWEEP = 270;
const polar = (deg) => {
  const r = (deg - 90) * Math.PI / 180;
  return [24 + 18 * Math.cos(r), 24 + 18 * Math.sin(r)];
};
const arc = (from, to) => {
  const [x1, y1] = polar(from), [x2, y2] = polar(to);
  return `M${x1} ${y1} A18 18 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
};
$('dial-track').setAttribute('d', arc(-SWEEP / 2, SWEEP / 2));

const clampBpm = (bpm) => Math.round(Math.min(BPM_MAX, Math.max(BPM_MIN, bpm)) * 10) / 10;
let dialDragging = false, localBpm = 120;

function showTempo(bpm) {
  localBpm = bpm;
  if (document.activeElement !== $('bpm')) $('bpm').value = bpm;
  const angle = -SWEEP / 2 + SWEEP * (bpm - BPM_MIN) / (BPM_MAX - BPM_MIN);
  $('dial-value').setAttribute('d', arc(-SWEEP / 2, Math.max(angle, -SWEEP / 2 + 0.01)));
  const [px, py] = polar(angle), [cx, cy] = [24 + (px - 24) * 0.45, 24 + (py - 24) * 0.45];
  Object.entries({ x1: cx, y1: cy, x2: px, y2: py }).forEach(([k, v]) => $('dial-pointer').setAttribute(k, v));
}

function sendTempo(bpm) {
  bpm = clampBpm(bpm);
  showTempo(bpm);
  osc.send('/transport/tempo', bpm);
}

const dial = $('dial');
dial.addEventListener('pointerdown', (e) => {
  dial.setPointerCapture(e.pointerId);
  dialDragging = true;
  let lastY = e.clientY;
  const move = (m) => {
    sendTempo(localBpm + (lastY - m.clientY) * (m.shiftKey ? 0.1 : 1));
    lastY = m.clientY;
  };
  dial.addEventListener('pointermove', move);
  dial.addEventListener('pointerup', () => {
    dial.removeEventListener('pointermove', move);
    dialDragging = false;
  }, { once: true });
});
dial.addEventListener('wheel', (e) => { e.preventDefault(); sendTempo(localBpm - Math.sign(e.deltaY)); });
dial.addEventListener('dblclick', () => $('bpm').select());
$('bpm').addEventListener('change', () => sendTempo(parseFloat($('bpm').value) || model.bpm));
$('bpm').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bpm').blur(); });

// --- generator controls, built from the type's schema ---
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const OCTAVES = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];  // MIDI 60 = C4
const noteName = (p) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const typeLabel = (name) => name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const editing = (input) => document.activeElement === input || input.dataset.dragging;

function selectInput(options, onChange) {
  const sel = el('select');
  options.forEach(([label, value]) => sel.add(new Option(label, value)));
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function numberInput(min, max, onChange) {
  const input = el('input', { type: 'number', min, max, step: 1 });
  input.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, parseInt(input.value) || min));
    input.value = v;
    onChange(v);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return input;
}

function slider(min, max, onChange) {
  const input = el('input', { type: 'range', min, max, step: 1 });
  const out = el('span', { className: 'hint value' });
  input.addEventListener('pointerdown', () => { input.dataset.dragging = '1'; });
  input.addEventListener('pointerup', () => { delete input.dataset.dragging; });
  input.addEventListener('input', () => { out.textContent = input.value; onChange(parseInt(input.value)); });
  return { input, out };
}

// Returns { label, control, update(value) } for one param, or for num/den combined.
function paramControl(spec, send) {
  const [min, max] = spec.args;
  if (spec.kind === 'note') {
    // pitch class + octave -> MIDI note (capped at G9 = 127)
    let pc = 0, oct = 5;
    const setNote = () => send(Math.min(127, oct * 12 + pc));
    const name = selectInput(NOTE_NAMES.map((n, i) => [n, i]), (v) => { pc = +v; setNote(); });
    const octave = selectInput(OCTAVES.map((o, i) => [o, i]), (v) => { oct = +v; setNote(); });
    return {
      label: 'note', control: el('div', { className: 'row' }, name, octave),
      update: (v) => { pc = v % 12; oct = Math.floor(v / 12); name.value = pc; octave.value = oct; },
    };
  }
  if (spec.kind === 'choice') {
    const sel = selectInput(spec.args.map((o) => [o, o]), send);
    return { label: spec.name, control: sel, update: (v) => { sel.value = v; } };
  }
  if (spec.kind === 'range' && max - min > 32) {
    const { input, out } = slider(min, max, send);
    return {
      label: spec.name, control: el('div', { className: 'row' }, input, out),
      update: (v) => { if (!editing(input)) input.value = v; out.textContent = v; },
    };
  }
  if (spec.kind === 'range') {
    const input = numberInput(min, max, send);
    return { label: spec.name, control: input, update: (v) => { if (!editing(input)) input.value = v; } };
  }
  const input = el('input', { type: 'text' });
  input.addEventListener('change', () => send(input.value));
  return { label: spec.name, control: input, update: (v) => { if (!editing(input)) input.value = v; } };
}

// --- generator cards ---
function buildCard(gen) {
  const set = (param, value) => osc.send('/gen/set', gen.id, param, value);
  const led = el('span', { className: 'led' });
  const active = el('button', { onclick: () => set('active', gen.active ? 0 : 1) });

  const destSel = el('select');
  destSel.addEventListener('change', () => set('dest', parseInt(destSel.value)));
  const refreshDests = () => {
    destSel.replaceChildren(new Option('—', 0),
      ...[...model.dests.values()].map((d) => new Option(d.name, d.id)));
    destSel.value = model.dests.has(gen.dest) ? gen.dest : 0;
  };

  const fields = [el('label', { textContent: 'dest' }), destSel];
  const updaters = {};
  const specs = model.types.get(gen.type) ?? [];
  const byName = Object.fromEntries(specs.map((s) => [s.name, s]));
  for (const spec of specs) {
    if (spec.name === 'den' && byName.num) continue;
    if (spec.name === 'num' && byName.den) {
      // duration as num / den beats, with the result shown
      const beats = el('span', { className: 'hint' });
      const showBeats = () => { beats.textContent = `= ${+(gen.params.num / gen.params.den).toFixed(3)} beat`; };
      const num = paramControl(spec, (v) => set('num', v));
      const den = paramControl(byName.den, (v) => set('den', v));
      updaters.num = (v) => { num.update(v); showBeats(); };
      updaters.den = (v) => { den.update(v); showBeats(); };
      fields.push(el('label', { textContent: 'duration' }), el('div', { className: 'row' }, num.control, '/', den.control, beats));
      continue;
    }
    const c = paramControl(spec, (v) => set(spec.name, v));
    updaters[spec.name] = c.update;
    fields.push(el('label', { textContent: c.label }), c.control);
  }

  const root = el('section', { className: 'card gen' },
    el('header', {},
      el('h2', { textContent: `${typeLabel(gen.type)} ${gen.id}` }), led,
      el('button', { className: 'close', textContent: '×', title: 'Remove', onclick: () => osc.send('/gen/remove', gen.id) })),
    el('div', { className: 'buttons' }, active),
    el('div', { className: 'fields' }, ...fields));

  return {
    root,
    refreshDests,
    render() {
      active.classList.toggle('on', gen.active);
      active.textContent = gen.active ? 'Active' : 'Inactive';
      root.classList.toggle('active', gen.active);
      refreshDests();
    },
    param: (name, value) => updaters[name]?.(value),
    flash: () => led.animate([{ background: '#EBCB8B' }, { background: '#434C5E' }], { duration: 150 }),
  };
}

function renderGens() {
  $('grid').replaceChildren();
  for (const gen of model.gens.values()) {
    gen.card = buildCard(gen);
    gen.card.render();
    for (const [k, v] of Object.entries(gen.params)) gen.card.param(k, v);
    $('grid').append(gen.card.root);
  }
}

function renderTypes() {
  $('add-gen').replaceChildren(...[...model.types.keys()].map((type) =>
    el('button', { textContent: `+ ${typeLabel(type)}`, onclick: () => osc.send('/gen/add', type) })));
}

// --- chord ---
function renderChord() {
  [...$('chord-mode').children].forEach((b) => b.classList.toggle('on', b.dataset.mode === model.chord.mode));
  $('chord-arm').hidden = model.chord.mode !== 'arm';
  $('chord-arm').classList.toggle('on', model.chord.armed);
  $('chord-arm').textContent = model.chord.armed ? 'Play a chord…' : 'Arm';
  $('chord-notes').textContent = model.chord.pitches.map(noteName).join(' ');
}
$('chord-arm').onclick = () => osc.send('/chord/arm', model.chord.armed ? 0 : 1);
[...$('chord-mode').children].forEach((b) => { b.onclick = () => osc.send('/chord/mode', b.dataset.mode); });
$('chord-clear').onclick = () => osc.send('/chord/clear');

// --- destinations ---
function renderDests() {
  $('dests').replaceChildren(...[...model.dests.values()].map((d) => el('div', { className: 'dest' },
    el('span', { className: 'name', textContent: d.name }),
    el('span', { className: 'route', textContent: `port ${d.port} · ch ${d.channel} · ${d.instrument}`, title: model.ports[d.port - 1] ?? '' }),
    el('button', { className: 'close', textContent: '×', title: 'Remove', onclick: () => osc.send('/dest/remove', d.id) }))));
  model.gens.forEach((g) => g.card?.refreshDests());
}

function renderPorts() {
  const port = $('dest-port');
  port.replaceChildren(...model.ports.map((name, i) => new Option(`port ${i + 1}`, i + 1)));
  model.ports.forEach((name, i) => { port.options[i].title = name; });
}
$('dest-channel').append(...Array.from({ length: 16 }, (_, i) => new Option(`ch ${i + 1}`, i + 1)));

$('dest-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('dest-name').value.trim() || `Dest ${model.dests.size + 1}`;
  osc.send('/dest/add', name, parseInt($('dest-port').value), parseInt($('dest-channel').value), $('dest-inst').value.trim());
  $('dest-name').value = '';
});

function renderAll() {
  renderTransport();
  renderTypes();
  renderPorts();
  renderChord();
  renderDests();
  renderGens();
}

// --- brain messages ---
const handlers = {
  '/pong': (id) => {
    lastPong = Date.now();
    if (bootId !== null && id !== bootId) setConnected(false);  // brain restarted: re-/hello
    bootId = id;
  },
  '/state/begin': () => {
    inSnapshot = true;
    model.types.clear(); model.dests.clear(); model.gens.clear();
  },
  '/state/end': () => {
    inSnapshot = false;
    lastPong = Date.now();
    setConnected(true);
    renderAll();
  },
  '/transport': (playing, bpm) => {
    model.playing = !!playing;
    model.bpm = bpm;
    if (!inSnapshot) renderTransport();
  },
  '/ports': (...names) => { model.ports = names; if (!inSnapshot) renderPorts(); },
  '/chord': (mode, armed, ...pitches) => {
    model.chord = { mode, armed: !!armed, pitches };
    if (!inSnapshot) renderChord();
  },
  '/gen/schema': (type, name, kind, def, ...args) => {
    if (!model.types.has(type)) model.types.set(type, []);
    model.types.get(type).push({ name, kind, def, args });
  },
  '/dest': (id, name, port, channel, instrument) => {
    model.dests.set(id, { id, name, port, channel, instrument });
    if (!inSnapshot) renderDests();
  },
  '/dest/removed': (id) => { model.dests.delete(id); renderDests(); },
  '/gen': (id, type, dest, active) => {
    let gen = model.gens.get(id);
    if (!gen) {
      gen = { id, type, params: {}, card: null };
      model.gens.set(id, gen);
    }
    Object.assign(gen, { dest, active: !!active });
    if (inSnapshot) return;
    if (!gen.card) { gen.card = buildCard(gen); $('grid').append(gen.card.root); }
    gen.card.render();
  },
  '/gen/param': (id, name, value) => {
    const gen = model.gens.get(id);
    if (!gen) return;
    gen.params[name] = value;
    if (!inSnapshot) gen.card?.param(name, value);
  },
  '/gen/removed': (id) => { model.gens.get(id)?.card?.root.remove(); model.gens.delete(id); },
  '/beat': (b) => { if (model.playing) showBeat(b); },
  '/note': (id) => model.gens.get(id)?.card?.flash(),
};
osc.on(({ addr, args }) => handlers[addr]?.(...args));

setConnected(false);
showTempo(model.bpm);
osc.send('/hello');
