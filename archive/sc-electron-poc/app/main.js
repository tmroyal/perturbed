// Electron main process: owns the UDP socket and translates between OSC and the renderer.
const { app, BrowserWindow, ipcMain } = require('electron');
const dgram = require('dgram');
const path = require('path');

const SC = { host: '127.0.0.1', port: 57120 };
const LISTEN_PORT = 57130;

// --- minimal OSC (int32, float32, string) ---
function oscStr(s) {
  const b = Buffer.from(s + '\0');
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}

function encode(addr, args = []) {
  let tags = ',';
  const data = args.map((a) => {
    if (typeof a === 'number' && Number.isInteger(a)) { tags += 'i'; const b = Buffer.alloc(4); b.writeInt32BE(a); return b; }
    if (typeof a === 'number') { tags += 'f'; const b = Buffer.alloc(4); b.writeFloatBE(a); return b; }
    tags += 's'; return oscStr(String(a));
  });
  return Buffer.concat([oscStr(addr), oscStr(tags), ...data]);
}

function readStr(buf, off) {
  const end = buf.indexOf(0, off);
  return [buf.toString('utf8', off, end), (end + 4) & ~3];
}

function decode(buf) {
  let [addr, off] = readStr(buf, 0);
  let tags;
  [tags, off] = readStr(buf, off);
  const args = [];
  for (const t of tags.slice(1)) {
    if (t === 'i') { args.push(buf.readInt32BE(off)); off += 4; }
    else if (t === 'f') { args.push(buf.readFloatBE(off)); off += 4; }
    else if (t === 's') { let s; [s, off] = readStr(buf, off); args.push(s); }
  }
  return { addr, args };
}

// --- app ---
const sock = dgram.createSocket('udp4');
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 640,
    backgroundColor: '#2E3440',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('index.html');
}

ipcMain.on('osc', (_e, addr, args) => sock.send(encode(addr, args), SC.port, SC.host));

sock.on('message', (msg) => {
  try { win?.webContents.send('osc', decode(msg)); } catch (e) { console.error('bad OSC', e); }
});
sock.bind(LISTEN_PORT);

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
