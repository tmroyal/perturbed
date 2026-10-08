// generators.js — generator cards, built entirely from the type schema the brain sends
// (params, labels, sections, showWhen), so new types need no surface code.

// One param of generator genId as a control: { control, update(value), learning?(on), refresh?() }.
// Changes go straight to the brain; a note's Set asks it for the next key played (/gen/learn).
function paramControl(spec, genId) {
  const [min, max, step = 1] = spec.args;
  const send = (v) => osc.send('/gen/set', genId, spec.name, v);
  const plain = (input) => ({
    control: input,
    update: (v) => {
      if (!editing(input)) input.value = v;
    },
  });
  switch (spec.kind) {
    case 'note': {
      // pitch class + octave -> MIDI note (capped at G9 = 127)
      let pc = 0,
        oct = 5,
        learning = false;
      const setNote = () => send(Math.min(127, oct * 12 + pc));
      const name = selectInput(
        NOTE_NAMES.map((n, i) => [n, i]),
        (v) => {
          pc = +v;
          setNote();
        },
      );
      const octave = selectInput(
        OCTAVES.map((o, i) => [o, i]),
        (v) => {
          oct = +v;
          setNote();
        },
      );
      const setBtn = el('button', {
        className: 'learn',
        textContent: 'Set',
        title: 'Set from the next key played',
        onclick: () => osc.send('/gen/learn', genId, spec.name, learning ? 0 : 1),
      });
      return {
        control: el('div', { className: 'row' }, name, octave, setBtn),
        update: (v) => {
          pc = v % 12;
          oct = Math.floor(v / 12);
          name.value = pc;
          octave.value = oct;
        },
        learning: (on) => {
          learning = on;
          setOn(setBtn, on, on ? 'Play…' : 'Set');
        },
      };
    }
    case 'clock': {
      const menu = itemSelect('A · main', model.clocks, send);
      let value = 0;
      menu.refresh(value);
      return {
        control: menu.sel,
        update: (v) => {
          value = v;
          menu.refresh(v);
        },
        refresh: () => menu.refresh(value),
      };
    }
    case 'choice': {
      const sel = selectInput(
        spec.args.map((o) => [o, o]),
        send,
      );
      return {
        control: sel,
        update: (v) => {
          sel.value = v;
        },
      };
    }
    case 'range': {
      if (!spec.slider && (max - min <= 32 || spec.field)) return plain(numberInput(min, max, send, step));
      const s = slider(min, max, send, { step, log: spec.slider === 'log' });
      return { control: s.root, update: s.set };
    }
    default: {
      // text
      const input = el('input', { type: 'text' });
      input.addEventListener('change', () => send(input.value));
      blurOnEnter(input);
      return plain(input);
    }
  }
}

// Dragging a card by its header: onto another card puts it before or after that one (and into its
// group); onto a group's area or header, at the end of that group (groups.js).
let draggingGen = null; // the id of the generator being dragged

function makeDraggable(gen, root, header) {
  header.draggable = true;
  root.dataset.gen = gen.id;
  header.addEventListener('dragstart', (e) => {
    if (e.target.closest('button, input, select')) return e.preventDefault();
    draggingGen = gen.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', genName(gen));
    root.classList.add('dragging');
    document.body.classList.add('dragging-card');
  });
  header.addEventListener('dragend', () => {
    draggingGen = null;
    root.classList.remove('dragging');
    document.body.classList.remove('dragging-card');
    for (const x of document.querySelectorAll('.drop-before, .drop-after, .drop-here'))
      x.classList.remove('drop-before', 'drop-after', 'drop-here');
  });
  // after this card if the pointer is past its middle (across in a row of cards, down in a column)
  const after = (e) => {
    const r = root.getBoundingClientRect();
    const inRow = [root.previousElementSibling, root.nextElementSibling].some((s) => s && s.offsetTop === root.offsetTop);
    return inRow ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
  };
  root.addEventListener('dragover', (e) => {
    if (draggingGen === null || draggingGen === gen.id) return;
    e.preventDefault();
    e.stopPropagation();
    root.classList.toggle('drop-after', after(e));
    root.classList.toggle('drop-before', !after(e));
  });
  root.addEventListener('dragleave', () => root.classList.remove('drop-before', 'drop-after'));
  root.addEventListener('drop', (e) => {
    if (draggingGen === null || draggingGen === gen.id) return;
    e.preventDefault();
    e.stopPropagation();
    // "after this one" = before the next card that isn't the one being dragged (0: last)
    let next = root.nextElementSibling;
    while (next && +next.dataset.gen === draggingGen) next = next.nextElementSibling;
    osc.send('/gen/move', draggingGen, after(e) ? +(next?.dataset.gen ?? 0) : gen.id, gen.group);
  });
}

