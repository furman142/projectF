import type { PlayableCharter, Resource } from '../../shared/types.ts';

/**
 * All sound is synthesized with WebAudio (no audio files).
 * Effects go through a master bus with a small generated reverb; music has its own bus.
 */

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

let ctx: AudioContext | null = null;
let fxBus: GainNode, musicBus: GainNode, reverb: ConvolverNode, reverbSend: GainNode;
let fxMuted = read('sky-muted') === '1';
let musicOn = read('sky-music') !== '0';

function impulse(c: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      fxBus = ctx.createGain();
      fxBus.gain.value = fxMuted ? 0 : 0.9;
      fxBus.connect(comp);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(comp);
      reverb = ctx.createConvolver();
      reverb.buffer = impulse(ctx, 2.2, 2.5);
      reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.35;
      reverbSend.connect(reverb).connect(comp);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpts { type?: OscillatorType; gain?: number; when?: number; slide?: number; attack?: number; wet?: number; bus?: 'fx' | 'music'; detune?: number }

function tone(freq: number, dur: number, o: ToneOpts = {}) {
  const c = ac();
  if (!c || (o.bus !== 'music' && fxMuted)) return;
  const t = c.currentTime + (o.when ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.detune) osc.detune.value = o.detune;
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * o.slide), t + dur);
  const peak = o.gain ?? 0.15;
  const atk = o.attack ?? 0.008;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, atk + 0.02));
  osc.connect(g);
  g.connect(o.bus === 'music' ? musicBus : fxBus);
  if (o.wet) { const s = c.createGain(); s.gain.value = o.wet; g.connect(s).connect(reverbSend); }
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

interface NoiseOpts { gain?: number; when?: number; type?: BiquadFilterType; freq?: number; to?: number; q?: number; wet?: number; bus?: 'fx' | 'music'; attack?: number }

function noise(dur: number, o: NoiseOpts = {}) {
  const c = ac();
  if (!c || (o.bus !== 'music' && fxMuted)) return;
  const t = c.currentTime + (o.when ?? 0);
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq ?? 1500, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g);
  g.connect(o.bus === 'music' ? musicBus : fxBus);
  if (o.wet) { const s = c.createGain(); s.gain.value = o.wet; g.connect(s).connect(reverbSend); }
  src.start(t);
}

