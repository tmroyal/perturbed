// Electron main process: owns the UDP socket (57130) and translates between OSC and the renderer.
const { app, BrowserWindow, ipcMain } = require('electron');
const dgram = require('dgram');
const path = require('path');

const SC = { host: '127.0.0.1', port: 57120 };
const LISTEN_PORT = 57130;

const { encode, decode } = require('./osc');

// --- app ---
const sock = dgram.createSocket('udp4');
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
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
