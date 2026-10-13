// groups.js — generator groups on the surface: a section per group, with a header to rename it,
// switch it (On/Off), solo it, add to it, fold it away and remove it. A group can have globals of its
// own on its header (globals.js): one control for many of its generators' settings. Folded, a group shows only its
// header, a summary (one light per member, flashing on its notes, and its outputs) and its pins:
// member settings pinned from the strips (right-click a setting's name), the controls played live. The brain
// owns all of it, folding included (it's saved with the performance).

// Whether a generator sounds (mirrors the brain's ~sounds in core/groups.scd).
function sounds(gen) {
  const gr = model.groups.get(gen.group);
  const anySolo = [...model.groups.values()].some((g) => g.solo);
  return gen.active && (!gr || gr.on) && (!anySolo || (gr?.solo ?? false));
}

const groupBodies = new Map(); // group id -> the grid its cards go in
const summaryLeds = new Map(); // gen id -> its light in a folded group's summary
const summaries = new Map(); // group id -> summary element
const groupGlobals = new Map(); // group id -> where its own globals go on its header (globals.js fills it)
const pinUpdaters = new Map(); // "genId:param" -> update(value) of its pinned control
const updatePin = (genId, param, value) => pinUpdaters.get(`${genId}:${param}`)?.(value);

const isPinned = (gen, param) => model.groups.get(gen.group)?.pins.some(([id, p]) => id === gen.id && p === param) ?? false;
function togglePin(gen, param) {
  if (gen.group) osc.send(isPinned(gen, param) ? '/group/unpin' : '/group/pin', gen.group, gen.id, param);
}

// The pinned controls under a group's header: the same control as on the card, labelled.
function pinRow(g) {
  const row = el('div', { className: 'group-pins' });
  for (const [genId, param] of g.pins) {
    const gen = model.gens.get(genId),
      spec = gen && specOf(gen.type, param);
    if (!spec) continue;
    const c = paramControl(spec, genId);
    c.update(gen.params[param]);
    pinUpdaters.set(`${genId}:${param}`, c.update);
    row.append(
      el(
        'div',
        { className: 'pin cell' },
        // the setting's own name: a strip's labels ("value", "from") rely on its sections for context
        el('label', { textContent: `${genName(gen)} · ${param}` }),
        c.control,
        closeButton('Unpin', () => osc.send('/group/unpin', g.id, genId, param)),
      ),
    );
  }
  return row;
}

// Puts a card in its group's grid (or the ungrouped one).
function placeCard(gen) {
  if (!gen.card) return;
  const grid = groupBodies.get(gen.group) ?? $('ungrouped');
  gen.card.root.dataset.order = gen.order;
  grid.append(gen.card.root);
  // the brain's order (the performer's: cards can be dragged)
  for (const card of [...grid.children].sort((a, b) => a.dataset.order - b.dataset.order)) grid.append(card);
}

// Dropping a dragged card on a group's area or header (or the ungrouped area) moves it to the end
// of that group; dropping on a card (generators.js) puts it next to that card.
function dropZone(target, groupId) {
  target.addEventListener('dragover', (e) => {
    if (draggingGen === null) return;
    e.preventDefault();
    target.classList.add('drop-here');
  });
  target.addEventListener('dragleave', () => target.classList.remove('drop-here'));
  target.addEventListener('drop', (e) => {
    if (draggingGen === null) return;
    e.preventDefault();
    target.classList.remove('drop-here');
    osc.send('/gen/move', draggingGen, 0, groupId);
  });
}

// A colour per group (its name and rail), in the order the groups come.
const GROUP_COLORS = ['#88C0D0', '#EBCB8B', '#B48EAD', '#8FBCBB', '#D08770', '#81A1C1'];

