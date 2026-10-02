// generators.js — generator cards, built entirely from the type schema the brain sends
// (params, labels, sections, showWhen), so new types need no surface code.

// One param of generator genId as a control: { control, update(value), learning?(on), refresh?() }.
// Changes go straight to the brain; a note's Set asks it for the next key played (/gen/learn).
function paramControl(spec, genId) {
  const [min, max, step = 1] = spec.args;
  const send = (v) => osc.send('/gen/set', genId, spec.name, v);
  const plain = (input) => ({ control: input, update: (v) => { if (!editing(input)) input.value = v; } });
  switch (spec.kind) {
    case 'note': {
      // pitch class + octave -> MIDI note (capped at G9 = 127)
      let pc = 0, oct = 5, learning = false;
      const setNote = () => send(Math.min(127, oct * 12 + pc));
      const name = selectInput(NOTE_NAMES.map((n, i) => [n, i]), (v) => { pc = +v; setNote(); });
      const octave = selectInput(OCTAVES.map((o, i) => [o, i]), (v) => { oct = +v; setNote(); });
      const setBtn = el('button', { className: 'learn', textContent: 'Set', title: 'Set from the next key played',
        onclick: () => osc.send('/gen/learn', genId, spec.name, learning ? 0 : 1) });
      return {
        control: el('div', { className: 'row' }, name, octave, setBtn),
        update: (v) => { pc = v % 12; oct = Math.floor(v / 12); name.value = pc; octave.value = oct; },
        learning: (on) => { learning = on; setOn(setBtn, on, on ? 'Play…' : 'Set'); },
      };
    }
    case 'clock': {
      const menu = itemSelect('A · main', model.clocks, send);
      let value = 0;
      menu.refresh(value);
      return { control: menu.sel, update: (v) => { value = v; menu.refresh(v); }, refresh: () => menu.refresh(value) };
    }
    case 'choice': {
      const sel = selectInput(spec.args.map((o) => [o, o]), send);
      return { control: sel, update: (v) => { sel.value = v; } };
    }
    case 'range': {
      if (!spec.slider && (max - min <= 32 || spec.field)) return plain(numberInput(min, max, send, step));
      const s = slider(min, max, send, { step, log: spec.slider === 'log' });
      return { control: s.root, update: s.set };
    }
    default: {  // text
      const input = el('input', { type: 'text' });
      input.addEventListener('change', () => send(input.value));
      blurOnEnter(input);
      return plain(input);
    }
  }
}

function buildCard(gen) {
  const set = (param, value) => osc.send('/gen/set', gen.id, param, value);
  const led = el('span', { className: 'led', title: 'Flashes on each note' });
  const power = el('button', { className: 'power', onclick: () => set('active', gen.active ? 0 : 1) });
  const output = itemSelect('—', model.dests, (v) => set('dest', v));
  const group = itemSelect('—', model.groups, (v) => set('group', v));

  const specs = model.types.get(gen.type) ?? [];
  const fields = [...(specs.noOutput ? [] : [el('label', { textContent: 'output' }), output.sel]),
    el('label', { textContent: 'group' }), group.sel];
  const updaters = {}, learners = {}, refreshers = [], pins = {};  // refreshers: menus of clocks
  const conditional = [];  // rows shown only for some values of another param
  const applyShow = () => conditional.forEach(({ show, els }) => {
    const visible = show.values.includes(String(gen.params[show.param]));
    els.forEach((e) => { e.hidden = !visible; });
  });

  const named = Object.fromEntries(specs.map((s) => [s.name, s]));
  for (const spec of specs) {
    if (spec.section) fields.push(el('div', { className: 'section', textContent: spec.section }));
    if (spec.name === 'den' && named.num) continue;
    if (spec.name === 'num' && named.den) {
      // the grid step as num / den beats, with the result shown
      const beats = el('span', { className: 'hint' });
      const showBeats = () => { beats.textContent = `= ${+(gen.params.num / gen.params.den).toFixed(3)} beat`; };
      const asField = (s) => ({ ...s, field: true });  // num/den are always number fields (a slider doesn't fit the row)
      const num = paramControl(asField(spec), gen.id), den = paramControl(asField(named.den), gen.id);
      updaters.num = (v) => { num.update(v); showBeats(); };
      updaters.den = (v) => { den.update(v); showBeats(); };
      const row = el('div', { className: 'row' }, num.control, '/', den.control, beats);
      fields.push(el('label', { textContent: spec.label ?? 'step' }), row);
      if (spec.show) conditional.push({ show: spec.show, els: [fields[fields.length - 2], row] });
      continue;
    }
    const c = paramControl(spec, gen.id);
    const label = el('label', { textContent: spec.label ?? spec.name });
    if (['range', 'choice', 'note'].includes(spec.kind)) {
      // ◇ pins the setting to the group's header (shown only while the card is in a group)
      const pin = el('button', { className: 'pin-toggle', textContent: '◇', title: 'Pin to the group\'s header', onclick: () => togglePin(gen, spec.name) });
      pins[spec.name] = pin;
      label.prepend(pin);
    }
    updaters[spec.name] = c.update;
    if (c.learning) learners[spec.name] = c.learning;
    if (c.refresh) refreshers.push(c.refresh);
    if (spec.show) conditional.push({ show: spec.show, els: [label, c.control] });
    fields.push(label, c.control);
  }

  const root = el('section', { className: 'card gen' },
    el('header', {},
      led,
      el('h2', { textContent: genName(gen) }),
      ...(specs.actions ?? []).map((a) => el('button', { className: 'power', textContent: a, onclick: () => osc.send('/gen/do', gen.id, a) })),
      power,
      closeButton('Remove', () => osc.send('/gen/remove', gen.id))),
    el('div', { className: 'fields' }, ...fields));

  return {
    root,
    render() {  // state, pins and menus (outputs, groups, clocks) from the model
      setOn(power, gen.active, gen.active ? 'On' : 'Off');
      root.classList.toggle('active', gen.active);
      root.classList.toggle('silenced', gen.active && !sounds(gen));  // on, but muted by a group
      root.classList.toggle('grouped', !!gen.group);
      for (const [param, pin] of Object.entries(pins)) {
        const on = isPinned(gen, param);
        setOn(pin, on, on ? '◆' : '◇');
      }
      output.refresh(gen.dest);
      group.refresh(gen.group);
      refreshers.forEach((f) => f());
    },
    param: (name, value) => { updaters[name]?.(value); applyShow(); },
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
  if (!gen.card) mountCard(gen); else { gen.card.render(); if (moved) placeCard(gen); }
  renderGroupSummaries();
}

function unmountCard(gen) {
  gen?.card?.root.remove();
  renderGroupSummaries();
}

// Re-renders every card (their menus follow the outputs, groups and clocks).
const renderCards = () => model.gens.forEach((g) => g.card?.render());

function renderGens() {
  model.gens.forEach((g) => { g.card = null; });
  renderGroups();
  model.gens.forEach(mountCard);
  renderGroupSummaries();
}
