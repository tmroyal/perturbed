// ui.js — DOM helpers and the controls the other files build from.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
// Enter commits a typed value (fires 'change') by leaving the field.
const blurOnEnter = (input) =>
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
// True while the user is typing in a control, so echoes from the brain don't fight them.
const editing = (input) => document.activeElement === input;

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const OCTAVES = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // MIDI 60 = C4
const noteName = (p) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const typeLabel = (name) => name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const genName = (gen) => `${typeLabel(gen.type)} ${gen.id}`;
const byName = (a, b) => a.name.localeCompare(b.name);

// A toggle button's state: the 'on' class and, if given, its text for that state.
const setOn = (button, on, text) => {
  button.classList.toggle('on', on);
  if (text !== undefined) button.textContent = text;
  return button;
};
const closeButton = (title, onclick) => el('button', { className: 'close', textContent: '×', title, onclick });
// A light's flash (a note played, a beat).
const flash = (light, duration = 150) => light?.animate([{ background: '#EBCB8B' }, { background: '#434C5E' }], { duration });

// Follows a drag begun by pointerdown e on target: move(event) on every move, done() on release.
function drag(target, e, move, done) {
  target.setPointerCapture(e.pointerId);
  target.addEventListener('pointermove', move);
  target.addEventListener(
    'pointerup',
    () => {
      target.removeEventListener('pointermove', move);
      done?.();
    },
    { once: true },
  );
}

// Switch keys (a MIDI note that switches a generator or group on and off): the menu item to learn or
// forget one, and the small tag that shows it.
const isLearningKey = (kind, id) => model.keyLearning?.kind === kind && model.keyLearning.id === id;
const switchKeyItem = (kind, o) =>
  isLearningKey(kind, o.id)
    ? ['Cancel: waiting for a key…', () => osc.send('/key/learn', kind, o.id, 0)]
    : o.key == null
      ? ['Learn on/off key…', () => osc.send('/key/learn', kind, o.id, 1)]
      : [`Forget on/off key (${noteName(o.key)})`, () => osc.send('/key/set', kind, o.id, -1)];
function switchKeyTag(kind, o) {
  const learning = isLearningKey(kind, o.id);
  return el('span', {
    className: `key-tag${learning ? ' learning' : ''}`,
    textContent: learning ? 'play a key…' : o.key == null ? '' : noteName(o.key),
    title: learning ? 'The next key you play will switch it on and off' : 'Its on/off key (right-click to change)',
    hidden: !learning && o.key == null,
  });
}