function groupSection(g, i) {
  const set = (key, value) => osc.send('/group/set', g.id, key, value);
  const flip = (key) => () => set(key, g[key] ? 0 : 1);
  const name = el('input', { type: 'text', className: 'group-name', value: g.name, title: 'Rename' });
  name.addEventListener('change', () => set('name', name.value.trim() || g.name));
  blurOnEnter(name);
  const summary = el('div', { className: 'group-summary' });
  summaries.set(g.id, summary);
  const body = el('div', { className: 'gen-grid' });
  groupBodies.set(g.id, body);
  const globals = el('div', { className: 'group-globals' });
  groupGlobals.set(g.id, globals);
  const addGlobal = () => osc.send('/global/add', '', g.id);
  body.hidden = g.collapsed;
  dropZone(body, g.id);
  // right-click on the header: rename, fold, add into, remove
  const head = el('header', { className: 'group-head' });
  dropZone(head, g.id); // a folded group takes cards on its header
  head.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, select')) return;
    contextMenu(e, [
      [
        'Rename',
        () => {
          name.focus();
          name.select();
        },
      ],
      switchKeyItem('group', g),
      ['Add a global for this group', addGlobal],
      [g.collapsed ? 'Unfold' : 'Fold', () => set('collapsed', g.collapsed ? 0 : 1)],
      [g.on ? 'Turn off' : 'Turn on', () => set('on', g.on ? 0 : 1)],
      [g.solo ? 'Unsolo' : 'Solo', () => set('solo', g.solo ? 0 : 1)],
      ['Remove (keep its generators)', () => osc.send('/group/remove', g.id)],
    ]);
  });
  head.append(
    el('button', {
      className: 'fold',
      textContent: g.collapsed ? '▸' : '▾',
      title: g.collapsed ? 'Unfold' : 'Fold away',
      onclick: flip('collapsed'),
    }),
    name,
    switchKeyTag('group', g),
    summary,
    pinRow(g),
    globals,
    // kept together at the right, however the pins and globals wrap
    el(
      'div',
      { className: 'group-tools' },
      addInto(g),
      setOn(
        el('button', { className: 'power', title: 'Switch the group (a mute: it keeps time)', onclick: flip('on') }),
        g.on,
        g.on ? 'On' : 'Off',
      ),
      setOn(el('button', { className: 'solo', textContent: 'Solo', title: 'Only soloed groups sound', onclick: flip('solo') }), g.solo),
      closeButton('Remove the group (its generators stay)', () => osc.send('/group/remove', g.id)),
    ),
  );
  const root = el('section', { className: `group${g.collapsed ? ' collapsed' : ''}${g.on ? '' : ' off'}` }, head, body);
  root.style.setProperty('--gc', GROUP_COLORS[i % GROUP_COLORS.length]);
  return root;
}

// "+": a menu of generator types; picking one adds it straight into the group.
function addInto(g) {
  const sel = el('select', { className: 'add-into', title: 'Add a generator to this group' });
  sel.add(new Option('+', ''));
  for (const type of model.types.keys()) sel.add(new Option(typeLabel(type), type));
  // and a global of its own: one control on the header for many of its generators' settings
  sel.add(new Option('Global (a control for this group)', '+global'));
  sel.addEventListener('change', () => {
    if (sel.value === '+global') osc.send('/global/add', '', g.id);
    else if (sel.value) osc.send('/gen/add', sel.value, g.id);
    sel.value = '';
    if (g.collapsed) osc.send('/group/set', g.id, 'collapsed', 0); // show what was added
  });
  return sel;
}

// Rebuilds the sections; cards are moved, not rebuilt.
function renderGroups() {
  groupBodies.clear();
  groupGlobals.clear();
  summaries.clear();
  pinUpdaters.clear();
  const ungrouped = el('div', { className: 'gen-grid', id: 'ungrouped' });
  dropZone(ungrouped, 0);
  $('grid').replaceChildren(ungrouped, ...[...model.groups.values()].map((g, i) => groupSection(g, i)));
  model.gens.forEach((gen) => {
    placeCard(gen);
    gen.card?.render();
  });
  renderGroupSummaries();
  renderGlobals(); // the groups' own globals go back on the new headers
}

function renderGroupSummaries() {
  summaryLeds.clear();
  for (const [id, summary] of summaries) {
    const g = model.groups.get(id);
    const members = [...model.gens.values()].filter((gen) => gen.group === id);
    const outputs = [...new Set(members.map((gen) => model.dests.get(gen.dest)?.name).filter(Boolean))];
    summary.replaceChildren(
      ...(g?.collapsed
        ? [
            ...members.map((gen) => {
              const led = el('span', { className: `led${gen.active ? ' on' : ''}`, title: `${genName(gen)}${gen.active ? '' : ' (off)'}` });
              summaryLeds.set(gen.id, led);
              return led;
            }),
            el('span', { className: 'hint', textContent: outputs.join(', ') || (members.length ? '' : 'empty') }),
          ]
        : []),
    );
  }
  $('grid').classList.toggle('empty', !model.gens.size && !model.groups.size);
}

const flashSummary = (genId) => flash(summaryLeds.get(genId));
