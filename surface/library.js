// library.js — the add bar and the Library menu. The menu lists every generator type, built-in and
// AdHoc (written by Claude for a piece), with ☆/★ for favorites (the add bar), + Add (loading the
// type first if needed), Reload when a type's file changed since it was loaded, and Delete for AdHoc
// types (the file moves to adhoc/old/, so it can come back). Favorites first, then built-ins, then
// AdHoc types newest first. The brain owns the library (brain/core/library.scd).
let pendingAdd = null;  // a type being loaded, to add once it's in (/adhoc/loaded)

function addFromLibrary(t) {
  if (t.loaded) osc.send('/gen/add', t.name);
  else { pendingAdd = t.name; osc.send('/adhoc/load', t.name); }
  setLibrary(false);
}
function typeLoaded(name) {
  if (pendingAdd === name) { pendingAdd = null; osc.send('/gen/add', name); }
}

function libraryRow(t) {
  return el('div', { className: 'lib-row' },
    setOn(el('button', { className: 'star', title: t.favorite ? 'Unstar (off the add bar)' : 'Star (on the add bar)',
      onclick: () => osc.send('/favorite', t.name, t.favorite ? 0 : 1) }), t.favorite, t.favorite ? '★' : '☆'),
    el('div', { className: 'lib-text' },
      el('span', { className: 'lib-name', textContent: typeLabel(t.name) }),
      el('span', { className: 'hint', textContent: t.description || (t.builtin ? 'built-in' : '') })),
    t.changed ? el('button', { className: 'reload', textContent: 'Reload', title: 'Its file changed since it was loaded: load the new version (settings kept)',
      onclick: () => osc.send('/adhoc/load', t.name) }) : '',
    el('button', { className: 'add', textContent: '+ Add', onclick: () => addFromLibrary(t) }),
    t.builtin ? el('span', { className: 'lib-spacer' }) : closeButton('Delete from the library (kept in adhoc/old/)',
      () => { if (confirm(`Delete ${typeLabel(t.name)} from the library?\n\nIts file moves to adhoc/old/, so it can be brought back.`)) osc.send('/adhoc/delete', t.name); }));
}

function renderLibrary() {
  const all = [...model.library.values()];
  // the add bar: a button per favorite (and per type loaded this session), + Group, and the Library
  const bar = all.filter((t) => t.bar).sort((a, b) => b.builtin - a.builtin || byName(a, b));
  $('add-gen').replaceChildren(...bar.map((t) =>
    el('button', { textContent: `+ ${typeLabel(t.name)}`, title: t.description, onclick: () => osc.send('/gen/add', t.name) })),
  el('button', { textContent: '+ Group', title: 'A group: switch, solo and fold away several generators at once', onclick: () => osc.send('/group/add') }),
  el('button', { id: 'library-button', textContent: 'Library ▾', title: 'Every generator type: star favorites for the add bar, bring back old ones', onclick: toggleLibrary }));

  const section = (title, list) => (list.length ? [el('div', { className: 'lib-section', textContent: title }), ...list.map(libraryRow)] : []);
  $('library').replaceChildren(
    ...section('Favorites', all.filter((t) => t.favorite).sort(byName)),
    ...section('Built-in', all.filter((t) => !t.favorite && t.builtin).sort(byName)),
    ...section('AdHoc', all.filter((t) => !t.favorite && !t.builtin).sort((a, b) => b.mtime - a.mtime)),
    ...(all.some((t) => !t.builtin) ? [] : [el('p', { className: 'hint', textContent: 'No AdHoc types yet: ask Claude for one.' })]));
}

function setLibrary(open) {
  $('library').hidden = !open;
  $('library-button')?.classList.toggle('on', open);
  if (open) osc.send('/library/rescan');  // pick up files Claude just wrote
}
const toggleLibrary = () => setLibrary($('library').hidden);
document.addEventListener('pointerdown', (e) => {
  if (!$('library').hidden && !$('library').contains(e.target) && e.target.id !== 'library-button') setLibrary(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setLibrary(false); });
