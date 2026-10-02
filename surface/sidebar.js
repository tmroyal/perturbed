// sidebar.js — the chord bar, clocks and outputs (the brain calls outputs "destinations").

// A sidebar row: a name, then its controls.
const namedRow = (className, name, ...rest) => el('div', { className }, el('span', { className: 'name', textContent: name }), ...rest);

// --- chord ---
function renderChord() {
  [...$('chord-mode').children].forEach((b) => setOn(b, b.dataset.mode === model.chord.mode));
  $('chord-arm').hidden = model.chord.mode !== 'arm';
  setOn($('chord-arm'), model.chord.armed, model.chord.armed ? 'Play a chord…' : 'Arm');
  $('chord-notes').textContent = model.chord.pitches.map(noteName).join('  ');
}
$('chord-arm').onclick = () => osc.send('/chord/arm', model.chord.armed ? 0 : 1);
[...$('chord-mode').children].forEach((b) => { b.onclick = () => osc.send('/chord/mode', b.dataset.mode); });
$('chord-clear').onclick = () => osc.send('/chord/clear');

// --- clocks: A is the main clock; B, C, ... run at a ratio or factor of it, or free. Rows update
// in place (so a dial keeps its drag); the list is rebuilt only when clocks come and go or a mode
// changes. ---
const clockRows = new Map();  // id -> { mode, root, update(c) }

function clockRow(c) {
  const set = (param, value) => osc.send('/clock/set', c.id, param, value);
  const mode = selectInput([['ratio', 'ratio'], ['factor', 'factor'], ['free', 'free']], (v) => set('mode', v));
  const tempo = el('span', { className: 'tempo' });
  let controls, show;
  if (c.mode === 'ratio') {
    const num = numberInput(1, 32, (v) => set('num', v)), den = numberInput(1, 32, (v) => set('den', v));
    controls = [num, '/', den];
    show = (c) => { if (!editing(num)) num.value = c.num; if (!editing(den)) den.value = c.den; };
  } else if (c.mode === 'factor') {
    const dial = rotary({ min: 0.25, max: 4, step: 0.0001, log: true, onChange: (v) => set('factor', v) });
    controls = ['×', dial.root];
    show = (c) => dial.set(c.factor);
  } else {
    const dial = rotary({ min: 20, max: 400, step: 0.1, onChange: (v) => set('bpm', v) });
    controls = [dial.root];
    show = (c) => dial.set(c.bpm);
  }
  const root = namedRow('clock', c.name, mode, ...controls, tempo,
    closeButton('Remove (its generators move to A)', () => osc.send('/clock/remove', c.id)));
  const update = (c) => { mode.value = c.mode; show(c); tempo.textContent = `${+c.tempo.toFixed(2)}`; };
  update(c);
  return { mode: c.mode, root, update };
}

const mainClockRow = () => namedRow('clock main', 'A', el('span', { className: 'unit', textContent: 'main' }),
  el('span', { className: 'tempo', textContent: `${+model.bpm.toFixed(2)}` }));
const renderMainClock = () => $('clocks').firstChild?.replaceWith(mainClockRow());

function renderClocks() {
  clockRows.clear();
  $('clocks').replaceChildren(mainClockRow(), ...[...model.clocks.values()].map((c) => {
    const row = clockRow(c);
    clockRows.set(c.id, row);
    return row.root;
  }));
  renderCards();
}
$('add-clock').onclick = () => osc.send('/clock/add');

function updateClock(c) {
  const row = clockRows.get(c.id);
  if (row && row.mode === c.mode) row.update(c); else renderClocks();
}

// --- outputs: made from Live's tracks (reported by the Perturbed Bridge), or by hand. An output
// and a Live track match when the track listens to the output's bus and channel. ---
const listensTo = (t, d) => t.port === d.port && (t.channel === d.channel || t.channel === 0);
const addOutput = (t) => osc.send('/dest/add', t.name, t.port, t.channel, t.instrument);

function renderOutputs() {
  $('outputs').replaceChildren(...[...model.dests.values()].map((d) => {
    const deaf = model.live && !model.live.some((t) => listensTo(t, d));
    return namedRow('output' + (deaf ? ' deaf' : ''), d.name,
      el('span', { className: 'route', textContent: `port ${d.port} · ch ${d.channel} · ${d.instrument}`, title: model.ports[d.port - 1] ?? '' }),
      deaf ? el('span', { className: 'warn', textContent: '!', title: `No Live track listens to port ${d.port} ch ${d.channel}` }) : '',
      closeButton('Remove', () => osc.send('/dest/remove', d.id)));
  }));
  renderLiveTracks();
  renderCards();
  renderGroupSummaries();
}

// Live's tracks that aren't outputs yet (a track on "All Channels" can't be one: it needs a channel).
function renderLiveTracks() {
  const dests = [...model.dests.values()];
  const fresh = (model.live ?? []).filter((t) => !dests.some((d) => d.port === t.port && d.channel === t.channel));
  const addable = fresh.filter((t) => t.channel > 0);
  $('live-tracks').replaceChildren(...fresh.map((t) => namedRow('output live', t.name,
    el('span', { className: 'route', textContent: t.channel ? `port ${t.port} · ch ${t.channel} · ${t.instrument || 'no instrument'}` : 'all channels: pick one in Live' }),
    t.channel ? el('button', { className: 'add', textContent: '+', title: 'Add as an output', onclick: () => addOutput(t) }) : '')));
  $('live-head').hidden = fresh.length === 0;
  $('live-add-all').hidden = addable.length < 2;
  $('live-add-all').onclick = () => addable.forEach(addOutput);
  $('live-hint').textContent = model.live === null
    ? 'Live not connected: put the Perturbed Bridge on a track to see its tracks here.'
    : 'New sound: a Live MIDI track with MIDI From an IAC bus and a free channel, Monitor In.';
}

function renderPorts() {
  $('output-port').replaceChildren(...model.ports.map((name, i) => Object.assign(new Option(`port ${i + 1}`, i + 1), { title: name })));
}
$('output-channel').append(...Array.from({ length: 16 }, (_, i) => new Option(`ch ${i + 1}`, i + 1)));

$('output-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('output-name').value.trim() || `Output ${model.dests.size + 1}`;
  osc.send('/dest/add', name, parseInt($('output-port').value), parseInt($('output-channel').value), $('output-inst').value.trim());
  $('output-name').value = '';
});