function buildCard(gen) {
  const set = (param, value) => osc.send('/gen/set', gen.id, param, value);
  const led = el('span', { className: 'led', title: 'Flashes on each note' });
  const power = el('button', { className: 'power', onclick: () => set('active', gen.active ? 0 : 1) });
  const output = itemSelect('—', model.dests, (v) => set('dest', v));
  const group = itemSelect('—', model.groups, (v) => set('group', v));

  const specs = model.types.get(gen.type) ?? [];
  const fields = [
    ...(specs.noOutput ? [] : [el('label', { textContent: 'output' }), output.sel]),
    el('label', { textContent: 'group' }),
    group.sel,
  ];
  const updaters = {},
    learners = {},
    refreshers = [],
    pins = {}, // refreshers: menus of clocks
    mappable = {}; // param -> { label, control, tag }: locked and tagged while it follows a global
  const conditional = []; // rows shown only for some values of another param
  const applyShow = () =>
    conditional.forEach(({ show, els }) => {
      const visible = show.values.includes(String(gen.params[show.param]));
      els.forEach((e) => {
        e.hidden = !visible;
      });
    });

  const named = Object.fromEntries(specs.map((s) => [s.name, s]));
  for (const spec of specs) {
    if (spec.section) fields.push(el('div', { className: 'section', textContent: spec.section }));
    if (spec.name === 'den' && named.num) continue;
    if (spec.name === 'num' && named.den) {
      // the grid step as num / den beats, with the result shown
      const beats = el('span', { className: 'hint' });
      const showBeats = () => {
        beats.textContent = `= ${+(gen.params.num / gen.params.den).toFixed(3)} beat`;
      };
      const asField = (s) => ({ ...s, field: true }); // num/den are always number fields (a slider doesn't fit the row)
      const num = paramControl(asField(spec), gen.id),
        den = paramControl(asField(named.den), gen.id);
      updaters.num = (v) => {
        num.update(v);
        showBeats();
      };
      updaters.den = (v) => {
        den.update(v);
        showBeats();
      };
      const row = el('div', { className: 'row' }, num.control, '/', den.control, beats);
      fields.push(el('label', { textContent: spec.label ?? 'step' }), row);
      if (spec.show) conditional.push({ show: spec.show, els: [fields[fields.length - 2], row] });
      continue;
    }
    const c = paramControl(spec, gen.id);
    const label = el('label', { textContent: spec.label ?? spec.name });
    if (['range', 'choice', 'note'].includes(spec.kind)) {
      // its name is what Map mode clicks (globals.js); the tag shows the global it follows
      Object.assign(label.dataset, { gen: gen.id, param: spec.name });
      const tag = el('span', { className: 'follows' });
      label.append(tag);
      mappable[spec.name] = { label, control: c.control, tag };
      // ◇ pins the setting to the group's header (shown only while the card is in a group)
      const pin = el('button', {
        className: 'pin-toggle',
        textContent: '◇',
        title: "Pin to the group's header",
        onclick: () => togglePin(gen, spec.name),
      });
      pins[spec.name] = pin;
      label.prepend(pin);
    }
    updaters[spec.name] = c.update;
    if (c.learning) learners[spec.name] = c.learning;
    if (c.refresh) refreshers.push(c.refresh);
    if (spec.show) conditional.push({ show: spec.show, els: [label, c.control] });
    fields.push(label, c.control);
  }

  // folded, a card is its header: light, name, output, On/Off, remove (saved with the performance)
  const toggleFold = () => set('collapsed', gen.collapsed ? 0 : 1);
  const fold = el('button', { className: 'fold', onclick: toggleFold });
  const where = el('span', { className: 'hint where' });
  let keyTag = switchKeyTag('gen', gen); // its on/off key, if it has one
  // a type that drives settings (lfo): Map (then click setting names on other cards) and its targets
  const map = specs.maps
    ? el('button', {
        className: 'power map',
        title: 'Map: then click setting names on other cards (Esc or Map again to finish)',
        onclick: () => toggleMapMode('gen', gen.id),
      })
    : '';
  const targets = el('div', { className: 'targets' });
  const body = el('div', { className: 'fields' }, ...fields);
  const root = el(
    'section',
    { className: 'card gen' },
    el(
      'header',
      {},
      fold,
      led,
      el('h2', { textContent: genName(gen), title: 'Fold / unfold', onclick: toggleFold }),
      where,
      ...(specs.actions ?? []).map((a) =>
        el('button', { className: 'power', textContent: a, onclick: () => osc.send('/gen/do', gen.id, a) }),
      ),
      map,
      keyTag,
      power,
      closeButton('Remove', () => osc.send('/gen/remove', gen.id)),
    ),
    body,
    targets,
  );
  makeDraggable(gen, root, root.querySelector('header'));
  // right-click (on the card, not inside its controls): duplicate, fold, remove
  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, select')) return;
    contextMenu(e, [
      ['Duplicate', () => osc.send('/gen/duplicate', gen.id)],
      switchKeyItem('gen', gen),
      [gen.collapsed ? 'Unfold' : 'Fold', toggleFold],
      [gen.active ? 'Turn off' : 'Turn on', () => set('active', gen.active ? 0 : 1)],
      ['Remove', () => osc.send('/gen/remove', gen.id)],
    ]);
  });

  return {
    root,
    render() {
      // state, pins and menus (outputs, groups, clocks) from the model
      setOn(power, gen.active, gen.active ? 'On' : 'Off');
      const tag = switchKeyTag('gen', gen);
      keyTag.replaceWith(tag);
      keyTag = tag;
      root.classList.toggle('active', gen.active);
      root.classList.toggle('silenced', gen.active && !sounds(gen)); // on, but muted by a group
      root.classList.toggle('grouped', !!gen.group);
      root.classList.toggle('collapsed', !!gen.collapsed);
      body.hidden = !!gen.collapsed;
      targets.hidden = !!gen.collapsed;
      if (map) setOn(map, isMapping('gen', gen.id), isMapping('gen', gen.id) ? 'Done' : 'Map');
      targets.replaceChildren(
        ...(gen.mappings?.length ? [el('div', { className: 'section', textContent: 'Moves' })] : []),
        ...(gen.mappings ?? []).map((m) => mappingRow(gen, m, 'gen')),
      );
      fold.textContent = gen.collapsed ? '▸' : '▾';
      fold.title = gen.collapsed ? 'Unfold' : 'Fold away';
      where.textContent = gen.collapsed ? (model.dests.get(gen.dest)?.name ?? '') : '';
      for (const [param, pin] of Object.entries(pins)) {
        const on = isPinned(gen, param);
        setOn(pin, on, on ? '◆' : '◇');
      }
      for (const [param, { label, control, tag }] of Object.entries(mappable)) {
        const gl = followedBy(gen.id, param);
        label.classList.toggle('mapped', !!gl);
        control.classList.toggle('locked', !!gl);
        tag.textContent = gl ? `← ${gl.name}` : '';
        control.title = gl ? `follows ${gl.name}: unmap it there to set it here` : '';
      }
      output.refresh(gen.dest);
      group.refresh(gen.group);
      for (const f of refreshers) f();
    },
    param: (name, value) => {
      updaters[name]?.(value);
      applyShow();
    },
    learning: (name, on) => learners[name]?.(on),
    flash: () => flash(led),
  };
}

function mountCard(gen) {
  gen.card = buildCard(gen);
  gen.card.render();
  for (const [k, v] of Object.entries(gen.params)) gen.card.param(k, v);
  placeCard(gen);
}

// After /gen: a new generator gets a card; a known one re-renders, and moves if its group changed.
function updateGen(gen, moved) {
  if (!gen.card) mountCard(gen);
  else {
    gen.card.render();
    if (moved) placeCard(gen);
  }
  renderGroupSummaries();
}

function unmountCard(gen) {
  gen?.card?.root.remove();
  renderGroupSummaries();
}

// Re-renders every card (their menus follow the outputs, groups and clocks).
const renderCards = () => {
  for (const g of model.gens.values()) g.card?.render();
};

function renderGens() {
  model.gens.forEach((g) => {
    g.card = null;
  });
  renderGroups();
  model.gens.forEach(mountCard);
  renderGroupSummaries();
}
