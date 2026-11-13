let ctx: AudioContext | null = null;
let muted = localStorage.getItem('sky-muted') === '1';

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, when = 0, slide = 0) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.2, when = 0, freq = 1800) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

export const sfx = {
  get muted() { return muted; },
  toggle() { muted = !muted; localStorage.setItem('sky-muted', muted ? '1' : '0'); return muted; },
  click: () => tone(660, 0.06, 'triangle', 0.08),
  roll: () => { for (let i = 0; i < 6; i++) noise(0.05, 0.25, i * 0.07, 1200 + i * 300); },
  build: () => { tone(180, 0.12, 'square', 0.08); noise(0.06, 0.2, 0, 600); tone(240, 0.1, 'triangle', 0.1, 0.08); },
  coin: () => { tone(988, 0.08, 'triangle', 0.1); tone(1319, 0.14, 'triangle', 0.1, 0.07); },
  turn: () => { tone(523, 0.15, 'sine', 0.12); tone(784, 0.25, 'sine', 0.12, 0.12); },
  steal: () => tone(400, 0.25, 'sawtooth', 0.06, 0, 0.5),
  pirate: () => { tone(150, 0.4, 'sawtooth', 0.05, 0, 0.7); noise(0.3, 0.1, 0, 400); },
  error: () => tone(200, 0.15, 'square', 0.06),
  win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.13, i * 0.13)),
};