const knock = (when = 0, pitch = 1) => {
  tone(180 * pitch, 0.09, { type: 'triangle', gain: 0.22, when, slide: 0.6 });
  noise(0.05, { when, freq: 900 * pitch, q: 3, gain: 0.25 });
};
const chime = (f: number, when = 0, gain = 0.09) => {
  tone(f, 1.2, { gain, when, wet: 0.6 });
  tone(f * 2.01, 0.8, { gain: gain * 0.35, when, wet: 0.6 });
};
const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export const sfx = {
  get muted() { return fxMuted; },
  toggle() {
    fxMuted = !fxMuted;
    write('sky-muted', fxMuted ? '1' : '0');
    if (ctx) fxBus.gain.value = fxMuted ? 0 : 0.9;
    return fxMuted;
  },
  unlock() { ac(); },

  click: () => tone(1200, 0.035, { type: 'triangle', gain: 0.05, slide: 0.7 }),
  error: () => { tone(160, 0.12, { type: 'square', gain: 0.05 }); tone(140, 0.14, { type: 'square', gain: 0.05, when: 0.11 }); },

  /** Dice rattle, then thunks timed to the 3D dice bounces. */
  roll: () => {
    for (let i = 0; i < 9; i++) noise(0.03, { when: i * 0.035 + Math.random() * 0.02, freq: 2500 + Math.random() * 2000, q: 4, gain: 0.18 });
    [0.33, 0.65, 0.82].forEach((t, i) => {
      knock(t, 1.3 - i * 0.1);
      knock(t + 0.03, 1.5 - i * 0.1);
    });
  },

  resource(r: Resource, when = 0) {
    switch (r) {
      case 'timber': knock(when, 1.4); knock(when + 0.09, 1.7); break;
      case 'clay': tone(110, 0.18, { gain: 0.25, when, slide: 0.5 }); noise(0.1, { when, type: 'lowpass', freq: 500, gain: 0.25 }); break;
      case 'fiber': noise(0.35, { when, freq: 400, to: 2400, q: 1.2, gain: 0.16, attack: 0.08, wet: 0.3 }); break;
      case 'grain': for (let i = 0; i < 4; i++) noise(0.06, { when: when + i * 0.045, type: 'highpass', freq: 3500, gain: 0.1 }); break;
      case 'crystal': chime(NOTE(88), when); chime(NOTE(95), when + 0.08, 0.06); break;
    }
  },

  build(piece: 'bridge' | 'outpost' | 'citadel') {
    if (piece === 'bridge') { knock(0, 1.1); knock(0.12, 1.25); }
    else if (piece === 'outpost') {
      knock(0, 1); knock(0.1, 1.15); knock(0.2, 1.3);
      [72, 76, 79].forEach((n, i) => tone(NOTE(n), 0.35, { type: 'triangle', gain: 0.08, when: 0.3 + i * 0.06, wet: 0.3 }));
    } else {
      [60, 64, 67, 72, 76].forEach((n, i) => tone(NOTE(n), 0.45, { type: 'triangle', gain: 0.1, when: i * 0.08, wet: 0.4 }));
      chime(NOTE(84), 0.42, 0.1);
    }
  },

  charterBuy: () => {
    noise(0.12, { freq: 1800, to: 5000, q: 0.8, gain: 0.14 });
    noise(0.1, { when: 0.1, freq: 3000, to: 1200, q: 0.8, gain: 0.1 });
    [84, 88, 91].forEach((n, i) => tone(NOTE(n), 0.3, { gain: 0.05, when: 0.15 + i * 0.05, wet: 0.5 }));
  },

  charterPlay(kind: PlayableCharter) {
    if (kind === 'knight') {
      tone(1800, 0.4, { type: 'square', gain: 0.04, wet: 0.5 });
      tone(2700, 0.3, { type: 'square', gain: 0.025, wet: 0.5 });
      noise(0.15, { type: 'highpass', freq: 4000, gain: 0.15 });
      [67, 72, 76].forEach((n, i) => tone(NOTE(n), 0.25, { type: 'sawtooth', gain: 0.05, when: 0.15 + i * 0.1 }));
    } else {
      for (let i = 0; i < 10; i++) tone(NOTE(72 + [0, 2, 4, 7, 9][i % 5] + 12 * Math.floor(i / 5)), 0.4, { gain: 0.05, when: i * 0.04, wet: 0.6 });
    }
  },

  pirate: () => {
    const c = ac();
    if (!c || fxMuted) return;
    // Propeller hum with a wobble, then an ominous low phrase.
    const t = c.currentTime;
    const osc = c.createOscillator();
    const lfo = c.createOscillator();
    const lg = c.createGain();
    const g = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 70;
    lfo.frequency.value = 18;
    lg.gain.value = 0.06;
    lfo.connect(lg).connect(g.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.2);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    osc.connect(f).connect(g).connect(fxBus);
    osc.start(t); lfo.start(t);
    osc.stop(t + 1.3); lfo.stop(t + 1.3);
    [50, 53, 49].forEach((n, i) => tone(NOTE(n), 0.35, { type: 'triangle', gain: 0.12, when: 0.1 + i * 0.22, wet: 0.4 }));
  },

  seven: () => {
    tone(NOTE(55), 0.3, { type: 'sawtooth', gain: 0.08 });
    tone(NOTE(51), 0.5, { type: 'sawtooth', gain: 0.08, when: 0.25 });
    noise(0.5, { type: 'lowpass', freq: 300, gain: 0.25, when: 0.05 });
  },

  steal: () => {
    noise(0.22, { freq: 3000, to: 600, q: 2, gain: 0.18 });
    tone(700, 0.25, { type: 'triangle', gain: 0.07, slide: 0.45, when: 0.05 });
  },

  discard: () => { for (let i = 0; i < 3; i++) noise(0.08, { when: i * 0.07, freq: 2500, to: 1000, gain: 0.1 }); },

  trade: () => {
    [0, 0.08, 0.16].forEach((w, i) => { tone(2400 + i * 300, 0.12, { type: 'triangle', gain: 0.06, when: w, wet: 0.2 }); tone(3600 + i * 200, 0.08, { gain: 0.03, when: w }); });
  },

  offer: () => { chime(NOTE(76), 0, 0.08); chime(NOTE(72), 0.22, 0.08); },

  award: () => [67, 72, 76, 79, 84].forEach((n, i) => tone(NOTE(n), i === 4 ? 0.7 : 0.18, { type: 'triangle', gain: 0.11, when: i * 0.09, wet: 0.4 })),

  turn: () => { chime(NOTE(79), 0, 0.1); chime(NOTE(86), 0.13, 0.08); },

  win: () => {
    const melody = [72, 76, 79, 84, 79, 84, 88];
    melody.forEach((n, i) => tone(NOTE(n), i === melody.length - 1 ? 1.2 : 0.2, { type: 'triangle', gain: 0.12, when: i * 0.14, wet: 0.4 }));
    [60, 64, 67].forEach((n) => tone(NOTE(n), 1.6, { type: 'sine', gain: 0.06, when: 0.84, attack: 0.1, wet: 0.5 }));
    for (let i = 0; i < 6; i++) noise(0.4, { when: 1 + i * 0.35, type: 'highpass', freq: 2000, gain: 0.08, wet: 0.5 });
  },

  lose: () => [67, 66, 65, 64].forEach((n, i) => tone(NOTE(n), i === 3 ? 0.9 : 0.35, { type: 'triangle', gain: 0.1, when: i * 0.32, slide: i === 3 ? 0.94 : 1 })),

  firework: (when = 0) => {
    noise(0.25, { when, freq: 800, to: 3000, gain: 0.04 });
    noise(0.6, { when: when + 0.25, type: 'lowpass', freq: 900, gain: 0.25, wet: 0.6 });
    for (let i = 0; i < 5; i++) noise(0.04, { when: when + 0.35 + Math.random() * 0.4, type: 'highpass', freq: 5000, gain: 0.05 });
  },
};

