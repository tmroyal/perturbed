// globals.js — global parameters in the sidebar: Meta 1, Meta 2, ... (named by the performer), each a
// 0–1 slider that moves every setting mapped to it (brain/core/globals.scd). Map mode: press a
// global's Map, then click setting names on cards; each becomes a mapping, tuned in the list under
// the global (from → to in the setting's units, from > to inverts; curve). Mapped settings are
// locked on their cards and tagged with the global's name. Knob: press it and turn a knob or fader on
// the controller; the global follows it from then on.
//
// Generators that drive settings (lfo) map the same way: their card has the Map button and the
// list of targets (generators.js); Map mode, the rows and the lock are shared here.
const CURVES = ['linear', 'exp', 'steps', 'threshold'];
const globalRows = new Map(); // id -> { update(gl) }, so a dragged slider isn't rebuilt under the pointer
const expanded = new Set(); // ids of globals whose mappings are shown
let mapping = null; // what's in Map mode: { kind: 'global' | 'gen', id }, or null
const isMapping = (kind, id) => mapping?.kind === kind && mapping.id === id;

// What a setting follows (a global, or a generator that drives it), as { name }; or undefined.
function followedBy(genId, param) {
  const drives = (d) => (d.mappings ?? []).some((m) => m.gen === genId && m.param === param);
  const gl = [...model.globals.values()].find(drives);
  if (gl) return gl;
  const gen = [...model.gens.values()].find(drives);
  return gen && { name: genName(gen) };
}

// Map mode for a global or a generator (again: off).
function toggleMapMode(kind, id) {
  mapping = isMapping(kind, id) ? null : { kind, id };
  document.body.classList.toggle('map-mode', mapping !== null);
  renderGlobals();
  renderCards();
}

// In Map mode a click on a setting's name maps it (the brain refuses settings that can't be mapped).
document.addEventListener(
  'click',
  (e) => {
    const label = mapping !== null && e.target.closest('.card label[data-param]');
    if (!label) return;
    e.preventDefault();
    e.stopPropagation();
    osc.send(`/${mapping.kind}/map`, mapping.id, +label.dataset.gen, label.dataset.param);
  },
  true,
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mapping !== null) toggleMapMode(mapping.kind, mapping.id);
});

// One mapping of a driver (kind 'global' or 'gen'): from → to (menus for menu settings), curve, its
// amount when it has one, ×.
function mappingRow(gl, m, kind = 'global') {
  const gen = model.gens.get(m.gen);
  const spec = gen && specOf(gen.type, m.param);
  if (!spec) return '';
  const send = (patch) => {
    const n = { ...m, ...patch };
    osc.send(`/${kind}/map`, gl.id, m.gen, m.param, n.from, n.to, n.curve, ...(n.amount === null ? [] : [n.amount]));
  };
  const end = (key) => {
    if (spec.kind === 'choice') {
      const sel = selectInput(
        spec.args.map((o, i) => [o, i]),
        (v) => send({ [key]: +v }),
      );
      sel.value = Math.round(m[key]);
      return sel;
    }
    const [min, max] = spec.kind === 'note' ? [0, 127] : spec.args;
    const input = numberInput(min, max, (v) => send({ [key]: v }), spec.kind === 'range' ? (spec.args[2] ?? 1) : 1);
    input.value = +m[key].toFixed(4);
    return input;
  };
  const curve = selectInput(
    CURVES.map((c) => [c, c]),
    (v) => send({ curve: v, amount: null }),
  );
  curve.value = m.curve;
  const amount = ['steps', 'threshold'].includes(m.curve)
    ? Object.assign(
        numberInput(m.curve === 'steps' ? 2 : 0, m.curve === 'steps' ? 32 : 1, (v) => send({ amount: v }), m.curve === 'steps' ? 1 : 0.01),
        { value: m.amount ?? (m.curve === 'steps' ? 4 : 0.5), title: m.curve === 'steps' ? 'steps' : 'switches at' },
      )
    : '';
  return el(
    'div',
    { className: 'mapping' },
    el('span', { className: 'what', textContent: `${genName(gen)} · ${m.param}` }),
    el(
      'div',
      { className: 'row' },
      end('from'),
      '→',
      end('to'),
      curve,
      amount,
      closeButton('Unmap', () => osc.send(`/${kind}/unmap`, gl.id, m.gen, m.param)),
    ),
  );
}

