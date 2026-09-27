// Surface renderer. The brain is authoritative: controls send intents over OSC, and the UI is
// built and updated only from what the brain reports (see brain/core/osc.scd for the protocol).
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
// Enter commits a typed value (fires 'change') by leaving the field.
const blurOnEnter = (input) => input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

// --- mirror of the brain's state ---
const model = {
  playing: false, bpm: 120, ports: [],
  types: new Map(),  // name -> [{ name, kind, def, args, show?: { param, values }, section? }]
  chord: { mode: 'auto', armed: false, pitches: [] },
  clocks: new Map(), // id -> { id, name, mode, num, den, factor, bpm, tempo }  (0 = main, implicit)
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
  tempoDial.set(model.bpm);
  renderMod();
}

function showBeat(b) {
  [...$('beats').children].forEach((d, i) => d.classList.toggle('lit', b >= 0 && b % 4 === i));
}

// --- metric modulation: tempo × num/den; swap gives the reciprocal ---
const modFraction = () => [Math.max(1, parseInt($('mod-num').value) || 1), Math.max(1, parseInt($('mod-den').value) || 1)];
function renderMod() {
  const [num, den] = modFraction();
  $('mod-apply').textContent = `→ ${+(model.bpm * num / den).toFixed(1)}`;
}
['mod-num', 'mod-den'].forEach((id) => { $(id).addEventListener('input', renderMod); blurOnEnter($(id)); });
$('mod-swap').onclick = () => {
  [$('mod-num').value, $('mod-den').value] = [$('mod-den').value, $('mod-num').value];
  renderMod();
};
$('mod-apply').onclick = () => osc.send('/transport/scale', ...modFraction());

// --- save / load: the brain writes and reads the file ---
$('save').onclick = async () => { const p = await files.pick('save'); if (p) osc.send('/save', p); };
$('load').onclick = async () => { const p = await files.pick('load'); if (p) osc.send('/load', p); };

// --- main tempo ---
const tempoDial = rotary({ min: 20, max: 400, step: 0.1, size: 48, onChange: (bpm) => osc.send('/transport/tempo', bpm) });
$('tempo').append(tempoDial.root);

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

function numberInput(min, max, onChange, step = 1) {
  const input = el('input', { type: 'number', min, max, step });
  input.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, +(Math.round((parseFloat(input.value) || min) / step) * step).toFixed(4)));
    input.value = v;
    onChange(v);
  });
  blurOnEnter(input);
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

