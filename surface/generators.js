// generators.js — generator strips (one per generator, in a rack), built entirely from the type schema the brain sends
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
    case 'chord': {
      // which chord strip its pitches come from: the first in the rack (named, so it's clear which), or one by name
      const chords = () =>
        new Map([...model.gens.values()].filter((g) => g.type === 'chord').map((g) => [g.id, { id: g.id, name: genName(g) }]));
      const sel = el('select');
      sel.addEventListener('change', () => send(parseInt(sel.value, 10)));
      let value = 0;
      const refresh = () => {
        const all = [...chords().values()];
        const first = [...model.gens.values()].filter((g) => g.type === 'chord').sort((a, b) => a.order - b.order)[0];
        sel.replaceChildren(
          new Option(first ? `first (${genName(first)})` : 'no chord strip', 0),
          ...all.map((x) => new Option(x.name, x.id)),
        );
        sel.title = first
          ? 'Which chord strip it reads: the first in the rack, or one by name'
          : 'There is no chord strip: add one (+ Chord) for it to play';
        sel.value = chords().has(value) ? value : 0;
      };
      refresh();
      return {
        control: sel,
        update: (v) => {
          value = v;
          refresh();
        },
        refresh,
      };
    }
    case 'input': {
      // a MIDI input by name, or any of them
      const sel = el('select');
      sel.addEventListener('change', () => send(sel.value));
      let value = 'any';
      const refresh = () => {
        const names = [...new Set([...(model.inputs ?? []).map((i) => i.name), ...(value === 'any' ? [] : [value])])];
        sel.replaceChildren(new Option('any input', 'any'), ...names.map((n) => new Option(n, n)));
        sel.value = value;
      };
      refresh();
      return {
        control: sel,
        update: (v) => {
          value = String(v);
          refresh();
        },
        refresh,
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
      if (!spec.slider && (max - min <= 32 || spec.field)) {
        // values from the brain are 32-bit floats (0.1 arrives as 0.10000000149…): shown to the setting's step
        const input = numberInput(min, max, send, step);
        return {
          control: input,
          update: (v) => {
            if (!editing(input)) input.value = +(Math.round(v / step) * step).toFixed(4);
          },
        };
      }
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
  // after this strip if the pointer is past its middle (down the rack; across, if strips ever share a row)
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

// The palette a strip's sections take their stripe from, by the section's first word (anything
// else, a type's own settings, gets the default in style.css).
const sectionKey = (title) => (title ?? '').toLowerCase().split(' ')[0];

// A generator's strip: a header (fold, On/Off, name, output) and its settings in sections, each
// setting a cell with its name and control.
function buildCard(gen) {
  const set = (param, value) => osc.send('/gen/set', gen.id, param, value);
  const led = el('span', { className: 'led', title: 'Flashes on each note' });
  const power = el('button', { className: 'power', onclick: () => set('active', gen.active ? 0 : 1) });
  const output = itemSelect('no output', model.dests, (v) => set('dest', v));
  output.sel.classList.add('output');
  output.sel.title = 'Output';

  const specs = model.types.get(gen.type) ?? [];
  const updaters = {},
    learners = {},
    refreshers = [], // menus that follow the model: clocks, chord strips, inputs
    mappable = {}; // param -> { label, control, cell, mark }: locked and outlined while it follows a driver
  const conditional = []; // cells shown only for some values of another param
  const secs = el('div', { className: 'secs' });
  let sec = null;
  const section = (title) => {
    sec = el('div', { className: 'sec', title: title ?? '' });
    sec.dataset.sec = sectionKey(title);
    secs.append(sec);
  };
  const addCell = (label, control, show) => {
    if (!sec) section();
    const cell = el('div', { className: 'cell' }, label, control);
    sec.append(cell);
    if (show) conditional.push({ show, cell });
    return cell;
  };
  const applyShow = () => {
    for (const { show, cell } of conditional) cell.hidden = !show.values.includes(String(gen.params[show.param]));
    for (const s of secs.children) if (s !== targets) s.hidden = [...s.children].every((c) => c.hidden);
  };

  const named = Object.fromEntries(specs.map((s) => [s.name, s]));
  for (const spec of specs) {
    if (spec.section) section(spec.section);
    if (spec.name === 'den' && named.num) continue;
    if (spec.name === 'num' && named.den) {
      // the grid step as num / den beats (the result is the cell's tooltip)
      const asField = (s) => ({ ...s, field: true }); // num/den are always number fields
      const num = paramControl(asField(spec), gen.id),
        den = paramControl(asField(named.den), gen.id);
      const row = el('div', { className: 'row' }, num.control, el('span', { className: 'unit', textContent: '/' }), den.control);
      const cell = addCell(el('label', { textContent: spec.label ?? 'step' }), row, spec.show);
      const showBeats = () => {
        cell.title = `${+(gen.params.num / gen.params.den).toFixed(3)} beat`;
      };
      updaters.num = (v) => {
        num.update(v);
        showBeats();
      };
      updaters.den = (v) => {
        den.update(v);
        showBeats();
      };
      continue;
    }
    const c = paramControl(spec, gen.id);
    const label = el('label', { textContent: spec.label ?? spec.name });
    const cell = addCell(label, c.control, spec.show);
    if (['range', 'choice', 'note'].includes(spec.kind)) {
      // its name is what Map mode clicks (globals.js); right-click pins it to the group's header
      Object.assign(label.dataset, { gen: gen.id, param: spec.name });
      const mark = el('span', {
        className: 'pin-mark',
        textContent: '◆',
        title: "Pinned to the group's header: click to unpin",
        hidden: true,
      });
      mark.onclick = (e) => {
        e.stopPropagation();
        togglePin(gen, spec.name);
      };
      label.prepend(mark);
      mappable[spec.name] = { label, control: c.control, cell, mark };
    }
    updaters[spec.name] = c.update;
    if (c.learning) learners[spec.name] = c.learning;
    if (c.refresh) refreshers.push(c.refresh);
  }

  // folded, a strip is its header (saved with the performance)
  const toggleFold = () => set('collapsed', gen.collapsed ? 0 : 1);
  const fold = el('button', { className: 'fold', onclick: toggleFold });
  let keyTag = switchKeyTag('gen', gen); // its on/off key, if it has one
  // a type that drives settings (lfo): Map (then click setting names on other strips) and its targets
  const map = specs.maps
    ? el('button', {
        className: 'map',
        title: 'Map: then click setting names on other strips (Esc or Map again to finish)',
        onclick: () => toggleMapMode('gen', gen.id),
      })
    : '';
  const targets = el('div', { className: 'sec targets', title: 'What it moves' });
  targets.dataset.sec = 'moves';
  secs.append(targets);
  const header = el(
    'header',
    {},
    fold,
    power,
    led,
    el('h2', { textContent: genName(gen), title: `${genName(gen)}: fold / unfold`, onclick: toggleFold }),
    keyTag,
    closeButton('Remove', () => osc.send('/gen/remove', gen.id)),
    specs.noOutput ? '' : output.sel,
    ...(specs.actions ?? []).map((a) => el('button', { textContent: a, onclick: () => osc.send('/gen/do', gen.id, a) })),
    map,
  );
  const root = el('section', { className: 'strip gen' }, header, secs);
  makeDraggable(gen, root, header);
  // right-click (on the strip, not inside its controls): pin a setting, duplicate, key, move, fold, remove
  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, select')) return;
    const param = e.target.closest('label[data-param]')?.dataset.param;
    const others = [...model.groups.values()].filter((g) => g.id !== gen.group);
    contextMenu(e, [
      param && gen.group && [isPinned(gen, param) ? `Unpin ${param}` : `Pin ${param} to the group's header`, () => togglePin(gen, param)],
      ['Duplicate', () => osc.send('/gen/duplicate', gen.id)],
      switchKeyItem('gen', gen),
      ...others.map((g) => [`Move to ${g.name}`, () => osc.send('/gen/move', gen.id, 0, g.id)]),
      gen.group && ['Move out of its group', () => osc.send('/gen/move', gen.id, 0, 0)],
      [gen.collapsed ? 'Unfold' : 'Fold', toggleFold],
      [gen.active ? 'Turn off' : 'Turn on', () => set('active', gen.active ? 0 : 1)],
      ['Remove', () => osc.send('/gen/remove', gen.id)],
    ]);
  });

  return {
    root,
    render() {
      // state, pins and menus (outputs, clocks) from the model
      setOn(power, gen.active, gen.active ? 'On' : 'Off');
      const tag = switchKeyTag('gen', gen);
      keyTag.replaceWith(tag);
      keyTag = tag;
      root.classList.toggle('active', gen.active);
      root.classList.toggle('silenced', gen.active && !sounds(gen)); // on, but muted by a group
      root.classList.toggle('collapsed', !!gen.collapsed);
      secs.hidden = !!gen.collapsed;
      if (map) setOn(map, isMapping('gen', gen.id), isMapping('gen', gen.id) ? 'Done' : 'Map');
      targets.replaceChildren(...(gen.mappings ?? []).map((m) => mappingRow(gen, m, 'gen')));
      targets.hidden = !gen.mappings?.length;
      fold.textContent = gen.collapsed ? '▸' : '▾';
      fold.title = gen.collapsed ? 'Unfold' : 'Fold away';
      for (const [param, { label, control, cell, mark }] of Object.entries(mappable)) {
        const driver = followedBy(gen.id, param);
        mark.hidden = !isPinned(gen, param);
        label.classList.toggle('mapped', !!driver);
        control.classList.toggle('locked', !!driver);
        cell.classList.toggle('driven', !!driver);
        if (cell.dataset.tip === undefined) cell.dataset.tip = cell.title;
        cell.title = driver ? `follows ${driver.name}: unmap it there to set it here` : cell.dataset.tip;
      }
      output.refresh(gen.dest);
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
