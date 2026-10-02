// terminal.js — the Claude drawer: Claude Code in a terminal at the bottom of the window (xterm.js
// here, a pty in main.js). The Claude button or ⌘` toggles it; drag its top edge to resize. The
// session starts the first time it opens and keeps running while closed.
const NORD_TERM = {
  background: '#2E3440', foreground: '#D8DEE9', cursor: '#D8DEE9', selectionBackground: '#434C5E',
  black: '#3B4252', red: '#BF616A', green: '#A3BE8C', yellow: '#EBCB8B', blue: '#81A1C1', magenta: '#B48EAD', cyan: '#88C0D0', white: '#E5E9F0',
  brightBlack: '#4C566A', brightRed: '#BF616A', brightGreen: '#A3BE8C', brightYellow: '#EBCB8B', brightBlue: '#81A1C1', brightMagenta: '#B48EAD', brightCyan: '#8FBCBB', brightWhite: '#ECEFF4',
};
let term = null, fit = null, ended = false;

function startSession() {
  ended = false;
  shell.start(term.cols, term.rows);
}

function setDrawer(open) {
  $('drawer').hidden = !open;
  document.body.classList.toggle('drawer-open', open);
  $('claude').classList.toggle('on', open);
  if (!open) return;
  if (!term) {
    term = new Terminal({ fontFamily: 'Menlo, monospace', fontSize: 13, theme: NORD_TERM, cursorBlink: true, allowProposedApi: true });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open($('term'));
    term.onData((d) => { if (ended) startSession(); else shell.input(d); });
    term.onResize(({ cols, rows }) => shell.resize(cols, rows));
    shell.onData((d) => term.write(d));
    shell.onExit(() => { ended = true; term.write('\r\n\x1b[90m[session ended: press any key to start again]\x1b[0m\r\n'); });
    fit.fit();
    startSession();
  } else fit.fit();
  term.focus();
}
const toggleDrawer = () => setDrawer($('drawer').hidden);

$('claude').onclick = toggleDrawer;
document.addEventListener('keydown', (e) => {
  if (e.metaKey && e.key === '`') { e.preventDefault(); toggleDrawer(); }
});
window.addEventListener('resize', () => { if (term && !$('drawer').hidden) fit.fit(); });

// drag the top edge to resize (height kept as a CSS variable, so the page can make room)
$('drawer-handle').addEventListener('pointerdown', (e) => drag(e.currentTarget, e, (m) => {
  const h = Math.min(window.innerHeight - 120, Math.max(120, window.innerHeight - m.clientY));
  document.documentElement.style.setProperty('--drawer-h', `${h}px`);
  fit?.fit();
}));
