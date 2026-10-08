// library.js — the add bar and the Library, a panel in the dock (sidebar.js). The Library lists
// every generator type, built-in and AdHoc (written by Claude for a piece), with ☆/★ for favorites
// (the add bar), + Add (loading the type first if needed), Reload when a type's file changed since it
// was loaded, and × to delete an AdHoc type (the file moves to adhoc/old/, so it can come back).
// Favorites first, then built-ins, then AdHoc types newest first; the search box narrows them by
// name or description. The brain owns the library (brain/core/library.scd).
let pendingAdd = null; // a type being loaded, to add once it's in (/adhoc/loaded)

function addFromLibrary(t) {
  if (t.loaded) osc.send('/gen/add', t.name);
  else {
    pendingAdd = t.name;
    osc.send('/adhoc/load', t.name);
  }
}
function typeLoaded(name) {
  if (pendingAdd === name) {
    pendingAdd = null;
    osc.send('/gen/add', name);
  }
}

function libraryRow(t) {
  return el(
    'div',
    { className: 'lib-row' },
    setOn(
      el('button', {
        className: 'star',
        title: t.favorite ? 'Unstar (off the add bar)' : 'Star (on the add bar)',
        onclick: () => osc.send('/favorite', t.name, t.favorite ? 0 : 1),
      }),
      t.favorite,
      t.favorite ? '★' : '☆',
    ),
    el('span', { className: 'lib-name', textContent: typeLabel(t.name) }),
    t.changed
      ? el('button', {
          className: 'reload',
          textContent: 'Reload',
          title: 'Its file changed since it was loaded: load the new version (settings kept)',
          onclick: () => osc.send('/adhoc/load', t.name),
        })
      : '',
    el('button', { className: 'add', textContent: '+ Add', onclick: () => addFromLibrary(t) }),
    t.builtin
      ? ''
      : closeButton('Delete from the library (kept in adhoc/old/)', () => {
          if (confirm(`Delete ${typeLabel(t.name)} from the library?\n\nIts file moves to adhoc/old/, so it can be brought back.`))
            osc.send('/adhoc/delete', t.name);
        }),
    el('span', { className: 'hint', textContent: t.description || (t.builtin ? 'built-in' : ''), title: t.description }),
  );
}

function renderLibrary() {
  const all = [...model.library.values()];
  // the add bar: a button per favorite (and per type loaded this session), and + Group
  const bar = all.filter((t) => t.bar).sort((a, b) => b.builtin - a.builtin || byName(a, b));
  $('add-gen').replaceChildren(
    ...bar.map((t) =>
      el('button', { textContent: `+ ${typeLabel(t.name)}`, title: t.description, onclick: () => osc.send('/gen/add', t.name) }),
    ),
    el('button', {
      textContent: '+ Group',
      title: 'A group: switch, solo and fold away several generators at once',
      onclick: () => osc.send('/group/add'),
    }),
  );

  const query = $('library-search').value.trim().toLowerCase();
  const found = all.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(query));
  const section = (title, list) =>
    list.length ? [el('div', { className: 'lib-section', textContent: title }), ...list.map(libraryRow)] : [];
  $('library-list').replaceChildren(
    ...section('Favorites', found.filter((t) => t.favorite).sort(byName)),
    ...section('Built-in', found.filter((t) => !t.favorite && t.builtin).sort(byName)),
    ...section(
      'AdHoc',
      found.filter((t) => !t.favorite && !t.builtin).sort((a, b) => b.mtime - a.mtime),
    ),
    ...(found.length ? [] : [el('p', { className: 'hint', textContent: 'Nothing matches.' })]),
    ...(all.some((t) => !t.builtin) ? [] : [el('p', { className: 'hint', textContent: 'No AdHoc types yet: ask Claude for one.' })]),
  );
}
$('library-search').addEventListener('input', renderLibrary);
