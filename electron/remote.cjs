// Remote control — the controlled side. Runs in Electron's main process and
// injects mouse/keyboard input with nut-js, but ONLY between start() and stop(),
// which the renderer calls after the user clicked "Allow" in the consent dialog.
// While active: a small always-on-top bar shows who is in control with a Stop
// button, and Ctrl/Cmd+Shift+X stops it instantly from anywhere.
const { BrowserWindow, screen, globalShortcut, systemPreferences } = require('electron');

let nut = null;
try {
  nut = require('@nut-tree-fork/nut-js');
  nut.mouse.config.autoDelayMs = 0;
  nut.mouse.config.mouseSpeed = 100000;
  nut.keyboard.config.autoDelayMs = 0;
} catch (e) {
  console.warn('[remote] nut-js unavailable — remote control disabled:', e.message);
}

const PANIC = 'CommandOrControl+Shift+X';
let session = null;   // { display, peerName }
let bar = null;
let onStopped = () => {};
const held = { keys: new Set(), buttons: new Set() };
let lastShareDisplayId = null;

// Called from the display-media handler so control maps onto the shared screen.
function setShareDisplay(id) { lastShareDisplayId = id ? String(id) : null; }

function pickDisplay(hint) {
  const all = screen.getAllDisplays();
  const byId = lastShareDisplayId && all.find((d) => String(d.id) === lastShareDisplayId);
  if (byId) return byId;
  // otherwise match the shared video's aspect ratio
  if (hint?.w && hint?.h) {
    const r = hint.w / hint.h;
    const best = all.slice().sort((a, b) =>
      Math.abs(a.size.width / a.size.height - r) - Math.abs(b.size.width / b.size.height - r))[0];
    if (best) return best;
  }
  return screen.getPrimaryDisplay();
}

// browser KeyboardEvent.code -> nut-js Key name
const CODE_TO_KEY = {
  Escape: 'Escape', Backspace: 'Backspace', Tab: 'Tab', Enter: 'Enter', Space: 'Space',
  ShiftLeft: 'LeftShift', ShiftRight: 'RightShift', ControlLeft: 'LeftControl', ControlRight: 'RightControl',
  AltLeft: 'LeftAlt', AltRight: 'RightAlt', MetaLeft: 'LeftSuper', MetaRight: 'RightSuper', CapsLock: 'CapsLock',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
  Minus: 'Minus', Equal: 'Equal', BracketLeft: 'LeftBracket', BracketRight: 'RightBracket', Backslash: 'Backslash',
  Semicolon: 'Semicolon', Quote: 'Quote', Backquote: 'Grave', Comma: 'Comma', Period: 'Period', Slash: 'Slash',
  NumpadEnter: 'Enter', NumpadAdd: 'Add', NumpadSubtract: 'Subtract', NumpadMultiply: 'Multiply',
  NumpadDivide: 'Divide', NumpadDecimal: 'Decimal', ContextMenu: 'Menu', PrintScreen: 'Print',
};
function keyFor(code) {
  if (!nut || typeof code !== 'string') return null;
  let name = CODE_TO_KEY[code];
  if (!name) {
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) name = m[1];
    else if ((m = /^Digit(\d)$/.exec(code))) name = 'Num' + m[1];
    else if ((m = /^Numpad(\d)$/.exec(code))) name = 'NumPad' + m[1];
    else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) name = code;
  }
  return name && nut.Key[name] !== undefined ? nut.Key[name] : null;
}
const BUTTONS = () => [nut.Button.LEFT, nut.Button.MIDDLE, nut.Button.RIGHT];

function toScreen(x, y) {
  const b = session.display.bounds;
  const clamp = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  let p = { x: Math.round(b.x + clamp(x) * (b.width - 1)), y: Math.round(b.y + clamp(y) * (b.height - 1)) };
  // Windows: nut-js works in physical pixels, Electron in DIPs
  if (process.platform === 'win32') p = screen.dipToScreenPoint(p);
  return new nut.Point(p.x, p.y);
}

