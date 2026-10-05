import { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { CallManager } from '../lib/webrtc.js';
import { VOICE_EFFECTS } from '../lib/voicefx.js';
import { bus } from '../lib/bus.js';
import { sfx } from '../lib/sounds.js';
import Icon from './Icon.jsx';
import { api } from '../lib/api.js';
import { useRemoteSharer, useRemoteHelper, ControlView } from './RemoteControl.jsx';

// Returns true while the given stream's mic audio is above a speaking threshold.
// Uses Web Audio RMS with a short hold so the ring doesn't flicker between words.
function useSpeaking(stream) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) { setSpeaking(false); return; }
    let ctx, raf, lastAbove = 0, stopped = false;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (stopped) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        const now = (window.performance || Date).now();
        if (rms > 0.045) lastAbove = now;          // speaking threshold
        setSpeaking(now - lastAbove < 220);         // hold ~220ms
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* AudioContext may be unavailable */ }
    return () => { stopped = true; cancelAnimationFrame(raf); try { ctx && ctx.close(); } catch {} };
  }, [stream]);
  return speaking;
}

export default function CallOverlay() {
  const { me, socket, startDM, pushToast } = useApp();
  const [call, setCall] = useState(null); // see start()
  const [remote, setRemote] = useState({}); // userId -> MediaStream
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [localAudioStream, setLocalAudioStream] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [camId, setCamId] = useState(null);
  const [fxUnlocked, setFxUnlocked] = useState(false); // hidden voice changer
  const [fxEffect, setFxEffect] = useState('none');
  const [minimized, setMinimized] = useState(false);
  const [people, setPeople] = useState({}); // userId -> public user (for tile names)
  const micToggles = useRef([]);
  const mgr = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  const s = () => socket.current;
  const nameOf = (uid) => people[uid]?.displayName || 'Your friend';

  // remote control: me helping others (helper) / others helping me (sharer)
  const helper = useRemoteHelper({ sock: socket.current, pushToast, nameOf });
  const sharer = useRemoteSharer({
    sock: socket.current, sharing, screenStream, pushToast,
    startSharing: () => toggleScreen(true),
  });
  const rcRef = useRef({ helper, sharer });
  rcRef.current = { helper, sharer };

  const ensureManager = useCallback(() => {
    if (!mgr.current) {
      mgr.current = new CallManager(s(), me.id);
      mgr.current.onRemoteStream = (uid, stream) => setRemote((r) => { if (!r[uid]) sfx.play('join'); return { ...r, [uid]: stream }; });
      mgr.current.onPeerLeft = (uid) => setRemote((r) => { if (r[uid]) sfx.play('leave'); const n = { ...r }; delete n[uid]; return n; });
      // keep sharing UI in sync even when the user stops sharing via the OS/browser bar
      mgr.current.onScreenChange = (on, stream) => { setSharing(on); setScreenStream(stream || null); };
    }
    return mgr.current;
  }, [me.id]);

  const endCall = useCallback((notifyTargets = true) => {
    const { helper: h, sharer: sh } = rcRef.current;
    Object.keys(h.state).forEach((pid) => h.stop(pid));
    if (sh.controller) sh.stopControl();
    if (call?.mode === 'voice') s()?.emit('voice:leave', { channelId: call.channelId });
    if (call?.mode === 'dm' && notifyTargets) (call.targets || []).forEach((t) => s()?.emit('call:end', { to: t.id, dmId: call.dmId }));
    if (mgr.current) sfx.play(call?.status === 'ringing' && call?.incoming ? 'leave' : 'hangup');
    mgr.current?.hangup();
    mgr.current = null;
    localStreamRef.current = null;
    setRemote({}); setCall(null); setSharing(false); setLocalAudioStream(null);
    setFxUnlocked(false); setFxEffect('none'); setMinimized(false); micToggles.current = [];
  }, [call]);

  // ---- start a call (from bus) ----
  useEffect(() => {
    return bus.on('call:start', async (opts) => {
      let dmId = opts.dmId;
      if (!dmId && opts.startDmWith) {
        const convo = await startDM([opts.startDmWith]);
        dmId = convo.id;
      }
      const m = ensureManager();
      try {
        const stream = await m.startLocalMedia({ audio: true, video: !!opts.video });
        localStreamRef.current = stream;
        setLocalAudioStream(stream);
        setMicOn(true); setCamOn(!!opts.video);
      } catch (e) {
        pushToast({ title: 'Call failed', body: 'Could not access mic/camera: ' + e.message });
        return;
      }
      if (opts.type === 'voice') {
        sfx.play('join');
        setCall({ mode: 'voice', channelId: opts.channelId, video: !!opts.video, status: 'active' });
        s().emit('voice:join', { channelId: opts.channelId });
      } else {
        setCall({ mode: 'dm', dmId, video: !!opts.video, targets: opts.targets || [], status: 'ringing', outgoing: true });
        (opts.targets || []).forEach((t) => s().emit('call:invite', { to: t.id, dmId, video: !!opts.video }));
        if (opts.screen) setTimeout(() => toggleScreen(true), 300);
      }
    });
  }, [ensureManager, startDM, pushToast]);

  // ---- socket call events ----
  useEffect(() => {
    const sock = s();
    if (!sock) return;
    const onIncoming = ({ from, dmId, video, fromId }) =>
      setCall({ mode: 'dm', dmId, video, status: 'ringing', incoming: true, fromId, from, targets: [from] });
    const onAccepted = ({ fromId }) => {
      ensureManager().connectToPeers([fromId]); // I (caller) initiate
      setCall((c) => (c ? { ...c, status: 'active' } : c));
    };
    const onDeclined = () => { pushToast({ title: 'Call declined', body: 'No answer.' }); endCall(false); };
    const onEnded = () => endCall(false);
    // newcomer dials everyone already in the channel
    const onVoicePeers = ({ peers }) => ensureManager().connectToPeers(peers);
    // ...and everyone already in the channel dials the newcomer (bidirectional, so
    // the mesh forms even if the server's member snapshot was stale). Perfect
    // negotiation in CallManager dedupes the two offers into one connection.
    const onPeerJoined = ({ userId }) => { if (mgr.current) mgr.current.connectToPeers([userId]); };

    sock.on('call:incoming', onIncoming);
    sock.on('call:accepted', onAccepted);
    sock.on('call:declined', onDeclined);
    sock.on('call:ended', onEnded);
    sock.on('voice:peers', onVoicePeers);
    sock.on('voice:peer-joined', onPeerJoined);
    return () => {
      ['call:incoming','call:accepted','call:declined','call:ended','voice:peers','voice:peer-joined']
        .forEach((e) => sock.off(e));
    };
  }, [ensureManager, endCall, pushToast]);

  // If the socket drops and reconnects (or the server restarts) while you're in a
  // voice channel, re-announce your presence so the mesh re-forms.
  useEffect(() => {
    if (call?.mode !== 'voice') return;
    const sock = s();
    if (!sock) return;
    const rejoin = () => sock.emit('voice:join', { channelId: call.channelId });
    sock.on('connect', rejoin);
    return () => sock.off('connect', rejoin);
  }, [call?.mode, call?.channelId]);

  useEffect(() => {
    if (call?.status !== 'ringing') return;
    return sfx.loop(call.incoming ? 'ring' : 'ringback');
  }, [call?.status, call?.incoming]);

  // green "speaking" ring when your mic picks up sound (and you're not muted)
  const localSpeaking = useSpeaking(micOn ? localAudioStream : null);

  // look up names for everyone on the call
  useEffect(() => {
    if (!call) return;
    api.users().then((d) => setPeople(Object.fromEntries(d.users.map((u) => [u.id, u])))).catch(() => {});
  }, [call?.status, Object.keys(remote).join()]); // eslint-disable-line

  // populate the camera list once we're in a call so the picker is ready
  useEffect(() => { if (call && mgr.current) refreshCameras(); /* eslint-disable-next-line */ }, [call?.status]);

  // what to show in your own tile: your screen if sharing, else your camera, else nothing
  const previewStream = sharing && screenStream ? screenStream : (camOn ? localStreamRef.current : null);
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = previewStream || null;
  }, [previewStream, call]);

  async function acceptIncoming() {
    const m = ensureManager();
    const stream = await m.startLocalMedia({ audio: true, video: call.video });
    localStreamRef.current = stream;
    setLocalAudioStream(stream);
    setMicOn(true); setCamOn(call.video);
    s().emit('call:accept', { to: call.fromId, dmId: call.dmId });
    setCall((c) => ({ ...c, status: 'active', incoming: false }));
  }
  function declineIncoming() { s().emit('call:decline', { to: call.fromId, dmId: call.dmId }); setCall(null); }

  function toggleMic() {
    const v = !micOn; setMicOn(v); mgr.current?.toggleAudio(v);
    sfx.play(v ? 'unmute' : 'mute');
    // secret: 6 mic presses within 4s unlocks the live voice changer
    const now = Date.now();
    micToggles.current = micToggles.current.filter((t) => now - t < 4000).concat(now);
    if (!fxUnlocked && micToggles.current.length >= 6) {
      setFxUnlocked(true);
      micToggles.current = [];
      pushToast({ title: 'Voice changer unlocked', body: 'Pick an effect below — others in the call will hear it live.' });
    }
  }
  function pickEffect(id) {
    setFxEffect(id);
    try { mgr.current?.setVoiceEffect(id); }
    catch (e) { pushToast({ title: 'Voice FX error', body: e.message }); }
  }
  async function toggleCam() {
    const v = !camOn;
    try {
      await mgr.current.setCamera(v, v ? camId : undefined);
      localStreamRef.current = mgr.current.localStream;
      setCamOn(v);
      if (v) refreshCameras();
    } catch (e) {
      pushToast({ title: 'Camera unavailable', body: e.message || 'Could not access the camera.' });
    }
  }
  async function refreshCameras() {
    const list = (await mgr.current?.listCameras()) || [];
    setCameras(list);
    // default to the first REAL (non-virtual) camera, never OBS/virtual
    if (!camId) { const real = list.find((c) => !c.virtual) || list[0]; if (real) setCamId(real.deviceId); }
  }
  async function pickCamera(id) {
    setCamId(id);
    if (camOn) {
      try { await mgr.current.setCamera(true, id); localStreamRef.current = mgr.current.localStream; }
      catch (e) { pushToast({ title: 'Camera switch failed', body: e.message }); }
    }
  }
  async function toggleScreen(force) {
    const want = force ?? !sharing;
    if (want) {
      try { const ss = await mgr.current.shareScreen(); setScreenStream(ss); setSharing(true); sfx.play('streamStart'); return ss; }
      catch { return null; }
    }
    if (sharing) sfx.play('streamStop');
    mgr.current?.stopScreen(); setScreenStream(null); setSharing(false); return null;
  }

  if (!call) return sharer.ui || null;

  // incoming ring
  if (call?.status === 'ringing' && call.incoming) {
    return (
      <div className="call-ring">
        <div className="call-avatar" style={{ background: call.from?.avatarColor }}>{(call.from?.displayName || '?').slice(0, 2).toUpperCase()}</div>
        <div className="call-ring-name">{call.from?.displayName}</div>
        <div className="call-ring-sub">Incoming {call.video ? 'video' : 'voice'} call…</div>
        <div className="call-ring-btns">
          <button className="btn-success" onClick={acceptIncoming}>Accept</button>
          <button className="btn-danger" onClick={declineIncoming}>Decline</button>
        </div>
      </div>
    );
  }

  const remoteIds = Object.keys(remote);
  const controllingId = Object.keys(helper.state).find((pid) => helper.state[pid] === 'controlling' && remote[pid]);
  return (
    <>
    {sharer.ui}
    {controllingId && (
      <ControlView sock={socket.current} peerId={controllingId} name={nameOf(controllingId)} stream={remote[controllingId]}
        platform={helper.peerPlatform[controllingId]} onStop={() => helper.stop(controllingId)} />
    )}
    <div className={`call-overlay ${minimized ? 'minimized' : ''}`}>
      {sharer.controller && (
        <div className="rc-controlled-bar">
          <span className="rc-live-dot" /> <b>{sharer.controller.displayName}</b>&nbsp;is controlling your screen
          <button className="rc-btn stop sm" onClick={sharer.stopControl}>Stop</button>
        </div>
      )}
      <div className="call-titlebar">
        <span className="call-titlebar-text">
          <Icon name={call?.mode === 'voice' ? 'volume' : 'phone'} size={14} />
          {call?.mode === 'voice' ? 'Voice channel' : 'Call'}{call?.status === 'ringing' ? ' · ringing…' : ''}
        </span>
        <button className="call-min-btn" title={minimized ? 'Expand' : 'Minimize (keep using the app)'}
          onClick={() => setMinimized((m) => !m)}><Icon name={minimized ? 'maximize' : 'minimize'} size={16} /></button>
      </div>
      <div className="call-grid">
        <div className={`tile local ${localSpeaking ? 'speaking' : ''}`}>
          {previewStream
            ? <video ref={localVideoRef} autoPlay playsInline muted />
            : <div className={`tile-av ${localSpeaking ? 'speaking' : ''}`} style={{ background: me.avatarColor }}>{me.displayName.slice(0, 2).toUpperCase()}</div>}
          <div className="media-badges">
            {sharing && <span className="media-badge screen"><Icon name="screen" size={12} /> Screen</span>}
            {camOn && <span className="media-badge cam"><Icon name="video" size={12} /> Camera</span>}
            {!sharing && !camOn && <span className="media-badge voice"><Icon name={micOn ? 'mic' : 'micOff'} size={12} /> Voice only</span>}
          </div>
          <div className="tile-name">You</div>
        </div>
        {remoteIds.map((uid) => (
          <RemoteTile key={uid} uid={uid} stream={remote[uid]} name={nameOf(uid)}
            rc={helper.state[uid]} onRequest={() => helper.request(uid)} onCancel={() => helper.cancel(uid)} />
        ))}
        {remoteIds.length === 0 && (
          <div className="tile placeholder">{call?.status === 'ringing' ? 'Ringing…' : 'Waiting for others…'}</div>
        )}
      </div>

      {fxUnlocked && !minimized && (
        <div className="voicefx-bar">
          <span className="voicefx-label"><Icon name="mask" size={14} /> Voice changer</span>
          {VOICE_EFFECTS.map((fx) => (
            <button key={fx.id} className={`voicefx-btn ${fxEffect === fx.id ? 'on' : ''}`} onClick={() => pickEffect(fx.id)}>
              {fx.label}
            </button>
          ))}
        </div>
      )}

      <div className="call-controls">
        <button className={`call-btn ${micOn ? '' : 'off'}`} onClick={toggleMic} title={micOn ? 'Mute' : 'Unmute'}><Icon name={micOn ? 'mic' : 'micOff'} size={22} /></button>
        <div className="cam-group">
          <button className={`call-btn ${camOn ? 'on' : ''}`} onClick={toggleCam} title={camOn ? 'Turn off camera' : 'Turn on camera'}><Icon name={camOn ? 'video' : 'videoOff'} size={22} /></button>
          {cameras.length > 0 && (
            <select className="cam-select" value={camId || ''} onChange={(e) => pickCamera(e.target.value)} title="Choose camera">
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>{c.virtual ? '(virtual) ' : ''}{c.label}</option>
              ))}
            </select>
          )}
        </div>
        <button className={`call-btn ${sharing ? 'on' : ''}`} onClick={() => toggleScreen()} title={sharing ? 'Stop sharing' : 'Share your screen'}><Icon name={sharing ? 'screenOff' : 'screen'} size={22} /></button>
        <button className="call-btn hang" onClick={() => endCall(true)} title="Disconnect"><Icon name="phoneOff" size={24} /></button>
      </div>
    </div>
    </>
  );
}