// ---------- generative background music ----------

const CHORDS = [
  [57, 64, 69, 72], // Am
  [53, 60, 65, 69], // F
  [48, 55, 64, 67], // C
  [55, 62, 67, 71], // G
];
const SCALE = [69, 72, 74, 76, 79, 81, 84];
let musicTimer: ReturnType<typeof setInterval> | null = null;
let bar = 0;

function playBar() {
  const chord = CHORDS[bar % CHORDS.length];
  bar++;
  // Soft pad
  chord.forEach((n, i) => {
    tone(NOTE(n), 4.6, { type: 'sine', gain: 0.035, attack: 1.4, bus: 'music', detune: (i - 1.5) * 4 });
    tone(NOTE(n) * 2, 4, { type: 'triangle', gain: 0.008, attack: 1.8, bus: 'music' });
  });
  // Sparse melody plinks
  for (let i = 0; i < 4; i++) {
    if (Math.random() < 0.45) {
      tone(NOTE(SCALE[Math.floor(Math.random() * SCALE.length)]), 1.4, { gain: 0.025, when: i + Math.random() * 0.3, bus: 'music', wet: 0.7 });
    }
  }
  // Wind swell now and then
  if (bar % 3 === 0) noise(4, { type: 'bandpass', freq: 500, to: 900, q: 0.6, gain: 0.03, attack: 1.8, bus: 'music', wet: 0.3 });
}

export const music = {
  get on() { return musicOn; },
  toggle() {
    musicOn = !musicOn;
    write('sky-music', musicOn ? '1' : '0');
    if (musicOn) music.start(); else music.stop();
    return musicOn;
  },
  start() {
    const c = ac();
    if (!c || !musicOn || musicTimer) return;
    musicBus.gain.cancelScheduledValues(c.currentTime);
    musicBus.gain.setTargetAtTime(0.8, c.currentTime, 1.5);
    playBar();
    musicTimer = setInterval(playBar, 4000);
  },
  stop() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
    if (ctx) musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  },
};