// Inputs run one at a time so presses/releases never reorder.
let chain = Promise.resolve();
function input(ev) {
  if (!session || !nut || !ev) return;
  chain = chain.then(() => apply(ev)).catch((e) => console.warn('[remote] input failed:', e.message));
}
async function apply(ev) {
  if (!session) return;
  switch (ev.t) {
    case 'move': await nut.mouse.setPosition(toScreen(ev.x, ev.y)); break;
    case 'down': case 'up': {
      const btn = BUTTONS()[ev.b] ?? nut.Button.LEFT;
      if (ev.x !== undefined) await nut.mouse.setPosition(toScreen(ev.x, ev.y));
      if (ev.t === 'down') { held.buttons.add(btn); await nut.mouse.pressButton(btn); }
      else { held.buttons.delete(btn); await nut.mouse.releaseButton(btn); }
      break;
    }
    case 'wheel': {
      const dy = Math.max(-20, Math.min(20, Math.round(ev.dy || 0)));
      const dx = Math.max(-20, Math.min(20, Math.round(ev.dx || 0)));
      if (dy > 0) await nut.mouse.scrollDown(dy); else if (dy < 0) await nut.mouse.scrollUp(-dy);
      if (dx > 0) await nut.mouse.scrollRight(dx); else if (dx < 0) await nut.mouse.scrollLeft(-dx);
      break;
    }
    case 'key': {
      const k = keyFor(ev.code);
      if (k === null) break;
      if (ev.down) { held.keys.add(k); await nut.keyboard.pressKey(k); }
      else { held.keys.delete(k); await nut.keyboard.releaseKey(k); }
      break;
    }
  }
}

// never leave a key or mouse button stuck down when control ends
async function releaseAll() {
  if (!nut) return;
  for (const k of held.keys) { try { await nut.keyboard.releaseKey(k); } catch {} }
  for (const b of held.buttons) { try { await nut.mouse.releaseButton(b); } catch {} }
  held.keys.clear(); held.buttons.clear();
}

function showBar(peerName) {
  const d = session.display.workArea;
  const W = 420, H = 52;
  bar = new BrowserWindow({
    width: W, height: H, x: Math.round(d.x + (d.width - W) / 2), y: d.y + 12,
    frame: false, transparent: true, resizable: false, movable: true, alwaysOnTop: true,
    skipTaskbar: true, focusable: true, hasShadow: false, show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bar.setContentProtection(true); // keep the bar itself out of the screen share
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl';
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;font:13px -apple-system,Segoe UI,sans-serif;-webkit-user-select:none}
    .b{display:flex;align-items:center;gap:10px;height:40px;margin:6px;padding:0 6px 0 14px;border-radius:12px;
       background:rgba(24,25,28,.94);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.45);border:1px solid #ff5c5c66;-webkit-app-region:drag}
    .dot{width:9px;height:9px;border-radius:50%;background:#ff4d4d;box-shadow:0 0 0 0 #ff4d4d;animation:p 1.6s infinite}
    @keyframes p{70%{box-shadow:0 0 0 7px #ff4d4d00}100%{box-shadow:0 0 0 0 #ff4d4d00}}
    .t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t b{font-weight:650}.k{color:#aaa;font-size:11px}
    button{-webkit-app-region:no-drag;border:0;border-radius:8px;padding:7px 14px;background:#ed4245;color:#fff;font-weight:650;cursor:pointer}
    button:hover{background:#c9373a}</style>
    <div class="b"><span class="dot"></span><span class="t"><b>${esc(peerName)}</b> is controlling your screen <span class="k">· ${mod}+Shift+X</span></span>
    <button onclick="location.hash='stop'">Stop</button></div>`;
  bar.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  bar.webContents.on('did-navigate-in-page', (_e, url) => { if (url.endsWith('#stop')) stop('stopped'); });
  bar.once('ready-to-show', () => bar && bar.showInactive());
}

// Returns { ok } or { ok:false, reason } (missing permission / library).
function start({ peerName, hint } = {}) {
  if (!nut) return { ok: false, reason: 'unsupported' };
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(true)) {
    // true = macOS shows the "allow Accessibility" prompt
    return { ok: false, reason: 'accessibility' };
  }
  if (session) stop('replaced');
  session = { display: pickDisplay(hint), peerName: peerName || 'Someone' };
  showBar(session.peerName);
  try { globalShortcut.register(PANIC, () => stop('stopped')); } catch {}
  return { ok: true };
}

function stop(reason = 'stopped') {
  if (!session) return;
  session = null;
  try { globalShortcut.unregister(PANIC); } catch {}
  if (bar && !bar.isDestroyed()) bar.close();
  bar = null;
  chain = chain.then(releaseAll);
  onStopped(reason);
}

module.exports = {
  available: () => !!nut,
  start, stop, input, setShareDisplay,
  onStop: (cb) => { onStopped = cb; },
};
