import { useCallback, useEffect, useRef, useState } from 'react';

// Remote control, both sides.
//  • Helper (any browser): asks to control someone's shared screen, then drives
//    it from a full-window view. Mouse coords are sent normalized (0..1).
//  • Sharer (Voxly desktop app only — browsers can't move the OS mouse): sees a
//    consent dialog, and input is applied only after they click Allow. The
//    server also refuses to relay input without that grant.

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
export const canBeControlled = () => !!window.desktop?.remote;
const DOWNLOAD_URL = 'https://github.com/AttackStudios/voxly/releases/latest';

function useSocketEvents(sock, handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!sock) return;
    const bound = Object.keys(ref.current).map((ev) => {
      const fn = (...a) => ref.current[ev]?.(...a);
      sock.on(ev, fn);
      return [ev, fn];
    });
    return () => bound.forEach(([ev, fn]) => sock.off(ev, fn));
  }, [sock]);
}

// ---------------- sharer (controlled) side ----------------
export function useRemoteSharer({ sock, sharing, screenStream, startSharing, pushToast }) {
  const [request, setRequest] = useState(null);   // { from }
  const [problem, setProblem] = useState(null);   // 'accessibility' | 'unsupported'
  const [controller, setController] = useState(null); // user currently in control
  const controllerRef = useRef(null);
  controllerRef.current = controller;

  useSocketEvents(sock, {
    'rc:request': ({ from }) => { setProblem(null); setRequest({ from }); },
    'rc:cancelled': ({ peerId }) => setRequest((r) => (r?.from.id === peerId ? null : r)),
    'rc:started': ({ peer }) => setController(peer),
    'rc:input': (ev) => window.desktop?.remote?.input(ev),
    'rc:ended': () => { window.desktop?.remote?.stop(); setController(null); },
    'rc:needs-desktop': ({ from }) => pushToast({
      title: `${from.displayName} wants to help`,
      body: 'To let friends control your screen, open Voxly in the desktop app (browsers can’t allow it).',
      link: DOWNLOAD_URL,
    }),
  });

  // Stop bar / Ctrl+Shift+X in the desktop app → tell the server
  useEffect(() => {
    window.desktop?.remote?.onStopped(() => {
      if (controllerRef.current) sock?.emit('rc:stop', {});
      setController(null);
    });
  }, [sock]);

  // stopping the screen share ends control too
  useEffect(() => {
    if (!sharing && controllerRef.current) { sock?.emit('rc:stop', {}); window.desktop?.remote?.stop(); setController(null); }
  }, [sharing, sock]);

  const deny = useCallback(() => {
    if (request) sock?.emit('rc:respond', { to: request.from.id, allow: false });
    setRequest(null); setProblem(null);
  }, [request, sock]);

  const allow = useCallback(async () => {
    if (!request) return;
    let stream = screenStream;
    if (!sharing) stream = await startSharing();
    if (!stream) return; // they cancelled the share picker
    const track = stream.getVideoTracks()[0];
    const st = track?.getSettings?.() || {};
    const res = await window.desktop.remote.start({ peerName: request.from.displayName, hint: { w: st.width, h: st.height } });
    if (!res?.ok) { setProblem(res?.reason || 'unsupported'); return; }
    sock?.emit('rc:respond', { to: request.from.id, allow: true, platform: isMac ? 'mac' : 'other' });
    setRequest(null); setProblem(null);
  }, [request, sharing, screenStream, startSharing, sock]);

  const stopControl = useCallback(() => {
    sock?.emit('rc:stop', {}); window.desktop?.remote?.stop(); setController(null);
  }, [sock]);

  const ui = request && (
    <div className="rc-modal-back">
      <div className="rc-modal" role="dialog" aria-modal="true">
        <div className="rc-modal-av" style={{ background: request.from.avatarColor }}>
          {request.from.avatarUrl ? <img src={request.from.avatarUrl} alt="" /> : request.from.displayName.slice(0, 2).toUpperCase()}
          <span className="rc-modal-badge">🖱️</span>
        </div>
        <h2><b>{request.from.displayName}</b> wants to control your screen</h2>
        <ul className="rc-modal-list">
          <li>They’ll be able to move your mouse, click and type.</li>
          <li>A red bar shows while they’re in control — click <b>Stop</b> any time.</li>
          <li>Emergency stop: <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd> <kbd>Shift</kbd> <kbd>X</kbd></li>
        </ul>
        {!sharing && <div className="rc-modal-note">Your screen will be shared so they can see what they’re doing. Pick your <b>entire screen</b>.</div>}
        {problem === 'accessibility' && (
          <div className="rc-modal-warn">
            macOS needs permission first: <b>System Settings → Privacy &amp; Security → Accessibility</b> → turn on <b>Voxly</b>, then click Allow again.
          </div>
        )}
        {problem === 'unsupported' && <div className="rc-modal-warn">Remote control isn’t available in this version of the app.</div>}
        <div className="rc-modal-btns">
          <button className="rc-btn ghost" onClick={deny}>Deny</button>
          <button className="rc-btn allow" onClick={allow} autoFocus>{sharing ? 'Allow control' : 'Share screen & allow'}</button>
        </div>
      </div>
    </div>
  );

  return { ui, controller, stopControl };
}

