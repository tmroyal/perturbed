const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('osc', {
  send: (addr, ...args) => ipcRenderer.send('osc', addr, args),
  on: (fn) => ipcRenderer.on('osc', (_e, msg) => fn(msg)),
});

contextBridge.exposeInMainWorld('shell', {
  start: (cols, rows) => ipcRenderer.send('term:start', cols, rows),
  input: (data) => ipcRenderer.send('term:input', data),
  resize: (cols, rows) => ipcRenderer.send('term:resize', cols, rows),
  onData: (fn) => ipcRenderer.on('term:data', (_e, d) => fn(d)),
  onExit: (fn) => ipcRenderer.on('term:exit', () => fn()),
});

contextBridge.exposeInMainWorld('files', {
  pick: (mode) => ipcRenderer.invoke('pick-file', mode), // 'save' | 'load' → path or null
});
