// All sounds are synthesised with WebAudio, so there are no audio files to
// download and everything works offline.

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface Tone {
  freq: number;
  to?: number;
  at?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

function play(tones: Tone[]): void {
  const ac = audio();
  if (!ac) return;
  for (const t of tones) {
    const start = ac.currentTime + (t.at ?? 0);
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(t.gain ?? 0.12, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    osc.connect(amp).connect(ac.destination);
    osc.start(start);
    osc.stop(start + t.dur + 0.03);
  }
}

/** A short burst of filtered noise: the sound of a card sliding on felt. */
function swish(at = 0, dur = 0.22, gain = 0.09): void {
  const ac = audio();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2400;
  filter.Q.value = 0.7;
  const amp = ac.createGain();
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(ac.currentTime + at);
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export const sfx = {
  tap: () => play([{ freq: 520, to: 760, dur: 0.07, type: 'triangle', gain: 0.08 }]),
  deselect: () => play([{ freq: 520, to: 380, dur: 0.07, type: 'triangle', gain: 0.06 }]),
  deal: (count: number) => {
    for (let i = 0; i < count; i++) swish(0.15 + i * 0.09, 0.12, 0.06);
  },
  pass: () => {
    swish(0, 0.28, 0.11);
    swish(0.07, 0.24, 0.07);
  },
  reveal: () => play([{ freq: 660, to: 990, dur: 0.1, type: 'triangle', gain: 0.07 }]),
  error: () => play([{ freq: 180, to: 120, dur: 0.16, type: 'square', gain: 0.05 }]),
  joker: () =>
    play([
      { freq: 311, dur: 0.22, type: 'sawtooth', gain: 0.05 },
      { freq: 220, at: 0.14, dur: 0.38, type: 'sawtooth', gain: 0.06 },
    ]),
  ready: () =>
    play([
      { freq: 784, dur: 0.1, type: 'triangle' },
      { freq: 1047, at: 0.09, dur: 0.1, type: 'triangle' },
      { freq: 1319, at: 0.18, dur: 0.2, type: 'triangle' },
    ]),
  call: () =>
    play([
      { freq: 523, dur: 0.12, type: 'square', gain: 0.06 },
      { freq: 659, at: 0.1, dur: 0.12, type: 'square', gain: 0.06 },
      { freq: 784, at: 0.2, dur: 0.12, type: 'square', gain: 0.06 },
      { freq: 1047, at: 0.3, dur: 0.45, type: 'square', gain: 0.07 },
      { freq: 1319, at: 0.3, dur: 0.45, type: 'triangle', gain: 0.06 },
    ]),
  lose: () =>
    play([
      { freq: 392, dur: 0.2, type: 'sawtooth', gain: 0.06 },
      { freq: 330, at: 0.18, dur: 0.2, type: 'sawtooth', gain: 0.06 },
      { freq: 262, at: 0.36, dur: 0.2, type: 'sawtooth', gain: 0.06 },
      { freq: 196, to: 98, at: 0.54, dur: 0.6, type: 'sawtooth', gain: 0.07 },
    ]),
  win: () =>
    play(
      [523, 659, 784, 1047, 784, 1047, 1319].map((freq, i) => ({
        freq,
        at: i * 0.11,
        dur: i === 6 ? 0.7 : 0.14,
        type: 'triangle' as const,
        gain: 0.09,
      })),
    ),
};
