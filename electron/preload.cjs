const { contextBridge, ipcRenderer } = require('electron');

// Bridge exposed to the main web app inside Electron.
contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  showToast: (data) => ipcRenderer.send('toast:show', data),
  // main app listens for actions taken inside the native toast (reply/call/open)
  onToastAction: (cb) => ipcRenderer.on('toast:action', (_e, payload) => cb(payload)),
});
