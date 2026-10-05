const { app, BrowserWindow, ipcMain, screen: eScreen, desktopCapturer, session, systemPreferences } = require('electron');
const path = require('path');
const { fork } = require('child_process');

app.setName('Voxly');
const DEV_URL = process.env.DC_URL || 'http://localhost:5173';
let mainWindow = null;
let toastWindow = null;
let serverProc = null;

// In a packaged build there's no `npm run server`, so the app starts its own
// backend (writing data to the OS user-data folder) and the bundled web build
// talks to it on localhost:3001.
function startBundledServer() {
  if (!app.isPackaged) return;
  const dataDir = path.join(app.getPath('userData'), 'data');
  serverProc = fork(path.join(__dirname, '..', 'server', 'index.js'), [], {
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: '3001', DC_DATA_DIR: dataDir,
      // first-run account so the standalone app is loginable (change it in-app after)
      DC_SEED_OWNER: process.env.DC_SEED_OWNER || 'owner@voxly.local::voxly123::Owner',
    },
    stdio: 'inherit',
  });
  serverProc.on('error', (e) => console.error('[server] failed to start:', e.message));
}

// ---- main window ----
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 940, minHeight: 560,
    backgroundColor: '#313338', title: 'Voxly',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL(app.isPackaged ? `file://${path.join(__dirname, '..', 'dist', 'index.html')}` : DEV_URL);
  mainWindow.setTitle('Voxly');
  mainWindow.on('closed', () => { mainWindow = null; });

  // grant camera/mic/screen requests coming from our own trusted renderer
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  // auto-grant screen capture (for screen share / remote help)
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    });
  }, { useSystemPicker: true });
}

// ---- native bottom-right toast window ----
function createToastWindow() {
  const { width, height } = eScreen.getPrimaryDisplay().workAreaSize;
  const W = 380, H = 420;
  toastWindow = new BrowserWindow({
    width: W, height: H, x: width - W - 16, y: height - H - 16,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, focusable: true, show: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload-toast.cjs'), contextIsolation: true },
  });
  toastWindow.loadFile(path.join(__dirname, 'toast.html'));
  // float above EVERY other app, including other always-on-top windows and
  // fullscreen apps/spaces (default 'floating' level sits below many apps).
  toastWindow.setAlwaysOnTop(true, 'screen-saver');
  toastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

app.whenReady().then(async () => {
  // macOS dock icon (in dev the dock shows the Electron.app bundle icon otherwise)
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, 'icon.png')); } catch {}
  }
  startBundledServer();
  // macOS: must request camera/mic from the MAIN process or getUserMedia returns
  // a track that produces only black/silent frames (TCC quirk).
  if (process.platform === 'darwin') {
    for (const m of ['camera', 'microphone']) {
      try {
        const status = systemPreferences.getMediaAccessStatus(m);
        if (status !== 'granted') {
          const ok = await systemPreferences.askForMediaAccess(m);
          console.log(`[media] ${m} access:`, ok ? 'granted' : 'denied (enable in System Settings → Privacy)');
        }
      } catch (e) { console.warn(`[media] ${m} request failed:`, e.message); }
    }
  }
  createMainWindow();
  createToastWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (serverProc) { try { serverProc.kill(); } catch {} } });

// ---- IPC ----
ipcMain.on('toast:show', (_e, data) => {
  if (!toastWindow || toastWindow.isDestroyed()) createToastWindow();
  // re-assert the floating level and lift above the currently-focused app
  toastWindow.setAlwaysOnTop(true, 'screen-saver');
  toastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  toastWindow.showInactive();
  toastWindow.moveTop();
  toastWindow.webContents.send('toast:data', data);
});
ipcMain.on('toast:hide-if-empty', () => { if (toastWindow) toastWindow.hide(); });
ipcMain.on('toast:action', (_e, payload) => {
  // relay reply/call/open from the toast window to the main app
  if (mainWindow) mainWindow.webContents.send('toast:action', payload);
  if (payload.action === 'open' && mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
