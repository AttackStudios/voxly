// Real-time mic voice effects (Web Audio). Produces a processed MediaStreamTrack
// that can be sent to peers in place of the raw mic. Pitch shifting uses the
// classic "Jungle" two-delay crossfade technique (Chris Wilson, MIT) so it works
// live with no ML/server. Effects: none, deep, high, robot, echo, alien.

function createFadeBuffer(ctx, activeTime, fadeTime) {
  const length1 = activeTime * ctx.sampleRate;
  const length2 = (activeTime - 2 * fadeTime) * ctx.sampleRate;
  const length = length1 + length2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const p = buffer.getChannelData(0);
  const fadeLength = fadeTime * ctx.sampleRate;
  const fadeIndex1 = fadeLength;
  const fadeIndex2 = length1 - fadeLength;
  for (let i = 0; i < length1; ++i) {
    let v;
    if (i < fadeIndex1) v = Math.sqrt(i / fadeLength);
    else if (i >= fadeIndex2) v = Math.sqrt(1 - (i - fadeIndex2) / fadeLength);
    else v = 1;
    p[i] = v;
  }
  for (let i = length1; i < length; ++i) p[i] = 0;
  return buffer;
}

function createDelayTimeBuffer(ctx, activeTime, fadeTime, shiftUp) {
  const length1 = activeTime * ctx.sampleRate;
  const length2 = (activeTime - 2 * fadeTime) * ctx.sampleRate;
  const length = length1 + length2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const p = buffer.getChannelData(0);
  for (let i = 0; i < length1; ++i) p[i] = shiftUp ? (length1 - i) / length : i / length1;
  for (let i = length1; i < length; ++i) p[i] = 0;
  return buffer;
}

const DELAY_TIME = 0.1, FADE_TIME = 0.05, BUFFER_TIME = 0.1;

function Jungle(ctx) {
  this.ctx = ctx;
  const input = ctx.createGain();
  const output = ctx.createGain();

  const mod1 = ctx.createBufferSource(), mod2 = ctx.createBufferSource();
  const mod3 = ctx.createBufferSource(), mod4 = ctx.createBufferSource();
  const shiftDown = createDelayTimeBuffer(ctx, BUFFER_TIME, FADE_TIME, false);
  const shiftUp = createDelayTimeBuffer(ctx, BUFFER_TIME, FADE_TIME, true);
  mod1.buffer = shiftDown; mod2.buffer = shiftDown; mod3.buffer = shiftUp; mod4.buffer = shiftUp;
  [mod1, mod2, mod3, mod4].forEach((m) => (m.loop = true));

  const mod1Gain = ctx.createGain(), mod2Gain = ctx.createGain();
  const mod3Gain = ctx.createGain(), mod4Gain = ctx.createGain();
  mod3Gain.gain.value = 0; mod4Gain.gain.value = 0;
  mod1.connect(mod1Gain); mod2.connect(mod2Gain); mod3.connect(mod3Gain); mod4.connect(mod4Gain);

  const modGain1 = ctx.createGain(), modGain2 = ctx.createGain();
  const delay1 = ctx.createDelay(), delay2 = ctx.createDelay();
  mod1Gain.connect(modGain1); mod2Gain.connect(modGain2);
  mod3Gain.connect(modGain1); mod4Gain.connect(modGain2);
  modGain1.connect(delay1.delayTime); modGain2.connect(delay2.delayTime);

  const fade1 = ctx.createBufferSource(), fade2 = ctx.createBufferSource();
  const fadeBuffer = createFadeBuffer(ctx, BUFFER_TIME, FADE_TIME);
  fade1.buffer = fadeBuffer; fade2.buffer = fadeBuffer; fade1.loop = true; fade2.loop = true;

  const mix1 = ctx.createGain(), mix2 = ctx.createGain();
  mix1.gain.value = 0; mix2.gain.value = 0;
  fade1.connect(mix1.gain); fade2.connect(mix2.gain);

  input.connect(delay1); input.connect(delay2);
  delay1.connect(mix1); delay2.connect(mix2);
  mix1.connect(output); mix2.connect(output);

  const t = ctx.currentTime + 0.05;
  const t2 = t + BUFFER_TIME - FADE_TIME;
  mod1.start(t); mod2.start(t2); mod3.start(t); mod4.start(t2);
  fade1.start(t); fade2.start(t2);

  this.input = input; this.output = output;
  this._mod1Gain = mod1Gain; this._mod2Gain = mod2Gain;
  this._mod3Gain = mod3Gain; this._mod4Gain = mod4Gain;
  this._modGain1 = modGain1; this._modGain2 = modGain2;
}
Jungle.prototype.setPitchOffset = function (mult) {
  if (mult > 0) { this._mod1Gain.gain.value = 0; this._mod2Gain.gain.value = 0; this._mod3Gain.gain.value = 1; this._mod4Gain.gain.value = 1; }
  else { this._mod1Gain.gain.value = 1; this._mod2Gain.gain.value = 1; this._mod3Gain.gain.value = 0; this._mod4Gain.gain.value = 0; }
  const d = DELAY_TIME * Math.abs(mult);
  this._modGain1.gain.setTargetAtTime(0.5 * d, this.ctx.currentTime, 0.01);
  this._modGain2.gain.setTargetAtTime(0.5 * d, this.ctx.currentTime, 0.01);
};

function distortionCurve(amount) {
  const n = 22050, curve = new Float32Array(n), deg = Math.PI / 180;
  for (let i = 0; i < n; ++i) { const x = (i * 2) / n - 1; curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x)); }
  return curve;
}