// ---------------- helper (controller) side ----------------
export function useRemoteHelper({ sock, pushToast, nameOf }) {
  const [state, setState] = useState({}); // peerId -> 'requested' | 'controlling'
  const [peerPlatform, setPeerPlatform] = useState({});
  const set = (peerId, v) => setState((s) => { const n = { ...s }; if (v) n[peerId] = v; else delete n[peerId]; return n; });

  useSocketEvents(sock, {
    'rc:granted': ({ peerId, platform }) => { set(peerId, 'controlling'); setPeerPlatform((p) => ({ ...p, [peerId]: platform })); },
    'rc:denied': ({ peerId }) => { set(peerId, null); pushToast({ title: 'Request declined', body: `${nameOf(peerId)} didn’t allow control.` }); },
    'rc:unavailable': ({ peerId }) => {
      set(peerId, null);
      pushToast({ title: 'Desktop app needed', body: `${nameOf(peerId)} is using a browser. They need the Voxly desktop app to let you control their screen — we’ve told them.` });
    },
    'rc:ended': ({ peerId, reason }) => {
      setState((s) => {
        if (s[peerId] === 'controlling' && reason !== 'replaced') pushToast({ title: 'Remote control ended', body: `${nameOf(peerId)}’s screen is back in their hands.` });
        const n = { ...s }; delete n[peerId]; return n;
      });
    },
  });

  const request = (peerId) => { set(peerId, 'requested'); sock?.emit('rc:request', { to: peerId }); };
  const cancel = (peerId) => { set(peerId, null); sock?.emit('rc:cancel', { to: peerId }); };
  const stop = (peerId) => { set(peerId, null); sock?.emit('rc:stop', { to: peerId }); };
  return { state, peerPlatform, request, cancel, stop };
}

// Full-window view used while controlling someone's screen.
export function ControlView({ sock, peerId, name, stream, platform, onStop }) {
  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const pressed = useRef(new Set());
  const pendingMove = useRef(null);
  const [locked, setLocked] = useState(false);

  const send = useCallback((ev) => sock?.emit('rc:input', { to: peerId, ev }), [sock, peerId]);

  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, [stream]);

  // map a pointer position to 0..1 within the video picture (ignoring letterbox bars)
  const norm = (e) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const r = v.getBoundingClientRect();
    const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    const w = v.videoWidth * scale, h = v.videoHeight * scale;
    const x = (e.clientX - (r.left + (r.width - w) / 2)) / w;
    const y = (e.clientY - (r.top + (r.height - h) / 2)) / h;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    return { x: +x.toFixed(4), y: +y.toFixed(4) };
  };

  // mouse moves are coalesced to one per frame
  useEffect(() => {
    let raf;
    const tick = () => {
      if (pendingMove.current) { send({ t: 'move', ...pendingMove.current }); pendingMove.current = null; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [send]);

  // Cmd on a Mac ↔ Ctrl on Windows/Linux, so shortcuts like copy/paste just work
  const mapCode = useCallback((code) => {
    const theyMac = platform === 'mac';
    if (isMac === theyMac) return code;
    if (isMac && code.startsWith('Meta')) return code.replace('Meta', 'Control');
    if (!isMac && code.startsWith('Control')) return code.replace('Control', 'Meta');
    return code;
  }, [platform]);

  const releaseAll = useCallback(() => {
    for (const code of pressed.current) send({ t: 'key', code, down: false });
    pressed.current.clear();
  }, [send]);

  useEffect(() => {
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      const code = mapCode(e.code);
      if (!e.repeat) pressed.current.add(code);
      send({ t: 'key', code, down: true });
    };
    const up = (e) => {
      e.preventDefault(); e.stopPropagation();
      const code = mapCode(e.code);
      pressed.current.delete(code);
      send({ t: 'key', code, down: false });
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [send, mapCode, releaseAll]);

  // full screen + keyboard lock lets Esc, Alt+Tab-style keys etc. reach their computer
  async function toggleFullscreen() {
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
    await wrapRef.current?.requestFullscreen?.().catch(() => {});
    try { await navigator.keyboard?.lock?.(); setLocked(true); } catch {}
  }
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) { navigator.keyboard?.unlock?.(); setLocked(false); } };
    document.addEventListener('fullscreenchange', onFs);
    return () => { document.removeEventListener('fullscreenchange', onFs); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);

  const stop = () => { releaseAll(); onStop(); };

  return (
    <div className="rc-view" ref={wrapRef}>
      <div className="rc-view-bar">
        <span className="rc-live-dot" />
        <span className="rc-view-title">Controlling <b>{name}</b>’s screen</span>
        <span className="rc-view-hint">{locked ? 'Hold Esc to exit full screen' : 'Your keyboard and mouse go to their computer'}</span>
        <button className="rc-btn ghost sm" onClick={toggleFullscreen}>{document.fullscreenElement ? 'Exit full screen' : '⛶ Full screen'}</button>
        <button className="rc-btn stop sm" onClick={stop}>Stop controlling</button>
      </div>
      <video
        ref={videoRef} className="rc-view-video" autoPlay playsInline muted
        onPointerMove={(e) => { const p = norm(e); if (p) pendingMove.current = p; }}
        onPointerDown={(e) => { const p = norm(e); if (!p) return; e.currentTarget.setPointerCapture(e.pointerId); send({ t: 'down', b: e.button, ...p }); }}
        onPointerUp={(e) => { const p = norm(e) || {}; send({ t: 'up', b: e.button, ...p }); }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => {
          const lines = (d) => (d === 0 ? 0 : Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 40)));
          send({ t: 'wheel', dx: lines(e.deltaX), dy: lines(e.deltaY) });
        }}
      />
    </div>
  );
}
