const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('osc', {
  send: (addr, ...args) => ipcRenderer.send('osc', addr, args),
  on: (fn) => ipcRenderer.on('osc', (_e, msg) => fn(msg)),
});

contextBridge.exposeInMainWorld('files', {
  pick: (mode) => ipcRenderer.invoke('pick-file', mode),  // 'save' | 'load' → path or null
});