function RemoteTile({ stream, name, rc, onRequest, onCancel }) {
  const ref = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    if (!stream) return;
    const update = () => {
      setHasVideo(stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted));
      // re-bind srcObject so the <video> re-renders when tracks are added/removed
      // (otherwise it can stay frozen on a removed track's last frame)
      if (ref.current) ref.current.srcObject = stream;
    };
    update();
    stream.addEventListener('addtrack', update);
    stream.addEventListener('removetrack', update);
    return () => { stream.removeEventListener('addtrack', update); stream.removeEventListener('removetrack', update); };
  }, [stream]);
  const speaking = useSpeaking(stream);

  return (
    <div className={`tile ${speaking ? 'speaking' : ''}`}>
      <video ref={ref} autoPlay playsInline />
      <div className="media-badges">
        <span className={`media-badge ${hasVideo ? 'cam' : 'voice'}`}><Icon name={hasVideo ? 'screen' : 'mic'} size={12} /> {hasVideo ? 'Video / Screen' : 'Voice'}</span>
      </div>
      {hasVideo && (
        rc === 'requested'
          ? <button className="rc-tile-btn waiting" onClick={onCancel} title="Cancel request"><Icon name="clock" size={13} /> Waiting for {name}… <span>Cancel</span></button>
          : rc === 'controlling'
            ? <span className="rc-tile-btn live"><Icon name="pointer" size={13} /> You’re in control</span>
            : <button className="rc-tile-btn" onClick={onRequest} title={`Ask ${name} if you can control their screen`}><Icon name="pointer" size={13} /> Request control</button>
      )}
      <div className="tile-name">{name}</div>
    </div>
  );
}
