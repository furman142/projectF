// All sounds are synthesised with WebAudio, so there are no audio files to
// download and everything works offline.

let ctx: AudioContext | null = null;
let master: AudioNode | null = null;
let enabled = true;
let heartbeatTimer: number | null = null;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (!on) sfx.heartbeat(false);
}

function audio(): { ac: AudioContext; out: AudioNode } | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      // A gentle compressor glues layered sounds together and prevents clipping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      comp.connect(gain).connect(ctx.destination);
      master = comp;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return { ac: ctx, out: master! };
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
  /** Slow attack (seconds) for pads; default is a quick pluck. */
  attack?: number;
}

function play(tones: Tone[]): void {
  const a = audio();
  if (!a) return;
  for (const t of tones) {
    const start = a.ac.currentTime + (t.at ?? 0);
    const osc = a.ac.createOscillator();
    const amp = a.ac.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(t.gain ?? 0.12, start + (t.attack ?? 0.012));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    osc.connect(amp).connect(a.out);
    osc.start(start);
    osc.stop(start + t.dur + 0.03);
  }
}

/** Filtered noise. Band-pass = a card sliding on felt; high-pass = a crisp snap. */
function noise(opts: { at?: number; dur: number; gain: number; freq: number; type?: BiquadFilterType; sweepTo?: number }): void {
  const a = audio();
  if (!a) return;
  const frames = Math.floor(a.ac.sampleRate * opts.dur);
  const buffer = a.ac.createBuffer(1, frames, a.ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  const start = a.ac.currentTime + (opts.at ?? 0);
  const src = a.ac.createBufferSource();
  src.buffer = buffer;
  const filter = a.ac.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq, start);
  if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, start + opts.dur);
  filter.Q.value = 0.8;
  const amp = a.ac.createGain();
  amp.gain.value = opts.gain;
  src.connect(filter).connect(amp).connect(a.out);
  src.start(start);
}

/** One card landing: a crisp snap with a soft thump underneath. */
function snap(at = 0, gain = 0.12): void {
  noise({ at, dur: 0.05, gain, freq: 2600, type: 'highpass' });
  play([{ freq: 170, to: 70, at, dur: 0.07, gain: gain * 0.9 }]);
}

