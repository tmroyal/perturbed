// groups.js — generator groups on the surface: a section per group, with a header to rename it,
// switch it (On/Off), solo it, fold it away and remove it. Folded, a group shows only its header and
// a summary: one light per member (flashing on its notes) and the outputs it plays into. The brain
// owns all of it, folding included (it's saved with the performance).

// Whether a generator sounds (mirrors the brain's ~sounds in core/groups.scd).
function sounds(gen) {
  const gr = model.groups.get(gen.group);
  const anySolo = [...model.groups.values()].some((g) => g.solo);
  return gen.active && (!gr || gr.on) && (!anySolo || (gr?.solo ?? false));
}

const groupBodies = new Map();    // group id -> the grid its cards go in
const summaryLeds = new Map();    // gen id -> its light in a folded group's summary
const summaries = new Map();      // group id -> summary element

// Puts a card in its group's grid (or the ungrouped one).
function placeCard(gen) {
  if (gen.card) (groupBodies.get(gen.group) ?? $('ungrouped')).append(gen.card.root);
}

function groupSection(g) {
  const set = (key, value) => osc.send('/group/set', g.id, key, value);
  const name = el('input', { type: 'text', className: 'group-name', value: g.name, title: 'Rename' });
  name.addEventListener('change', () => set('name', name.value.trim() || g.name));
  blurOnEnter(name);
  const summary = el('div', { className: 'group-summary' });
  summaries.set(g.id, summary);
  const body = el('div', { className: 'gen-grid' });
  groupBodies.set(g.id, body);
  body.hidden = g.collapsed;
  return el('section', { className: `group${g.collapsed ? ' collapsed' : ''}${g.on ? '' : ' off'}` },
    el('header', { className: 'group-head' },
      el('button', { className: 'fold', textContent: g.collapsed ? '▸' : '▾', title: g.collapsed ? 'Unfold' : 'Fold away', onclick: () => set('collapsed', g.collapsed ? 0 : 1) }),
      name,
      summary,
      addInto(g),
      el('button', { className: `power${g.on ? ' on' : ''}`, textContent: g.on ? 'On' : 'Off', title: 'Switch the group (a mute: it keeps time)', onclick: () => set('on', g.on ? 0 : 1) }),
      el('button', { className: `solo${g.solo ? ' on' : ''}`, textContent: 'Solo', title: 'Only soloed groups sound', onclick: () => set('solo', g.solo ? 0 : 1) }),
      el('button', { className: 'close', textContent: '×', title: 'Remove the group (its generators stay)', onclick: () => osc.send('/group/remove', g.id) })),
    body);
}

// "+": a menu of generator types; picking one adds it straight into the group.
function addInto(g) {
  const sel = el('select', { className: 'add-into', title: 'Add a generator to this group' });
  sel.add(new Option('+', ''));
  for (const type of model.types.keys()) sel.add(new Option(typeLabel(type), type));
  sel.addEventListener('change', () => {
    if (sel.value) osc.send('/gen/add', sel.value, g.id);
    sel.value = '';
    if (g.collapsed) osc.send('/group/set', g.id, 'collapsed', 0);  // show what was added
  });
  return sel;
}

// Rebuilds the sections; cards are moved, not rebuilt.
function renderGroups() {
  groupBodies.clear(); summaries.clear();
  $('grid').replaceChildren(el('div', { className: 'gen-grid', id: 'ungrouped' }), ...[...model.groups.values()].map(groupSection));
  model.gens.forEach((gen) => { placeCard(gen); gen.card?.render(); });
  renderGroupSummaries();
}
const updateGroup = renderGroups;

function renderGroupSummaries() {
  summaryLeds.clear();
  for (const [id, summary] of summaries) {
    const g = model.groups.get(id);
    const members = [...model.gens.values()].filter((gen) => gen.group === id);
    const outputs = [...new Set(members.map((gen) => model.dests.get(gen.dest)?.name).filter(Boolean))];
    summary.replaceChildren(...(g?.collapsed ? [
      ...members.map((gen) => {
        const led = el('span', { className: `led${gen.active ? ' on' : ''}`, title: `${typeLabel(gen.type)} ${gen.id}${gen.active ? '' : ' (off)'}` });
        summaryLeds.set(gen.id, led);
        return led;
      }),
      el('span', { className: 'hint', textContent: outputs.join(', ') || (members.length ? '' : 'empty') }),
    ] : []));
  }
  $('grid').classList.toggle('empty', !model.gens.size && !model.groups.size);
}

function flashSummary(genId) {
  summaryLeds.get(genId)?.animate([{ background: '#EBCB8B' }, { background: '#434C5E' }], { duration: 150 });
}
