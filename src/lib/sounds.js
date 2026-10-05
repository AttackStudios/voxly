// Voxly UI sounds, synthesised with Web Audio (no audio files). Tuned to feel
// like a modern chat app: short soft "bloops", rising/falling join/leave
// tones, crisp mute clicks, and a looping marimba ringtone.
//   import { sfx } from './sounds.js'; sfx.play('message');
//   const stop = sfx.loop('ring'); ... stop();
const KEY = 'vx.sound';
let ctx = null, master = null;

function settings() {
  try { return { enabled: true, volume: 0.6, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { enabled: true, volume: 0.6 }; }
}
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); // keeps stacked sounds from clipping
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  master.gain.value = settings().volume;
  return ctx;
}
// browsers only allow audio after a user gesture: warm up on the first click/key
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => audio(), { once: true, capture: true }));

// one plucked/bell note: sine fundamental + a quieter overtone, fast attack, exp decay
function note(t, freq, { dur = 0.18, gain = 0.25, type = 'sine', overtone = 2, otGain = 0.25, glideTo, attack = 0.006 } = {}) {
  const c = ctx;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(gain, t + attack);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 6000;
  out.connect(lp).connect(master);
  const mk = (f, g, ty) => {
    const o = c.createOscillator(); o.type = ty; o.frequency.setValueAtTime(f, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo * (f / freq), t + dur * 0.6);
    const gg = c.createGain(); gg.gain.value = g; o.connect(gg).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  };
  mk(freq, 1, type);
  if (overtone) mk(freq * overtone, otGain, 'sine');
}

const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi → Hz

const SOUNDS = {
  // incoming message: soft two-note bloop
  message: (t) => { note(t, N(81), { dur: 0.14, gain: 0.22, otGain: 0.15 }); note(t + 0.075, N(88), { dur: 0.22, gain: 0.2, otGain: 0.12 }); },
  // @mention: brighter three-note chime
  mention: (t) => { [84, 88, 91].forEach((n, i) => note(t + i * 0.07, N(n), { dur: 0.26, gain: 0.2, overtone: 3, otGain: 0.18 })); },
  // someone (or you) joins voice: rising glide pair
  join: (t) => { note(t, N(72), { dur: 0.16, gain: 0.22, glideTo: N(76) }); note(t + 0.09, N(79), { dur: 0.24, gain: 0.22, glideTo: N(84) }); },
  // leaves voice: falling pair
  leave: (t) => { note(t, N(79), { dur: 0.16, gain: 0.2, glideTo: N(76) }); note(t + 0.09, N(72), { dur: 0.26, gain: 0.2, glideTo: N(67) }); },
  mute: (t) => { note(t, N(76), { dur: 0.08, gain: 0.18, type: 'triangle', overtone: 0 }); note(t + 0.06, N(69), { dur: 0.12, gain: 0.18, type: 'triangle', overtone: 0 }); },
  unmute: (t) => { note(t, N(69), { dur: 0.08, gain: 0.18, type: 'triangle', overtone: 0 }); note(t + 0.06, N(76), { dur: 0.12, gain: 0.18, type: 'triangle', overtone: 0 }); },
  deafen: (t) => { note(t, N(64), { dur: 0.1, gain: 0.2, type: 'triangle', overtone: 0 }); note(t + 0.07, N(57), { dur: 0.16, gain: 0.2, type: 'triangle', overtone: 0 }); },
  undeafen: (t) => { note(t, N(57), { dur: 0.1, gain: 0.2, type: 'triangle', overtone: 0 }); note(t + 0.07, N(64), { dur: 0.16, gain: 0.2, type: 'triangle', overtone: 0 }); },
  // screen share / go live
  streamStart: (t) => { note(t, N(72), { dur: 0.3, gain: 0.16, glideTo: N(84), overtone: 1.5, otGain: 0.2 }); note(t + 0.16, N(91), { dur: 0.2, gain: 0.14 }); },
  streamStop: (t) => { note(t, N(84), { dur: 0.3, gain: 0.16, glideTo: N(72), overtone: 1.5, otGain: 0.2 }); },
  // call ended / disconnected
  hangup: (t) => { [76, 72, 67].forEach((n, i) => note(t + i * 0.09, N(n), { dur: 0.22, gain: 0.18, type: 'triangle', overtone: 0 })); },
  // incoming call: marimba phrase (looped)
  ring: (t) => {
    const mar = (dt, n) => note(t + dt, N(n), { dur: 0.45, gain: 0.24, overtone: 4, otGain: 0.3, attack: 0.003 });
    mar(0, 76); mar(0.16, 80); mar(0.32, 83); mar(0.48, 88); mar(0.8, 83); mar(0.96, 88);
  },
  // outgoing call: gentle repeating double tone (looped)
  ringback: (t) => { note(t, N(74), { dur: 0.5, gain: 0.12, overtone: 2, otGain: 0.1 }); note(t + 0.55, N(71), { dur: 0.6, gain: 0.12, overtone: 2, otGain: 0.1 }); },
  // remote-control request / generic attention
  request: (t) => { note(t, N(83), { dur: 0.18, gain: 0.2 }); note(t + 0.12, N(83), { dur: 0.18, gain: 0.2 }); note(t + 0.24, N(90), { dur: 0.3, gain: 0.2 }); },
};
const LOOP_GAP = { ring: 2.2, ringback: 3.2 };

export const sfx = {
  list: Object.keys(SOUNDS),
  settings,
  save(patch) { try { localStorage.setItem(KEY, JSON.stringify({ ...settings(), ...patch })); } catch {} if (master) master.gain.value = settings().volume; },
  play(name) {
    if (!settings().enabled || !SOUNDS[name]) return;
    const c = audio(); if (!c) return;
    try { SOUNDS[name](c.currentTime + 0.01); } catch {}
  },
  // repeat a sound until the returned stop() is called
  loop(name) {
    let stopped = false, timer = null;
    const tick = () => { if (stopped) return; sfx.play(name); timer = setTimeout(tick, (LOOP_GAP[name] || 2) * 1000); };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  },
};