// Rotary dial with a typed field: drag vertically (shift = fine), scroll, or double-click to type.
// log: the dial is logarithmic (for factors). set(v) shows a value unless the user is using the dial.
function rotary({ min, max, step, log = false, size = 32, onChange }) {
  const SWEEP = 270, R = size * 0.375, W = size * 0.09, c = size / 2;
  const norm = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const polar = (deg, r = R) => { const a = (deg - 90) * Math.PI / 180; return [c + r * Math.cos(a), c + r * Math.sin(a)]; };
  const arc = (from, to) => {
    const [x1, y1] = polar(from), [x2, y2] = polar(to);
    return `M${x1} ${y1} A${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  };
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  const stroke = { fill: 'none', 'stroke-width': W, 'stroke-linecap': 'round' };
  const track = svgEl('path', { ...stroke, stroke: '#434C5E', d: arc(-SWEEP / 2, SWEEP / 2) });
  const valueArc = svgEl('path', { ...stroke, stroke: '#88C0D0' });
  const pointer = svgEl('line', { stroke: '#ECEFF4', 'stroke-width': W / 2, 'stroke-linecap': 'round' });
  svg.append(track, valueArc, pointer);

  let value = min, dragging = false;
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const round = (v) => +(Math.round(v / step) * step).toFixed(6);
  const field = numberInput(min, max, (v) => { draw(v); onChange(v); }, step);

  function draw(v) {
    value = v;
    const angle = -SWEEP / 2 + SWEEP * Math.min(1, Math.max(0, norm(v)));
    valueArc.setAttribute('d', arc(-SWEEP / 2, Math.max(angle, -SWEEP / 2 + 0.01)));
    const [px, py] = polar(angle), [cx, cy] = polar(angle, R * 0.45);
    Object.entries({ x1: cx, y1: cy, x2: px, y2: py }).forEach(([k, val]) => pointer.setAttribute(k, val));
    if (!editing(field)) field.value = round(v);
  }
  // move by dy pixels (up = positive); keeps the unrounded value while dragging for smooth fine moves
  const nudge = (dy, fine) => {
    const v = clamp(log ? value * Math.exp(dy * (fine ? 0.0005 : 0.005)) : value + dy * step * (fine ? 1 : 10));
    draw(v);
    onChange(round(v));
  };

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    dragging = true;
    let lastY = e.clientY;
    const move = (m) => { nudge(lastY - m.clientY, m.shiftKey); lastY = m.clientY; };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', () => { svg.removeEventListener('pointermove', move); dragging = false; }, { once: true });
  });
  svg.addEventListener('wheel', (e) => { e.preventDefault(); nudge(-Math.sign(e.deltaY) * (log ? 4 : 1), e.shiftKey); });
  svg.addEventListener('dblclick', () => field.select());

  return { root: el('div', { className: 'rotary' }, svg, field), set: (v) => { if (!dragging) draw(v); } };
}

// One param's control: { label, control, update(value), learning?(on) }.
// learn(on) asks the brain to set the param from the next key played (note params only).
function paramControl(spec, send, learn) {
  const [min, max, step = 1] = spec.args;
  if (spec.kind === 'note') {
    // pitch class + octave -> MIDI note (capped at G9 = 127)
    let pc = 0, oct = 5;
    const setNote = () => send(Math.min(127, oct * 12 + pc));
    const name = selectInput(NOTE_NAMES.map((n, i) => [n, i]), (v) => { pc = +v; setNote(); });
    const octave = selectInput(OCTAVES.map((o, i) => [o, i]), (v) => { oct = +v; setNote(); });
    let learning = false;
    const setBtn = el('button', { className: 'learn', textContent: 'Set', title: 'Set from the next key played',
      onclick: () => learn(!learning) });
    return {
      label: spec.name, control: el('div', { className: 'row' }, name, octave, setBtn),
      update: (v) => { pc = v % 12; oct = Math.floor(v / 12); name.value = pc; octave.value = oct; },
      learning: (on) => { learning = on; setBtn.classList.toggle('on', on); setBtn.textContent = on ? 'Play…' : 'Set'; },
    };
  }
  if (spec.kind === 'clock') {
    const sel = el('select');
    sel.addEventListener('change', () => send(parseInt(sel.value)));
    let value = 0;
    const refresh = () => {
      sel.replaceChildren(new Option('main', 0), ...[...model.clocks.values()].map((c) => new Option(c.name, c.id)));
      sel.value = model.clocks.has(value) ? value : 0;
    };
    refresh();
    return { label: spec.name, control: sel, update: (v) => { value = v; refresh(); }, refresh };
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
    const input = numberInput(min, max, send, step);
    return { label: spec.name, control: input, update: (v) => { if (!editing(input)) input.value = v; } };
  }
  const input = el('input', { type: 'text' });
  input.addEventListener('change', () => send(input.value));
  blurOnEnter(input);
  return { label: spec.name, control: input, update: (v) => { if (!editing(input)) input.value = v; } };
}

// --- generator cards ---
function buildCard(gen) {
  const set = (param, value) => osc.send('/gen/set', gen.id, param, value);
  const led = el('span', { className: 'led' });
  const active = el('button', { onclick: () => set('active', gen.active ? 0 : 1) });

  const destSel = el('select');
  destSel.addEventListener('change', () => set('dest', parseInt(destSel.value)));
  const refreshers = [];  // controls listing clocks
  const refreshDests = () => {
    destSel.replaceChildren(new Option('—', 0),
      ...[...model.dests.values()].map((d) => new Option(d.name, d.id)));
    destSel.value = model.dests.has(gen.dest) ? gen.dest : 0;
  };

  const fields = [el('label', { textContent: 'dest' }), destSel];
  const updaters = {};
  const conditional = [];  // rows shown only for some values of another param
  const applyShow = () => conditional.forEach(({ show, els }) => {
    const visible = show.values.includes(String(gen.params[show.param]));
    els.forEach((e) => { e.hidden = !visible; });
  });
  const specs = model.types.get(gen.type) ?? [];
  const byName = Object.fromEntries(specs.map((s) => [s.name, s]));
  const learners = {};
  for (const spec of specs) {
    if (spec.section) fields.push(el('hr', { className: 'sep' }));
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
    const c = paramControl(spec, (v) => set(spec.name, v), (on) => osc.send('/gen/learn', gen.id, spec.name, on ? 1 : 0));
    if (c.learning) learners[spec.name] = c.learning;
    if (c.refresh) refreshers.push(c.refresh);
    const label = el('label', { textContent: c.label });
    updaters[spec.name] = c.update;
    if (spec.show) conditional.push({ show: spec.show, els: [label, c.control] });
    fields.push(label, c.control);
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
    refreshClocks: () => refreshers.forEach((f) => f()),
    render() {
      active.classList.toggle('on', gen.active);
      active.textContent = gen.active ? 'Active' : 'Inactive';
      root.classList.toggle('active', gen.active);
      refreshDests();
    },
    param: (name, value) => { updaters[name]?.(value); applyShow(); },
    learning: (name, on) => learners[name]?.(on),
    flash: () => led.animate([{ background: '#EBCB8B' }, { background: '#434C5E' }], { duration: 150 }),
  };
}

function mountCard(gen) {
  gen.card = buildCard(gen);
  gen.card.render();
  for (const [k, v] of Object.entries(gen.params)) gen.card.param(k, v);
  $('grid').append(gen.card.root);
}

function renderGens() {
  $('grid').replaceChildren();
  model.gens.forEach(mountCard);
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

// --- clocks: ratio or factor × main tempo, or free. Rows update in place (so a dial keeps its
// drag); the pane is rebuilt only when clocks are added or removed or a mode changes. ---
const clockRows = new Map();  // id -> { mode, root, update(c) }

function clockRow(c) {
  const set = (param, value) => osc.send('/clock/set', c.id, param, value);
  const mode = selectInput([['ratio', 'ratio'], ['factor', 'factor'], ['free', 'free']], (v) => set('mode', v));
  const tempo = el('span', { className: 'tempo' });
  let controls, show;
  if (c.mode === 'ratio') {
    const num = numberInput(1, 32, (v) => set('num', v)), den = numberInput(1, 32, (v) => set('den', v));
    controls = [num, '/', den];
    show = (c) => { if (!editing(num)) num.value = c.num; if (!editing(den)) den.value = c.den; };
  } else {
    const dial = c.mode === 'factor'
      ? rotary({ min: 0.25, max: 4, step: 0.0001, log: true, onChange: (v) => set('factor', v) })
      : rotary({ min: 20, max: 400, step: 0.1, onChange: (v) => set('bpm', v) });
    controls = [c.mode === 'factor' ? '×' : '', dial.root];
    show = (c) => dial.set(c.mode === 'factor' ? c.factor : c.bpm);
  }
  const root = el('div', { className: 'clock' },
    el('span', { className: 'name', textContent: c.name }), mode, ...controls, tempo,
    el('button', { className: 'close', textContent: '×', title: 'Remove', onclick: () => osc.send('/clock/remove', c.id) }));
  const update = (c) => { mode.value = c.mode; show(c); tempo.textContent = `${+c.tempo.toFixed(2)}`; };
  update(c);
  return { mode: c.mode, root, update };
}

function renderClocks() {
  clockRows.clear();
  $('clocks').replaceChildren(...[...model.clocks.values()].map((c) => {
    const row = clockRow(c);
    clockRows.set(c.id, row);
    return row.root;
  }));
  model.gens.forEach((g) => g.card?.refreshClocks());
}
$('add-clock').onclick = () => osc.send('/clock/add');

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
  renderClocks();
  renderDests();
  renderGens();
}

// --- brain messages ---
const specOf = (type, name) => model.types.get(type)?.find((s) => s.name === name);

const handlers = {
  '/pong': (id) => {
    lastPong = Date.now();
    if (bootId !== null && id !== bootId) setConnected(false);  // brain restarted: re-/hello
    bootId = id;
  },
  '/state/begin': () => {
    inSnapshot = true;
    model.types.clear(); model.clocks.clear(); model.dests.clear(); model.gens.clear();
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
  '/gen/section': (type, name) => { const spec = specOf(type, name); if (spec) spec.section = true; },
  '/gen/learn': (id, name, on) => model.gens.get(id)?.card?.learning(name, !!on),
  '/gen/show': (type, name, param, ...values) => {
    const spec = specOf(type, name);
    if (spec) spec.show = { param, values: values.map(String) };
  },
  '/gen/schema': (type, name, kind, def, ...args) => {
    if (!model.types.has(type)) model.types.set(type, []);
    model.types.get(type).push({ name, kind, def, args });
  },
  '/clock': (id, name, mode, num, den, factor, bpm, tempo) => {
    const c = { id, name, mode, num, den, factor, bpm, tempo };
    model.clocks.set(id, c);
    if (inSnapshot) return;
    const row = clockRows.get(id);
    if (row && row.mode === mode) row.update(c); else renderClocks();
  },
  '/clock/removed': (id) => { model.clocks.delete(id); renderClocks(); },
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
    if (gen.card) gen.card.render(); else mountCard(gen);
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
tempoDial.set(model.bpm);
osc.send('/hello');