function slide(at = 0, gain = 0.1): void {
  noise({ at, dur: 0.3, gain, freq: 900, sweepTo: 3200 });
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

const NOTE = { C4: 262, E4: 330, G4: 392, C5: 523, D5: 587, E5: 659, G5: 784, A5: 880, C6: 1047, E6: 1319, G6: 1568 };

export const sfx = {
  /** Generic UI button press. */
  click: () => {
    noise({ dur: 0.03, gain: 0.05, freq: 3000, type: 'highpass' });
    play([{ freq: 420, to: 300, dur: 0.06, type: 'triangle', gain: 0.07 }]);
  },
  sheet: () => noise({ dur: 0.25, gain: 0.05, freq: 500, sweepTo: 1800 }),
  tap: () => {
    noise({ dur: 0.04, gain: 0.06, freq: 2200, type: 'highpass' });
    play([{ freq: 560, to: 820, dur: 0.08, type: 'triangle', gain: 0.08 }]);
  },
  deselect: () => play([{ freq: 560, to: 380, dur: 0.08, type: 'triangle', gain: 0.06 }]),
  shuffle: () => {
    for (let i = 0; i < 9; i++) noise({ at: i * 0.028, dur: 0.035, gain: 0.05, freq: 1800 + i * 150, type: 'highpass' });
  },
  deal: (count: number) => {
    for (let i = 0; i < count; i++) {
      slide(0.3 + i * 0.09, 0.05);
      snap(0.5 + i * 0.09, 0.07);
    }
  },
  pass: () => {
    slide(0, 0.12);
    slide(0.06, 0.08);
    snap(0.6, 0.1);
    snap(0.66, 0.07);
  },
  /** Someone asks a neighbour for a card: a short questioning "hm-hmm?". */
  ask: () =>
    play([
      { freq: 520, dur: 0.09, type: 'triangle', gain: 0.08 },
      { freq: 520, to: 830, at: 0.11, dur: 0.16, type: 'triangle', gain: 0.09 },
    ]),
  /** A request is aimed at you and you have to give the card up. */
  demand: () =>
    play([
      { freq: 392, dur: 0.1, type: 'square', gain: 0.05 },
      { freq: 392, at: 0.13, dur: 0.1, type: 'square', gain: 0.05 },
      { freq: 311, at: 0.26, dur: 0.22, type: 'square', gain: 0.055 },
    ]),
  /** Your request paid off. */
  granted: () =>
    play([
      { freq: NOTE.E5, dur: 0.09, type: 'triangle', gain: 0.08 },
      { freq: NOTE.A5, at: 0.08, dur: 0.09, type: 'triangle', gain: 0.08 },
      { freq: NOTE.E6, at: 0.16, dur: 0.25, type: 'triangle', gain: 0.09 },
    ]),
  /** Your request came back empty. */
  denied: () => play([{ freq: 330, to: 220, dur: 0.22, type: 'triangle', gain: 0.07 }]),
  /** A bot has chosen its card. */
  botReady: () => play([{ freq: 1250, dur: 0.05, type: 'sine', gain: 0.025 }]),
  reveal: () =>
    play([
      { freq: NOTE.E5, to: NOTE.A5, dur: 0.1, type: 'triangle', gain: 0.07 },
      { freq: NOTE.E6, at: 0.05, dur: 0.12, gain: 0.03 },
    ]),
  error: () =>
    play([
      { freq: 190, to: 120, dur: 0.16, type: 'square', gain: 0.05 },
      { freq: 95, dur: 0.16, type: 'sawtooth', gain: 0.04 },
    ]),
  /** The Joker lands in your hand: a wobbly, mocking little phrase. */
  joker: () => {
    const laugh = [466, 415, 466, 370, 311];
    play([
      ...laugh.map((freq, i) => ({ freq, to: freq * 0.94, at: i * 0.085, dur: 0.09, type: 'square' as const, gain: 0.045 })),
      { freq: 116, to: 82, at: 0.42, dur: 0.5, type: 'sawtooth', gain: 0.07 },
      { freq: 58, at: 0.42, dur: 0.5, gain: 0.1 },
    ]);
  },
  /** The Joker is free to pass again. */
  unlock: () =>
    play([
      { freq: 880, dur: 0.05, type: 'square', gain: 0.03 },
      { freq: 1320, at: 0.06, dur: 0.09, type: 'square', gain: 0.03 },
    ]),
  /** Low double-thump that loops while you are holding the Joker. */
  heartbeat: (on: boolean) => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (!on || !enabled) return;
    const beat = () =>
      play([
        { freq: 62, to: 42, dur: 0.14, gain: 0.16 },
        { freq: 56, to: 38, at: 0.19, dur: 0.16, gain: 0.11 },
      ]);
    beat();
    heartbeatTimer = window.setInterval(beat, 1050);
  },
  /** You have four of a kind: bright rising arpeggio that says "press now". */
  ready: () =>
    play([
      { freq: NOTE.G5, dur: 0.1, type: 'triangle' },
      { freq: NOTE.C6, at: 0.08, dur: 0.1, type: 'triangle' },
      { freq: NOTE.E6, at: 0.16, dur: 0.1, type: 'triangle' },
      { freq: NOTE.G6, at: 0.24, dur: 0.3, type: 'triangle' },
      { freq: NOTE.G6 * 2, at: 0.24, dur: 0.3, gain: 0.03 },
    ]),
  /** Someone slams the table and calls it. */
  call: () => {
    noise({ dur: 0.12, gain: 0.2, freq: 300, type: 'lowpass' });
    play([
      { freq: 110, to: 45, dur: 0.22, gain: 0.25 },
      { freq: NOTE.C5, at: 0.08, dur: 0.12, type: 'square', gain: 0.05 },
      { freq: NOTE.E5, at: 0.17, dur: 0.12, type: 'square', gain: 0.05 },
      { freq: NOTE.G5, at: 0.26, dur: 0.12, type: 'square', gain: 0.05 },
      { freq: NOTE.C6, at: 0.35, dur: 0.5, type: 'square', gain: 0.06 },
      { freq: NOTE.E6, at: 0.35, dur: 0.5, type: 'triangle', gain: 0.06 },
      { freq: NOTE.G6, at: 0.35, dur: 0.6, gain: 0.04 },
    ]);
    noise({ at: 0.35, dur: 0.6, gain: 0.04, freq: 7000, type: 'highpass' });
  },
  lose: () => {
    noise({ dur: 0.12, gain: 0.2, freq: 300, type: 'lowpass' });
    play([
      { freq: 110, to: 45, dur: 0.22, gain: 0.25 },
      { freq: NOTE.G4, at: 0.1, dur: 0.22, type: 'sawtooth', gain: 0.06 },
      { freq: 370, at: 0.3, dur: 0.22, type: 'sawtooth', gain: 0.06 },
      { freq: 349, at: 0.5, dur: 0.22, type: 'sawtooth', gain: 0.06 },
      { freq: NOTE.E4, to: 150, at: 0.7, dur: 0.8, type: 'sawtooth', gain: 0.07 },
      { freq: 82, to: 55, at: 0.7, dur: 0.8, gain: 0.14 },
    ]);
  },
  /** A penalty letter is stamped onto the scoreboard. */
  stamp: () => {
    noise({ dur: 0.08, gain: 0.16, freq: 500, type: 'lowpass' });
    play([
      { freq: 150, to: 60, dur: 0.14, gain: 0.22 },
      { freq: 900, to: 500, at: 0.01, dur: 0.06, type: 'square', gain: 0.03 },
    ]);
  },
  /** A player spelled the whole word and is out. */
  eliminated: () =>
    play([
      { freq: 440, to: 110, dur: 0.7, type: 'sawtooth', gain: 0.06 },
      { freq: 220, to: 55, dur: 0.7, type: 'square', gain: 0.04 },
      { freq: 60, at: 0.6, dur: 0.4, gain: 0.2 },
    ]),
  roundWin: () =>
    play([
      { freq: NOTE.C5, dur: 0.12, type: 'triangle', gain: 0.08 },
      { freq: NOTE.E5, at: 0.1, dur: 0.12, type: 'triangle', gain: 0.08 },
      { freq: NOTE.G5, at: 0.2, dur: 0.12, type: 'triangle', gain: 0.08 },
      { freq: NOTE.C6, at: 0.3, dur: 0.4, type: 'triangle', gain: 0.09 },
    ]),
  win: () => {
    const melody = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.G5, NOTE.C6, NOTE.E6];
    play([
      ...melody.map((freq, i) => ({ freq, at: i * 0.12, dur: i === 6 ? 0.9 : 0.15, type: 'triangle' as const, gain: 0.09 })),
      ...[NOTE.C4, NOTE.E4, NOTE.G4].map((freq) => ({ freq, at: 0.72, dur: 1.1, type: 'sawtooth' as const, gain: 0.035, attack: 0.08 })),
      { freq: NOTE.G6, at: 0.72, dur: 0.9, gain: 0.04 },
    ]);
    noise({ at: 0.72, dur: 0.9, gain: 0.04, freq: 7000, type: 'highpass' });
  },
  gameOver: () =>
    play([
      { freq: NOTE.E4, dur: 0.35, type: 'triangle', gain: 0.08 },
      { freq: 294, at: 0.32, dur: 0.35, type: 'triangle', gain: 0.08 },
      { freq: NOTE.C4, at: 0.64, dur: 0.9, type: 'triangle', gain: 0.09 },
      { freq: 131, at: 0.64, dur: 0.9, gain: 0.1 },
    ]),
};
