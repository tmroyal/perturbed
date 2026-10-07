// transport.js — play/stop, main tempo, metric modulation, beat display, save/open.
const togglePlay = () => osc.send('/transport/play', model.playing ? 0 : 1);
$('play').onclick = togglePlay;
document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range'; // TEXTAREA: the terminal
  if (e.code === 'Space' && !typing) {
    e.preventDefault();
    $('play').blur();
    togglePlay();
  }
});

const tempoDial = rotary({ min: 20, max: 400, step: 0.1, size: 44, onChange: (bpm) => osc.send('/transport/tempo', bpm) });
$('tempo').append(tempoDial.root);

// Metric modulation: tempo × num/den; swap gives the reciprocal, so two clicks go there and back.
const modFraction = () => [Math.max(1, parseInt($('mod-num').value, 10) || 1), Math.max(1, parseInt($('mod-den').value, 10) || 1)];
function renderMod() {
  const [num, den] = modFraction();
  $('mod-apply').textContent = `→ ${+((model.bpm * num) / den).toFixed(1)}`;
}
['mod-num', 'mod-den'].forEach((id) => {
  $(id).addEventListener('input', renderMod);
  blurOnEnter($(id));
});
$('mod-swap').onclick = () => {
  [$('mod-num').value, $('mod-den').value] = [$('mod-den').value, $('mod-num').value];
  renderMod();
};
$('mod-apply').onclick = () => osc.send('/transport/scale', ...modFraction());

// Beat display: a pulse on every beat and the beat count (no bar grouping; there's no metre).
function showBeat(b) {
  $('beat').textContent = b >= 0 ? b + 1 : '';
  if (b >= 0) flash($('pulse'), 180);
}

function renderTransport() {
  setOn($('play'), model.playing, model.playing ? 'Stop' : 'Play');
  if (!model.playing) showBeat(-1);
  tempoDial.set(model.bpm);
  renderMod();
}

// New and Open replace the performance: asked first when it has unsaved changes (the brain knows).
// The brain writes and reads the file; the surface only picks the path. Save goes to the
// performance's file (asking for one the first time); Save As always asks.
const fileName = () =>
  model.file
    ? model.file
        .split('/')
        .pop()
        .replace(/\.json$/, '')
    : 'Untitled';
const saveAs = async () => {
  const p = await files.pick('save', model.file);
  if (p) osc.send('/save', p);
};
const save = () => (model.file ? osc.send('/save') : saveAs());
const newPerformance = () => {
  if (!model.unsaved || confirm('Start a new, empty performance?\n\nChanges since the last save are lost.')) osc.send('/new');
};
const open = async () => {
  if (model.unsaved && !confirm('Open another performance?\n\nChanges since the last save are lost.')) return;
  const p = await files.pick('load');
  if (p) osc.send('/load', p);
};
$('new').onclick = newPerformance;
$('save').onclick = save;
$('save-as').onclick = saveAs;
$('load').onclick = open;

// ⌘S save, ⌘⇧S save as, ⌘O open, ⌘N new (from anywhere, the Claude drawer included)
document.addEventListener('keydown', (e) => {
  if (!e.metaKey || e.altKey || e.ctrlKey) return;
  const action = { s: e.shiftKey ? saveAs : save, o: open, n: newPerformance }[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault();
  action();
});

// The file's name in the window title and on the Save button's tooltip; a dot while unsaved.
function renderFile() {
  document.title = `${model.unsaved ? '• ' : ''}${fileName()} — Perturbed`;
  $('save').classList.toggle('unsaved', !!model.unsaved);
  $('save').title =
    `${model.file ? `Save to ${fileName()}.json` : 'Save (asks for a name)'} (⌘S)${model.unsaved ? ': there are unsaved changes' : ''}`;
}
