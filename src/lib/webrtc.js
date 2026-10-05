// WebRTC mesh manager with "perfect negotiation" so tracks can be added/removed
// mid-call (turn camera on, start/stop screen share) and re-sync reliably with
// every peer. Signaling rides Socket.IO (rtc:offer/answer/ice) targeted by userId.
// STUN finds your public address; TURN relays media when a direct peer-to-peer
// path is impossible (strict / symmetric NAT). The server hands out the list
// (/api/ice) so TURN credentials live in env vars, not in the bundle.
import { VoiceFX } from './voicefx.js';

let ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];
fetch(`${import.meta.env.VITE_API_BASE || ''}/api/ice`)
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { if (d?.iceServers?.length) ICE_SERVERS = d.iceServers; })
  .catch(() => {});

export class CallManager {
  constructor(socket, selfId) {
    this.socket = socket;
    this.selfId = selfId;
    this.localStream = null;
    this.screenStream = null;
    this.voiceFx = null;
    this._fxTrack = null; // processed audio track currently sent (null = raw mic)
    this.peers = new Map(); // userId -> { pc, stream, makingOffer, ignoreOffer, polite }
    this.onRemoteStream = () => {};
    this.onPeerLeft = () => {};
    this.onScreenChange = () => {};
    this.onLocalChange = () => {};
    this._bind();
  }

  // Hidden voice changer: route the mic through real-time effects and send the
  // processed audio to everyone. 'none' reverts to the raw mic.
  setVoiceEffect(name) {
    const raw = this.localStream?.getAudioTracks()[0];
    if (!raw) return 'none';
    const replaceAudio = (track) => {
      for (const [, e] of this.peers) {
        const s = e.pc.getSenders().find((x) => x.track && x.track.kind === 'audio');
        if (s) { try { s.replaceTrack(track); } catch {} }
      }
    };
    if (name === 'none') {
      this._fxTrack = null;
      replaceAudio(raw);
      if (this.voiceFx) { this.voiceFx.close(); this.voiceFx = null; }
      return 'none';
    }
    if (!this.voiceFx) this.voiceFx = new VoiceFX(this.localStream);
    this._fxTrack = this.voiceFx.setEffect(name);
    replaceAudio(this._fxTrack);
    return name;
  }

