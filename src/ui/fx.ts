import { reducedMotion } from './dom';

const PALETTES = {
  gold: ['#fff0c2', '#f4cf7a', '#c48f33', '#ffffff', '#ff9a6b'],
  party: ['#f4cf7a', '#ff4fa3', '#8a5cff', '#4fd1c5', '#ffffff', '#ff9a6b'],
};

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  color: string;
  round: boolean;
}

/**
 * Canvas confetti over `root`. `origin` is in 0..1 of the root's box; bits
 * burst outward from there and fall with gravity.
 */
export function confetti(
  root: HTMLElement,
  opts: { count?: number; palette?: keyof typeof PALETTES; origin?: { x: number; y: number }; power?: number } = {},
): void {
  if (reducedMotion()) return;
  const { width, height } = root.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  root.append(canvas);
  const g = canvas.getContext('2d');
  if (!g) return canvas.remove();
  g.scale(dpr, dpr);

  const colors = PALETTES[opts.palette ?? 'party'];
  const origin = opts.origin ?? { x: 0.5, y: 0.45 };
  const power = opts.power ?? 13;
  const bits: Bit[] = Array.from({ length: opts.count ?? 110 }, () => {
    const direction = Math.random() * Math.PI * 2;
    const speed = power * (0.35 + Math.random() * 0.65);
    return {
      x: origin.x * width,
      y: origin.y * height,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed - power * 0.45,
      size: 5 + Math.random() * 7,
      spin: (Math.random() - 0.5) * 0.5,
      angle: Math.random() * Math.PI,
      color: colors[Math.floor(Math.random() * colors.length)],
      round: Math.random() < 0.25,
    };
  });

  const started = performance.now();
  const life = 2600;
  let last = started;
  const frame = (now: number) => {
    const t = now - started;
    const step = Math.min((now - last) / 16.7, 3);
    last = now;
    g.clearRect(0, 0, width, height);
    g.globalAlpha = Math.min(1, (life - t) / 600);
    for (const b of bits) {
      b.vx *= 0.985 ** step;
      b.vy = b.vy * 0.985 ** step + 0.38 * step;
      b.x += b.vx * step;
      b.y += b.vy * step;
      b.angle += b.spin * step;
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.angle);
      g.fillStyle = b.color;
      if (b.round) {
        g.beginPath();
        g.arc(0, 0, b.size / 2.4, 0, Math.PI * 2);
        g.fill();
      } else {
        // Squash on one axis to fake a tumbling piece of paper.
        g.scale(1, Math.cos(b.angle * 2.3));
        g.fillRect(-b.size / 2, -b.size / 3, b.size, b.size / 1.5);
      }
      g.restore();
    }
    if (t < life) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Brief camera shake, e.g. when you are caught with the Joker. */
export function shake(el: HTMLElement): void {
  if (reducedMotion()) return;
  el.animate(
    { translate: ['0 0', '-9px 3px', '8px -4px', '-6px 2px', '5px -2px', '-3px 1px', '0 0'] },
    { duration: 520, easing: 'ease-out' },
  );
}