// How the global answers its knob (x, 0–1): several globals can share a knob and answer differently.
const RESPONSES = ['linear', 'invert', 'exp', 'log', 'formula'];
function responseRow(gl) {
  const response = selectInput(
    RESPONSES.map((r) => [r, r]),
    (v) => osc.send('/global/set', gl.id, 'response', v),
  );
  response.value = gl.response;
  response.title = 'linear: follows the knob. invert: knob up, global down. exp: slow start. log: fast start. formula: your own, in x.';
  const formula = el('input', {
    type: 'text',
    value: gl.formula,
    title: 'A formula in x (0–1), e.g. x * x, 1 - x, (x * 2 - 1).abs',
    hidden: gl.response !== 'formula',
  });
  formula.addEventListener('change', () => osc.send('/global/set', gl.id, 'formula', formula.value.trim() || 'x'));
  blurOnEnter(formula);
  return el(
    'div',
    { className: 'mapping response' },
    el('span', { className: 'what', textContent: 'knob response' }),
    el('div', { className: 'row' }, response, formula),
  );
}

function globalRow(gl) {
  const name = el('input', { type: 'text', className: 'global-name', value: gl.name, title: 'Rename' });
  name.addEventListener('change', () => osc.send('/global/set', gl.id, 'name', name.value.trim() || gl.name));
  blurOnEnter(name);
  const value = slider(0, 1, (v) => osc.send('/global/set', gl.id, 'value', v), { step: 0.01 });
  const open = expanded.has(gl.id);
  const map = el('button', {
    className: 'map',
    title: 'Map: then click setting names on cards (Esc or Map again to finish)',
    onclick: () => toggleMapMode('global', gl.id),
  });
  setOn(map, isMapping('global', gl.id), isMapping('global', gl.id) ? 'Done' : 'Map');
  const knob = el('button', {
    className: 'knob',
    onclick: () => osc.send('/global/learn', gl.id, model.knobLearning === gl.id ? 0 : 1),
  });
  const clearKnob = closeButton('Forget the knob', () => osc.send('/global/knob', gl.id, 0, 0));
  const showKnob = (g) => {
    const learning = model.knobLearning === g.id;
    setOn(knob, learning, learning ? 'Turn…' : g.knob ? `CC ${g.knob.cc}` : 'Knob');
    knob.title = learning
      ? 'Turn a knob or fader on your controller (press again to cancel)'
      : g.knob
        ? `Follows CC ${g.knob.cc} on channel ${g.knob.channel}: press to learn another`
        : 'Learn a knob: press, then turn a knob or fader on your controller';
    clearKnob.hidden = !g.knob || learning;
  };
  showKnob(gl);
  const root = el(
    'div',
    { className: 'global' },
    el(
      'div',
      { className: 'global-head' },
      name,
      knob,
      clearKnob,
      map,
      el('button', {
        className: 'fold',
        textContent: `${open ? '▾' : '▸'} ${gl.mappings.length}`,
        title: `${gl.mappings.length} mapped setting${gl.mappings.length === 1 ? '' : 's'}: ${open ? 'hide' : 'show'}`,
        onclick: () => {
          if (open) expanded.delete(gl.id);
          else expanded.add(gl.id);
          renderGlobals();
        },
      }),
      closeButton('Remove (its settings are unmapped)', () => osc.send('/global/remove', gl.id)),
    ),
    value.root,
    ...(open ? [responseRow(gl), ...gl.mappings.map((m) => mappingRow(gl, m))] : []),
  );
  value.set(gl.value);
  return {
    root,
    update(g) {
      value.set(g.value);
      showKnob(g);
      if (!editing(name)) name.value = g.name;
    },
  };
}

function renderGlobals() {
  globalRows.clear();
  $('globals').replaceChildren(
    ...[...model.globals.values()].map((gl) => {
      const row = globalRow(gl);
      globalRows.set(gl.id, row);
      return row.root;
    }),
  );
}

const updateGlobal = (gl) => (globalRows.has(gl.id) ? globalRows.get(gl.id).update(gl) : renderGlobals());
$('add-global').onclick = () => osc.send('/global/add');