  _bind() {
    this._h = {
      offer: async ({ from, sdp }) => {
        const e = this._ensurePeer(from);
        const pc = e.pc;
        const collision = (e.makingOffer || pc.signalingState !== 'stable');
        e.ignoreOffer = !e.polite && collision;
        if (e.ignoreOffer) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await pc.setLocalDescription(await pc.createAnswer());
          this.socket.emit('rtc:answer', { to: from, sdp: pc.localDescription });
        } catch {}
      },
      answer: async ({ from, sdp }) => {
        const e = this.peers.get(from);
        if (e) { try { await e.pc.setRemoteDescription(new RTCSessionDescription(sdp)); } catch {} }
      },
      ice: async ({ from, candidate }) => {
        const e = this.peers.get(from);
        if (e && candidate) { try { await e.pc.addIceCandidate(candidate); } catch {} }
      },
    };
    this.socket.on('rtc:offer', this._h.offer);
    this.socket.on('rtc:answer', this._h.answer);
    this.socket.on('rtc:ice', this._h.ice);
  }

  async startLocalMedia({ audio = true, video = false } = {}) {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio,
      video: video ? { width: 1280, height: 720 } : false,
    });
    return this.localStream;
  }

  _ensurePeer(userId) {
    if (this.peers.has(userId)) return this.peers.get(userId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = { pc, stream: new MediaStream(), makingOffer: false, ignoreOffer: false, polite: this.selfId < userId };
    this.peers.set(userId, entry);

    if (this.localStream) this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream));
    if (this.screenStream) this.screenStream.getTracks().forEach((t) => pc.addTrack(t, this.screenStream));
    // if a voice effect is active, send the processed audio to this new peer too
    if (this._fxTrack) {
      const s = pc.getSenders().find((x) => x.track && x.track.kind === 'audio');
      if (s) { try { s.replaceTrack(this._fxTrack); } catch {} }
    }

    pc.onicecandidate = (ev) => { if (ev.candidate) this.socket.emit('rtc:ice', { to: userId, candidate: ev.candidate }); };

    // Rebuild the displayed stream to contain exactly the tracks currently flowing.
    // A VIDEO track that goes muted/ended (e.g. the sharer stopped screen sharing)
    // is dropped so the <video> doesn't freeze on its last frame; when sharing
    // resumes the new track is added and shown. Audio tracks are always kept (a
    // muted mic should stay in the stream, just silent).
    const refreshStream = () => {
      const has = (t) => entry.stream.getTracks().includes(t);
      pc.getReceivers().forEach((r) => {
        const t = r.track;
        if (!t) return;
        const wanted = t.kind === 'audio' ? t.readyState === 'live' : (t.readyState === 'live' && !t.muted);
        if (wanted && !has(t)) entry.stream.addTrack(t);
        else if (!wanted && has(t)) entry.stream.removeTrack(t);
      });
      this.onRemoteStream(userId, entry.stream);
    };
    pc.ontrack = (ev) => {
      const t = ev.track;
      ['mute', 'unmute', 'ended'].forEach((e) => t.addEventListener(e, refreshStream));
      refreshStream();
    };
    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        this.socket.emit('rtc:offer', { to: userId, sdp: pc.localDescription });
      } catch {} finally { entry.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._dropPeer(userId);
    };
    return entry;
  }

  // Ensure a connection to each peer (tracks already added -> negotiation fires).
  connectToPeers(userIds) {
    userIds.forEach((uid) => uid !== this.selfId && this._ensurePeer(uid));
  }

  // List real camera inputs. Virtual cameras (OBS etc.) are flagged so the UI/
  // defaults can avoid them — they contend with the OS capture daemon and can
  // hang the macOS camera subsystem.
  async listCameras() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Camera', virtual: /obs|virtual|snap|manycam|camo|ndi/i.test(d.label) }));
    } catch { return []; }
  }

  // Turn the camera on/off. On enable, prefers a REAL (non-virtual) camera unless
  // a deviceId is given. On disable, fully stops + releases the device (so OBS /
  // FaceTime are freed). Switching device while live uses replaceTrack (no reneg).
  async setCamera(on, deviceId) {
    const old = this.localStream?.getVideoTracks()[0];
    if (!on) {
      if (old) {
        for (const [, e] of this.peers) e.pc.getSenders().filter((s) => s.track === old).forEach((s) => { try { e.pc.removeTrack(s); } catch {} });
        this.localStream.removeTrack(old);
        old.stop(); // releases the camera hardware / virtual cam
      }
      this.onLocalChange();
      return this.localStream;
    }
    // pick the device: explicit > first real camera with a known id > system default.
    // IMPORTANT: only constrain by deviceId when we actually have a non-empty id.
    // Before camera permission is granted, enumerateDevices() returns empty
    // deviceIds, and { deviceId: { exact: '' } } always fails — which broke the
    // very first camera enable in every browser.
    const video = { width: 1280, height: 720 };
    if (deviceId) {
      video.deviceId = { exact: deviceId };
    } else {
      const cams = await this.listCameras();
      const real = cams.find((c) => !c.virtual && c.deviceId);
      if (real) video.deviceId = { exact: real.deviceId };
    }
    let cam;
    try {
      cam = await navigator.mediaDevices.getUserMedia({ video });
    } catch (e) {
      // a deviceId/exact constraint failed — fall back to any available camera
      if (video.deviceId) cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      else throw e;
    }
    const track = cam.getVideoTracks()[0];
    if (!this.localStream) this.localStream = new MediaStream();
    if (old) {
      // seamless device switch
      for (const [, e] of this.peers) { const s = e.pc.getSenders().find((x) => x.track === old); if (s) { try { await s.replaceTrack(track); } catch {} } }
      this.localStream.removeTrack(old);
      old.stop();
      this.localStream.addTrack(track);
    } else {
      this.localStream.addTrack(track);
      for (const [, e] of this.peers) e.pc.addTrack(track, this.localStream); // renegotiates
    }
    this.onLocalChange();
    return this.localStream;
  }

  async shareScreen() {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    const track = this.screenStream.getVideoTracks()[0];
    track.onended = () => this.stopScreen();
    for (const [, e] of this.peers) e.pc.addTrack(track, this.screenStream); // renegotiates
    this.onScreenChange(true, this.screenStream);
    return this.screenStream;
  }

  stopScreen() {
    if (this.screenStream) {
      const tracks = this.screenStream.getTracks();
      tracks.forEach((t) => t.stop());
      // remove the screen sender from each peer so it renegotiates back
      for (const [, e] of this.peers) {
        e.pc.getSenders().filter((s) => s.track && tracks.includes(s.track)).forEach((s) => { try { e.pc.removeTrack(s); } catch {} });
      }
      this.screenStream = null;
      this.onScreenChange(false, null);
    }
  }

  toggleAudio(on) { this.localStream?.getAudioTracks().forEach((t) => (t.enabled = on)); }

  _dropPeer(userId) {
    const e = this.peers.get(userId);
    if (e) { try { e.pc.close(); } catch {} this.peers.delete(userId); this.onPeerLeft(userId); }
  }

  hangup() {
    for (const [uid] of this.peers) this._dropPeer(uid);
    if (this.voiceFx) { this.voiceFx.close(); this.voiceFx = null; }
    this._fxTrack = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.stopScreen();
    this.localStream = null;
    this.socket.off('rtc:offer', this._h.offer);
    this.socket.off('rtc:answer', this._h.answer);
    this.socket.off('rtc:ice', this._h.ice);
  }
}
