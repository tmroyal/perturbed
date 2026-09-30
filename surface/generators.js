// generators.js — generator cards, built entirely from the type schema the brain sends
// (params, labels, sections, showWhen), so new types need no surface code.

// One param's control: { control, update(value), learning?(on), refresh?() }.
// learn(on) asks the brain to set the param from the next key played (note params).
function paramControl(spec, send, learn) {
  const [min, max, step = 1] = spec.args;
  const plain = (input) => ({ control: input, update: (v) => { if (!editing(input)) input.value = v; } });
  switch (spec.kind) {
    case 'note': {
      // pitch class + octave -> MIDI note (capped at G9 = 127)
      let pc = 0, oct = 5, learning = false;
      const setNote = () => send(Math.min(127, oct * 12 + pc));
      const name = selectInput(NOTE_NAMES.map((n, i) => [n, i]), (v) => { pc = +v; setNote(); });
      const octave = selectInput(OCTAVES.map((o, i) => [o, i]), (v) => { oct = +v; setNote(); });
      const setBtn = el('button', { className: 'learn', textContent: 'Set', title: 'Set from the next key played',
        onclick: () => learn(!learning) });
      return {
        control: el('div', { className: 'row' }, name, octave, setBtn),
        update: (v) => { pc = v % 12; oct = Math.floor(v / 12); name.value = pc; octave.value = oct; },
        learning: (on) => { learning = on; setBtn.classList.toggle('on', on); setBtn.textContent = on ? 'Play…' : 'Set'; },
      };
    }
    case 'clock': {
      const sel = el('select');
      sel.addEventListener('change', () => send(parseInt(sel.value)));
      let value = 0;
      const refresh = () => {
        sel.replaceChildren(new Option('A · main', 0), ...[...model.clocks.values()].map((c) => new Option(c.name, c.id)));
        sel.value = model.clocks.has(value) ? value : 0;
      };
      refresh();
      return { control: sel, update: (v) => { value = v; refresh(); }, refresh };
    }
    case 'choice': {
      const sel = selectInput(spec.args.map((o) => [o, o]), send);
      return { control: sel, update: (v) => { sel.value = v; } };
    }
    case 'range': {
      if (max - min <= 32) return plain(numberInput(min, max, send, step));
      const { input, out } = slider(min, max, send);
      return {
        control: el('div', { className: 'row' }, input, out),
        update: (v) => { if (!editing(input)) input.value = v; out.textContent = v; },
      };
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

  const outputSel = el('select');
  outputSel.addEventListener('change', () => set('dest', parseInt(outputSel.value)));
  const refreshOutputs = () => {
    outputSel.replaceChildren(new Option('—', 0), ...[...model.dests.values()].map((d) => new Option(d.name, d.id)));
    outputSel.value = model.dests.has(gen.dest) ? gen.dest : 0;
  };

  const specs = model.types.get(gen.type) ?? [];
  const fields = specs.noOutput ? [] : [el('label', { textContent: 'output' }), outputSel];
  const updaters = {}, learners = {}, refreshers = [];
  const conditional = [];  // rows shown only for some values of another param
  const applyShow = () => conditional.forEach(({ show, els }) => {
    const visible = show.values.includes(String(gen.params[show.param]));
    els.forEach((e) => { e.hidden = !visible; });
  });

  const byName = Object.fromEntries(specs.map((s) => [s.name, s]));
  for (const spec of specs) {
    if (spec.section) fields.push(el('div', { className: 'section', textContent: spec.section }));
    if (spec.name === 'den' && byName.num) continue;
    if (spec.name === 'num' && byName.den) {
      // the grid step as num / den beats, with the result shown
      const beats = el('span', { className: 'hint' });
      const showBeats = () => { beats.textContent = `= ${+(gen.params.num / gen.params.den).toFixed(3)} beat`; };
      const num = paramControl(spec, (v) => set('num', v)), den = paramControl(byName.den, (v) => set('den', v));
      updaters.num = (v) => { num.update(v); showBeats(); };
      updaters.den = (v) => { den.update(v); showBeats(); };
      const row = el('div', { className: 'row' }, num.control, '/', den.control, beats);
      fields.push(el('label', { textContent: spec.label ?? 'step' }), row);
      if (spec.show) conditional.push({ show: spec.show, els: [fields[fields.length - 2], row] });
      continue;
    }
    const c = paramControl(spec, (v) => set(spec.name, v), (on) => osc.send('/gen/learn', gen.id, spec.name, on ? 1 : 0));
    const label = el('label', { textContent: spec.label ?? spec.name });
    updaters[spec.name] = c.update;
    if (c.learning) learners[spec.name] = c.learning;
    if (c.refresh) refreshers.push(c.refresh);
    if (spec.show) conditional.push({ show: spec.show, els: [label, c.control] });
    fields.push(label, c.control);
  }

  const root = el('section', { className: 'card gen' },
    el('header', {},
      led,
      el('h2', { textContent: `${typeLabel(gen.type)} ${gen.id}` }),
      ...(specs.actions ?? []).map((a) => el('button', { className: 'power', textContent: a, onclick: () => osc.send('/gen/do', gen.id, a) })),
      power,
      el('button', { className: 'close', textContent: '×', title: 'Remove', onclick: () => osc.send('/gen/remove', gen.id) })),
    el('div', { className: 'fields' }, ...fields));

  return {
    root,
    refreshOutputs,
    refreshClocks: () => refreshers.forEach((f) => f()),
    render() {
      power.classList.toggle('on', gen.active);
      power.textContent = gen.active ? 'On' : 'Off';
      root.classList.toggle('active', gen.active);
      refreshOutputs();
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