// A right-click menu at the pointer: items are [label, action] (falsy ones are skipped). It closes
// on a choice, a click elsewhere or Escape.
function contextMenu(e, items) {
  e.preventDefault();
  document.querySelector('.context-menu')?.remove();
  const menu = el('div', { className: 'context-menu' });
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = (ev) => {
    if (!menu.contains(ev.target)) close();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
  };
  for (const [label, action] of items.filter(Boolean)) {
    menu.append(
      el('button', {
        textContent: label,
        onclick: () => {
          close();
          action();
        },
      }),
    );
  }
  document.body.append(menu);
  // keep it inside the window
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8)}px`;
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
}

function selectInput(options, onChange) {
  const sel = el('select');
  for (const [label, value] of options) sel.add(new Option(label, value));
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// A menu of a model map's items by name (outputs, groups, clocks) after a first option with value 0.
// refresh(value) rebuilds it from the map and selects value, or the first option if it's gone.
function itemSelect(first, items, onChange) {
  const sel = el('select');
  sel.addEventListener('change', () => onChange(parseInt(sel.value, 10)));
  const refresh = (value) => {
    sel.replaceChildren(new Option(first, 0), ...[...items.values()].map((x) => new Option(x.name, x.id)));
    sel.value = items.has(value) ? value : 0;
  };
  return { sel, refresh };
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

// A value bar: a number with a fill that shows where it sits in its range. Drag across it to change
// it (shift = fine; it moves from where it is, it never jumps to the pointer), double-click to type.
// set(v) shows a value unless the user is dragging or typing. log: logarithmic travel (frequencies).
function slider(min, max, onChange, { step = 1, log = false } = {}) {
  const TRAVEL = 160; // pixels of drag for the whole range
  const toPos = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (t) => (log ? min * (max / min) ** t : min + (max - min) * t);
  const round = (v) => Math.min(max, Math.max(min, +(Math.round(v / step) * step).toFixed(4)));
  let value = min,
    dragging = false;
  const show = (v) => {
    value = v;
    root.style.setProperty('--fill', `${100 * Math.min(1, Math.max(0, toPos(v)))}%`);
  };
  const field = numberInput(
    min,
    max,
    (v) => {
      show(v);
      onChange(v);
    },
    step,
  );
  field.classList.add('value');
  const root = el('div', { className: 'row valuebar', title: 'Drag to change (shift: fine), double-click to type' }, field);
  root.addEventListener('pointerdown', (e) => {
    if (document.activeElement === field) return; // typing
    e.preventDefault();
    dragging = true;
    let pos = toPos(value),
      lastX = e.clientX;
    drag(
      root,
      e,
      (m) => {
        pos = Math.min(1, Math.max(0, pos + (m.clientX - lastX) / (m.shiftKey ? TRAVEL * 10 : TRAVEL)));
        lastX = m.clientX;
        const v = round(fromPos(pos));
        if (v === round(value)) return;
        field.value = v;
        show(v);
        onChange(v);
      },
      () => {
        dragging = false;
      },
    );
  });
  root.addEventListener('dblclick', () => {
    field.focus();
    field.select();
  });
  const set = (v) => {
    if (dragging) return;
    if (!editing(field)) field.value = round(v); // values from the brain can carry float noise (0.7874015…)
    show(v);
  };
  return { root, set };
}

// Rotary dial with a typed field: drag vertically (shift = fine), scroll, or double-click to type.
// log: the dial is logarithmic (for factors). set(v) shows a value unless the user is dragging.
function rotary({ min, max, step, log = false, size = 32, onChange }) {
  const SWEEP = 270,
    R = size * 0.375,
    W = size * 0.09,
    c = size / 2;
  const norm = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const polar = (deg, r = R) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const arc = (from, to) => {
    const [x1, y1] = polar(from),
      [x2, y2] = polar(to);
    return `M${x1} ${y1} A${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  const stroke = { fill: 'none', 'stroke-width': W, 'stroke-linecap': 'round' };
  const valueArc = svgEl('path', { ...stroke, stroke: '#88C0D0' });
  const pointer = svgEl('line', { stroke: '#ECEFF4', 'stroke-width': W / 2, 'stroke-linecap': 'round' });
  svg.append(svgEl('path', { ...stroke, stroke: '#434C5E', d: arc(-SWEEP / 2, SWEEP / 2) }), valueArc, pointer);

  let value = min,
    dragging = false;
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const round = (v) => +(Math.round(v / step) * step).toFixed(6);
  const field = numberInput(
    min,
    max,
    (v) => {
      draw(v);
      onChange(v);
    },
    step,
  );

  function draw(v) {
    value = v;
    const angle = -SWEEP / 2 + SWEEP * Math.min(1, Math.max(0, norm(v)));
    valueArc.setAttribute('d', arc(-SWEEP / 2, Math.max(angle, -SWEEP / 2 + 0.01)));
    const [px, py] = polar(angle),
      [cx, cy] = polar(angle, R * 0.45);
    for (const [k, val] of Object.entries({ x1: cx, y1: cy, x2: px, y2: py })) pointer.setAttribute(k, val);
    if (!editing(field)) field.value = round(v);
  }
  // move by dy pixels (up = positive); keeps the unrounded value while dragging for smooth fine moves
  const nudge = (dy, fine) => {
    const v = clamp(log ? value * Math.exp(dy * (fine ? 0.0005 : 0.005)) : value + dy * step * (fine ? 1 : 10));
    draw(v);
    onChange(round(v));
  };

  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    let lastY = e.clientY;
    drag(
      svg,
      e,
      (m) => {
        nudge(lastY - m.clientY, m.shiftKey);
        lastY = m.clientY;
      },
      () => {
        dragging = false;
      },
    );
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    nudge(-Math.sign(e.deltaY) * (log ? 4 : 1), e.shiftKey);
  });
  svg.addEventListener('dblclick', () => field.select());

  return {
    root: el('div', { className: 'rotary' }, svg, field),
    set: (v) => {
      if (!dragging) draw(v);
    },
  };
}
