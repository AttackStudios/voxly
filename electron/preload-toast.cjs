const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toastApi', {
  onData: (cb) => ipcRenderer.on('toast:data', (_e, data) => cb(data)),
  action: (payload) => ipcRenderer.send('toast:action', payload),
  hideIfEmpty: () => ipcRenderer.send('toast:hide-if-empty'),
});
