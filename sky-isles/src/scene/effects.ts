import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Board } from '../../shared/types.ts';

interface Particle {
  s: THREE.Sprite;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  gravity: number;
  drag: number;
  spin: number;
}

interface Die { mesh: THREE.Mesh; target: THREE.Quaternion; spin: THREE.Euler; from: THREE.Vector3; to: THREE.Vector3 }

const texCache = new Map<string, THREE.Texture>();

function canvasTex(key: string, draw: (c: CanvasRenderingContext2D, s: number) => void, size = 128) {
  let t = texCache.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

const softTex = () => canvasTex('soft', (c, s) => {
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
});

const starTex = () => canvasTex('star', (c, s) => {
  c.translate(s / 2, s / 2);
  c.fillStyle = '#fff';
  c.shadowColor = '#fff';
  c.shadowBlur = 12;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.16 : s * 0.42;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.fill();
});

export const emojiTex = (e: string) => canvasTex(`emoji:${e}`, (c, s) => {
  c.font = `${s * 0.72}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = 'rgba(0,0,0,.35)';
  c.shadowBlur = 8;
  c.fillText(e, s / 2, s / 2 + s * 0.04);
});

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
};
const dieFace = (n: number) => canvasTex(`die${n}`, (c, s) => {
  c.fillStyle = '#fffaf0';
  c.fillRect(0, 0, s, s);
  c.fillStyle = n === 1 ? '#d8443a' : '#24324a';
  for (const [x, y] of PIPS[n]) {
    c.beginPath();
    c.arc(x * s, y * s, s * (n === 1 ? 0.13 : 0.085), 0, Math.PI * 2);
    c.fill();
  }
});

// BoxGeometry face order: +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
// Rotation that brings the face showing `n` to the top (+y).
function faceUp(n: number): THREE.Quaternion {
  const e = new THREE.Euler();
  if (n === 6) e.set(Math.PI, 0, 0);
  else if (n === 2) e.set(-Math.PI / 2, 0, 0);
  else if (n === 5) e.set(Math.PI / 2, 0, 0);
  else if (n === 3) e.set(0, 0, Math.PI / 2);
  else if (n === 4) e.set(0, 0, -Math.PI / 2);
  return new THREE.Quaternion().setFromEuler(e);
}

function bounceOut(k: number) {
  const n = 7.5625, d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
  return n * (k -= 2.625 / d) * k + 0.984375;
}

export class Effects {
  private particles: Particle[] = [];
  private group = new THREE.Group();
  private dice: Die[] = [];
  private diceStart = 0;
  private diceGeo = new RoundedBoxGeometry(0.42, 0.42, 0.42, 4, 0.07);
  private diceMats = FACE_VALUES.map((n) => new THREE.MeshStandardMaterial({ map: dieFace(n), roughness: 0.45 }));
  private birds: { g: THREE.Group; wings: THREE.Mesh[]; r: number; a: number; y: number; speed: number; phase: number }[] = [];
  private falls: { points: THREE.Points; origin: THREE.Vector3; dir: THREE.Vector3; seeds: Float32Array }[] = [];
  private fallGroup = new THREE.Group();
  private shakeUntil = 0;
  private shakeAmp = 0;
  private shakeOffset = new THREE.Vector3();
  private fireworksUntil = 0;
  private nextFirework = 0;
  onFirework: (() => void) | null = null;

  constructor(private scene: THREE.Scene, root: THREE.Group, private camera: THREE.PerspectiveCamera, private target: THREE.Vector3) {
    // Marked so World keeps these layers when it rebuilds the board.
    this.group.userData.keep = true;
    this.fallGroup.userData.keep = true;
    root.add(this.group, this.fallGroup);
    this.buildBirds();
  }

  spawn(o: {
    pos: THREE.Vector3; tex: THREE.Texture; color?: THREE.ColorRepresentation; size?: number; v?: THREE.Vector3;
    life?: number; grow?: number; gravity?: number; drag?: number; additive?: boolean; spin?: number; opacity?: number;
  }) {
    const mat = new THREE.SpriteMaterial({
      map: o.tex, color: o.color ?? 0xffffff, transparent: true, depthWrite: false, opacity: o.opacity ?? 1,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mat.userData.base = o.opacity ?? 1;
    const s = new THREE.Sprite(mat);
    s.position.copy(o.pos);
    const size = o.size ?? 0.2;
    s.scale.setScalar(size);
    this.group.add(s);
    this.particles.push({
      s, v: o.v ?? new THREE.Vector3(), age: 0, life: o.life ?? 1, size, grow: o.grow ?? 0,
      gravity: o.gravity ?? 0, drag: o.drag ?? 0.98, spin: o.spin ?? 0,
    });
  }

  /** Dust puff and sparkles when a piece is built. */
  build(pos: THREE.Vector3, color: string, kind: 'bridge' | 'outpost' | 'citadel') {
    const soft = softTex(), star = starTex();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3(0, 0.05, 0)), tex: soft, color: 0xf3ead8, size: 0.14, life: 0.7,
        v: new THREE.Vector3(Math.cos(a) * 0.9, 0.3 + Math.random() * 0.3, Math.sin(a) * 0.9), grow: 0.35, drag: 0.9, opacity: 0.8,
      });
    }
    const n = kind === 'citadel' ? 28 : kind === 'outpost' ? 16 : 8;
    for (let i = 0; i < n; i++) {
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3(0, 0.25, 0)), tex: star, color: kind === 'citadel' ? (i % 2 ? 0xffe066 : color) : color,
        size: 0.1 + Math.random() * 0.06, life: 0.9 + Math.random() * 0.5,
        v: new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6), gravity: 3.2, drag: 0.97,
      });
    }
    if (kind === 'citadel') {
      this.spawn({ pos: pos.clone().add(new THREE.Vector3(0, 0.3, 0)), tex: soft, color: 0xfff1a8, size: 0.4, grow: 3, life: 0.6, additive: true });
    }
  }

  /** A resource icon rising from an island. */
  resource(pos: THREE.Vector3, emoji: string, delay = 0) {
    setTimeout(() => {
      this.spawn({ pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.35, (Math.random() - 0.5) * 0.3)), tex: emojiTex(emoji), size: 0.34, life: 1.3, v: new THREE.Vector3(0, 0.9, 0), drag: 0.96 });
      for (let i = 0; i < 6; i++) {
        this.spawn({ pos: pos.clone().add(new THREE.Vector3(0, 0.3, 0)), tex: starTex(), color: 0xfff3b0, size: 0.07, life: 0.7, additive: true, v: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2), gravity: 2 });
      }
    }, delay);
  }

  /** Dark smoke where the pirate lands. */
  smoke(pos: THREE.Vector3) {
    for (let i = 0; i < 22; i++) {
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.8)),
        tex: softTex(), color: i % 3 ? 0x3a3546 : 0x6b6478, size: 0.25, grow: 0.9, life: 1.4 + Math.random() * 0.6,
        v: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3), drag: 0.97, opacity: 0.7,
      });
    }
  }

  /** A puff of cards leaving a player (steal / discard). */
  sparkle(pos: THREE.Vector3, color: THREE.ColorRepresentation, n = 12) {
    for (let i = 0; i < n; i++) {
      this.spawn({ pos: pos.clone(), tex: starTex(), color, size: 0.08, life: 0.8, additive: true, v: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), gravity: 2.5 });
    }
  }

  fireworks(seconds: number) {
    this.fireworksUntil = performance.now() + seconds * 1000;
    this.nextFirework = 0;
  }

  private burst() {
    const colors = [0xff5a5a, 0xffd23f, 0x4fc3ff, 0x9b6bff, 0x5ee38a, 0xffffff];
    const c = colors[Math.floor(Math.random() * colors.length)];
    const c2 = colors[Math.floor(Math.random() * colors.length)];
    const pos = new THREE.Vector3((Math.random() - 0.5) * 7, 1.8 + Math.random() * 1.6, (Math.random() - 0.5) * 4);
    for (let i = 0; i < 46; i++) {
      const dir = new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random() * 1.2);
      this.spawn({ pos: pos.clone(), tex: starTex(), color: i % 3 ? c : c2, size: 0.16, life: 1.3 + Math.random() * 0.5, v: dir, gravity: 1.4, drag: 0.94 });
    }
    this.spawn({ pos, tex: softTex(), color: c, size: 0.5, grow: 4, life: 0.4, additive: true });
    this.onFirework?.();
  }

  /** Two 3D dice tumble in and land showing the rolled values. */
  rollDice(values: [number, number]) {
    for (const d of this.dice) this.scene.remove(d.mesh);
    this.dice = [];
    const toCam = this.camera.position.clone().sub(this.target).setY(0).normalize();
    const side = new THREE.Vector3(-toCam.z, 0, toCam.x);
    const center = this.target.clone().add(toCam.clone().multiplyScalar(1.6)).setY(0.95);
    values.forEach((v, i) => {
      const mesh = new THREE.Mesh(this.diceGeo, this.diceMats);
      mesh.castShadow = true;
      const to = center.clone().add(side.clone().multiplyScalar(i ? 0.36 : -0.36));
      const from = to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 3.4, (Math.random() - 0.5) * 1.5)).add(side.clone().multiplyScalar(i ? 1 : -1));
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      const spin = new THREE.Euler((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      mesh.position.copy(from);
      this.scene.add(mesh);
      this.dice.push({ mesh, target: yaw.multiply(faceUp(v)), spin, from, to });
    });
    this.diceStart = performance.now();
  }

  shake(ms = 450, amp = 0.12) {
    this.shakeUntil = performance.now() + ms;
    this.shakeAmp = amp;
  }

  private buildBirds() {
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.04, 0, 0, 0.04, 0.22, 0.02, 0], 3));
    wingGeo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x2e3b52, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const l = new THREE.Mesh(wingGeo, mat);
      const r = new THREE.Mesh(wingGeo, mat);
      r.scale.x = -1;
      g.add(l, r);
      g.scale.setScalar(0.8 + Math.random() * 0.5);
      this.scene.add(g);
      this.birds.push({ g, wings: [l, r], r: 6 + Math.random() * 3, a: Math.random() * Math.PI * 2, y: 2.4 + Math.random() * 1.5, speed: 0.08 + Math.random() * 0.06, phase: Math.random() * 10 });
    }
  }

  /** Little waterfalls spilling off a few outer islands. */
  setBoard(board: Board) {
    this.fallGroup.clear();
    this.falls = [];
    const outer = board.hexes.filter((h) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) === 2 && h.terrain !== 'storm' && h.terrain !== 'grain');
    const picks = [outer[1], outer[5], outer[9]].filter(Boolean);
    const mat = new THREE.PointsMaterial({ color: 0xcfeeff, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false, map: softTex() });
    for (const h of picks) {
      const dir = new THREE.Vector3(h.x, 0, h.z).normalize();
      const origin = new THREE.Vector3(h.x, -0.05, h.z).add(dir.clone().multiplyScalar(0.84));
      const n = 60;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      const points = new THREE.Points(geo, mat);
      this.fallGroup.add(points);
      const seeds = new Float32Array(n * 2);
      for (let i = 0; i < n * 2; i++) seeds[i] = Math.random();
      this.falls.push({ points, origin, dir, seeds });
    }
  }

  /** Per-frame update. Returns a camera offset for screen shake (apply then remove around render). */
  update(dt: number, t: number): THREE.Vector3 {
    const now = performance.now();

    this.particles = this.particles.filter((p) => {
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        this.group.remove(p.s);
        p.s.material.dispose();
        return false;
      }
      p.v.y -= p.gravity * dt;
      p.v.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(p.size * (1 + p.grow * k));
      p.s.material.opacity = Math.min(1, (1 - k) * 1.6) * (p.s.material.userData.base ?? 1);
      p.s.material.rotation += p.spin * dt;
      return true;
    });

    if (this.dice.length) {
      const el = now - this.diceStart;
      const k = Math.min(1, el / 900);
      const spinK = 1 - Math.pow(1 - Math.min(1, el / 1000), 3);
      for (const d of this.dice) {
        const fall = 1 - bounceOut(k);
        d.mesh.position.x = d.from.x + (d.to.x - d.from.x) * Math.min(1, k * 1.4);
        d.mesh.position.z = d.from.z + (d.to.z - d.from.z) * Math.min(1, k * 1.4);
        d.mesh.position.y = d.to.y + fall * (d.from.y - d.to.y);
        const left = 1 - spinK;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(d.spin.x * left, d.spin.y * left, d.spin.z * left));
        d.mesh.quaternion.copy(d.target).multiply(q);
        const s = el > 2300 ? Math.max(0, 1 - (el - 2300) / 300) : 1;
        d.mesh.scale.setScalar(s);
      }
      if (el > 2650) {
        for (const d of this.dice) this.scene.remove(d.mesh);
        this.dice = [];
      }
    }

    for (const b of this.birds) {
      b.a += b.speed * dt;
      const x = Math.cos(b.a) * b.r, z = Math.sin(b.a) * b.r;
      b.g.position.set(x, b.y + Math.sin(t * 0.7 + b.phase) * 0.3, z);
      b.g.rotation.y = -b.a;
      const flap = Math.sin(t * 9 + b.phase) * 0.6;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
    }

    for (const f of this.falls) {
      const pos = f.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const life = (t * 0.6 + f.seeds[i * 2]) % 1;
        const spread = (f.seeds[i * 2 + 1] - 0.5) * 0.28;
        const side = new THREE.Vector3(-f.dir.z, 0, f.dir.x).multiplyScalar(spread);
        const out = 0.05 + life * 0.25;
        pos.setXYZ(i, f.origin.x + f.dir.x * out + side.x, f.origin.y - life * life * 2.2, f.origin.z + f.dir.z * out + side.z);
      }
      pos.needsUpdate = true;
    }

    if (now < this.fireworksUntil && now > this.nextFirework) {
      this.burst();
      this.nextFirework = now + 250 + Math.random() * 350;
    }

    if (now < this.shakeUntil) {
      const a = this.shakeAmp * ((this.shakeUntil - now) / 450);
      this.shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    } else this.shakeOffset.set(0, 0, 0);
    return this.shakeOffset;
  }
}