// Synthetic reverb impulse (decaying noise) so we don't ship an audio file.
function makeReverb(ctx, duration, decay) {
  const rate = ctx.sampleRate, len = Math.max(1, Math.floor(rate * duration));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  const conv = ctx.createConvolver(); conv.buffer = buf; return conv;
}

export const VOICE_EFFECTS = [
  { id: 'none', label: '🎙️ Normal' },
  { id: 'deep', label: '🐻 Deep' },
  { id: 'high', label: '🐿️ Chipmunk' },
  { id: 'robot', label: '🤖 Robot' },
  { id: 'echo', label: '🏔️ Echo' },
  { id: 'alien', label: '👽 Alien' },
  { id: 'monster', label: '👹 Monster' },
  { id: 'telephone', label: '📞 Phone' },
  { id: 'megaphone', label: '📣 Megaphone' },
  { id: 'underwater', label: '🌊 Underwater' },
  { id: 'ghost', label: '👻 Ghost' },
  { id: 'cave', label: '🕳️ Cave' },
];

export class VoiceFX {
  constructor(inputStream) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.source = this.ctx.createMediaStreamSource(inputStream);
    this.dest = this.ctx.createMediaStreamDestination();
    this.effect = 'none';
    this._build('none');
  }
  get track() { return this.dest.stream.getAudioTracks()[0]; }

  _build(name) {
    try { this.source.disconnect(); } catch {}
    if (this._nodes) this._nodes.forEach((n) => { try { n.disconnect(); } catch {} try { n.stop && n.stop(); } catch {} });
    this._nodes = [];
    const ctx = this.ctx, src = this.source, dest = this.dest;

    if (name === 'none') { src.connect(dest); }
    else if (name === 'deep' || name === 'high' || name === 'alien') {
      const j = new Jungle(ctx);
      j.setPitchOffset(name === 'deep' ? -0.55 : name === 'high' ? 0.6 : 0.45);
      src.connect(j.input);
      if (name === 'alien') {
        const trem = ctx.createGain(); trem.gain.value = 0.6;
        const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 8;
        const depth = ctx.createGain(); depth.gain.value = 0.4;
        osc.connect(depth); depth.connect(trem.gain); osc.start();
        j.output.connect(trem); trem.connect(dest);
        this._nodes.push(j.input, j.output, trem, osc, depth);
      } else { j.output.connect(dest); this._nodes.push(j.input, j.output); }
    }
    else if (name === 'robot') {
      const shaper = ctx.createWaveShaper(); shaper.curve = distortionCurve(8);
      const trem = ctx.createGain(); trem.gain.value = 0.5;
      const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 55;
      const depth = ctx.createGain(); depth.gain.value = 0.5;
      osc.connect(depth); depth.connect(trem.gain); osc.start();
      src.connect(shaper); shaper.connect(trem); trem.connect(dest);
      this._nodes.push(shaper, trem, osc, depth);
    }
    else if (name === 'echo') {
      const delay = ctx.createDelay(); delay.delayTime.value = 0.28;
      const fb = ctx.createGain(); fb.gain.value = 0.45;
      src.connect(dest);
      src.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(dest);
      this._nodes.push(delay, fb);
    }
    else if (name === 'monster') {
      const j = new Jungle(ctx); j.setPitchOffset(-0.75);
      const shaper = ctx.createWaveShaper(); shaper.curve = distortionCurve(5);
      src.connect(j.input); j.output.connect(shaper); shaper.connect(dest);
      this._nodes.push(j.input, j.output, shaper);
    }
    else if (name === 'telephone') {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.2;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
      src.connect(hp); hp.connect(bp); bp.connect(dest);
      this._nodes.push(bp, hp);
    }
    else if (name === 'megaphone') {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 3;
      const shaper = ctx.createWaveShaper(); shaper.curve = distortionCurve(10);
      const out = ctx.createGain(); out.gain.value = 1.3;
      src.connect(bp); bp.connect(shaper); shaper.connect(out); out.connect(dest);
      this._nodes.push(bp, shaper, out);
    }
    else if (name === 'underwater') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 450;
      const trem = ctx.createGain(); trem.gain.value = 0.6;
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 3;
      const depth = ctx.createGain(); depth.gain.value = 0.35;
      osc.connect(depth); depth.connect(trem.gain); osc.start();
      src.connect(lp); lp.connect(trem); trem.connect(dest);
      this._nodes.push(lp, trem, osc, depth);
    }
    else if (name === 'ghost') {
      const j = new Jungle(ctx); j.setPitchOffset(0.15);
      const rev = makeReverb(ctx, 3, 3);
      const wet = ctx.createGain(); wet.gain.value = 0.9;
      const dry = ctx.createGain(); dry.gain.value = 0.3;
      const trem = ctx.createGain(); trem.gain.value = 0.7;
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 5;
      const depth = ctx.createGain(); depth.gain.value = 0.3;
      osc.connect(depth); depth.connect(trem.gain); osc.start();
      src.connect(j.input);
      j.output.connect(dry); dry.connect(trem);
      j.output.connect(rev); rev.connect(wet); wet.connect(trem);
      trem.connect(dest);
      this._nodes.push(j.input, j.output, rev, wet, dry, trem, osc, depth);
    }
    else if (name === 'cave') {
      const rev = makeReverb(ctx, 4, 2);
      const wet = ctx.createGain(); wet.gain.value = 0.85;
      src.connect(dest); // dry
      src.connect(rev); rev.connect(wet); wet.connect(dest);
      this._nodes.push(rev, wet);
    }
    this.effect = name;
  }

  setEffect(name) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._build(name);
    return this.track;
  }
  close() { try { this.ctx.close(); } catch {} }
}
