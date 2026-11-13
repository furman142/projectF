import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Board, Resource, Terrain } from '../../shared/types.ts';
import type { GameView } from '../../shared/view.ts';
import { RES_ICON } from '../ui/text.ts';
import { Effects } from './effects.ts';

export type TargetKind = 'vertex' | 'edge' | 'hex';

const TERRAIN_COLOR: Record<Terrain, number> = {
  timber: 0x58a34f, clay: 0xd0814f, fiber: 0xa6d8b8, grain: 0xe9c75a, crystal: 0x8d99b0, storm: 0x50536a,
};

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number | string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = `${color}|${JSON.stringify(extra)}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...extra });
    mats.set(key, m);
  }
  return m;
}

function seeded(n: number) {
  let s = (n * 2654435761) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Deterministic jitter keyed by position so shared seam vertices move together (no cracks). */
function jitter(geo: THREE.BufferGeometry, amount: number, seed: number) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const h = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719 + seed) * 43758.5453;
    const f = h - Math.floor(h);
    const g = (Math.sin(h) + 1) / 2;
    pos.setXYZ(i, x + (f - 0.5) * amount, y + (g - 0.5) * amount * 0.6, z + (g - f) * amount * 0.5);
  }
  geo.computeVertexNormals();
  return geo;
}

function spriteFromCanvas(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, w = 128, h = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  return sprite;
}

function numberToken(n: number) {
  const red = n === 6 || n === 8;
  const s = spriteFromCanvas((c, w) => {
    c.beginPath();
    c.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2);
    c.fillStyle = '#fff8e8';
    c.shadowColor = 'rgba(0,0,0,.35)';
    c.shadowBlur = 8;
    c.fill();
    c.shadowBlur = 0;
    c.lineWidth = 5;
    c.strokeStyle = red ? '#d8443a' : '#3a4a66';
    c.stroke();
    c.fillStyle = red ? '#d8443a' : '#24324a';
    c.font = `800 ${n >= 10 ? 52 : 60}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(n), w / 2, w / 2 - 6);
    const dots = 6 - Math.abs(7 - n);
    for (let i = 0; i < dots; i++) {
      c.beginPath();
      c.arc(w / 2 + (i - (dots - 1) / 2) * 11, w / 2 + 32, 4, 0, Math.PI * 2);
      c.fill();
    }
  });
  s.scale.set(0.46, 0.46, 1);
  return s;
}

function dockLabel(kind: Resource | 'any') {
  const s = spriteFromCanvas((c, w, h) => {
    c.fillStyle = 'rgba(255,250,238,.95)';
    c.strokeStyle = '#6a4e36';
    c.lineWidth = 5;
    c.beginPath();
    c.roundRect(6, 6, w - 12, h - 12, 22);
    c.fill();
    c.stroke();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#3d2c1e';
    if (kind === 'any') {
      c.font = '800 46px system-ui, sans-serif';
      c.fillText('?', w / 2, h / 2 - 14);
      c.font = '800 34px system-ui, sans-serif';
      c.fillText('3:1', w / 2, h / 2 + 30);
    } else {
      c.font = '48px system-ui, sans-serif';
      c.fillText(RES_ICON[kind], w / 2, h / 2 - 12);
      c.font = '800 34px system-ui, sans-serif';
      c.fillText('2:1', w / 2, h / 2 + 32);
    }
  });
  s.scale.set(0.42, 0.42, 1);
  return s;
}

// Shared geometries
const G = {
  top: new THREE.CylinderGeometry(0.95, 0.97, 0.24, 6, 1),
  trunk: new THREE.CylinderGeometry(0.025, 0.035, 0.1, 5),
  tree: new THREE.ConeGeometry(0.12, 0.34, 6),
  tree2: new THREE.ConeGeometry(0.09, 0.24, 6),
  mound: new THREE.SphereGeometry(0.14, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2),
  brick: new THREE.BoxGeometry(0.11, 0.05, 0.06),
  puff: new THREE.IcosahedronGeometry(0.07, 0),
  stem: new THREE.CylinderGeometry(0.012, 0.012, 0.1, 4),
  row: new THREE.BoxGeometry(0.9, 0.07, 0.11),
  hay: new THREE.ConeGeometry(0.08, 0.13, 7),
  crystal: new THREE.OctahedronGeometry(0.09, 0),
  rock: new THREE.DodecahedronGeometry(0.08, 0),
  stormPuff: new THREE.IcosahedronGeometry(0.16, 1),
  outpostBody: new THREE.BoxGeometry(0.2, 0.15, 0.2),
  outpostRoof: new THREE.ConeGeometry(0.17, 0.15, 4),
  citadelBase: new THREE.BoxGeometry(0.28, 0.12, 0.28),
  citadelTower: new THREE.CylinderGeometry(0.1, 0.12, 0.3, 8),
  citadelCap: new THREE.ConeGeometry(0.14, 0.17, 8),
  bridgeDeck: new THREE.BoxGeometry(0.68, 0.045, 0.13),
  bridgePost: new THREE.BoxGeometry(0.035, 0.12, 0.035),
  dock: new THREE.BoxGeometry(0.34, 0.05, 0.24),
  plank: new THREE.BoxGeometry(0.05, 0.03, 0.4),
  balloon: new THREE.SphereGeometry(0.26, 14, 10),
  band: new THREE.TorusGeometry(0.262, 0.025, 6, 20),
  gondola: new THREE.BoxGeometry(0.24, 0.09, 0.15),
  fin: new THREE.BoxGeometry(0.02, 0.14, 0.12),
  cloudPuff: new THREE.IcosahedronGeometry(0.5, 1),
  tVertex: new THREE.SphereGeometry(0.1, 14, 10),
  tVertexHit: new THREE.SphereGeometry(0.22, 8, 6),
  tEdge: new THREE.BoxGeometry(0.56, 0.05, 0.12),
  tEdgeHit: new THREE.BoxGeometry(0.6, 0.2, 0.32),
  tHex: new THREE.CylinderGeometry(0.72, 0.72, 0.04, 6),
};

interface Anim { obj: THREE.Object3D; start: number; y: number }

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  readonly controls: OrbitControls;
  private root = new THREE.Group();
  private board: Board | null = null;
  private boardKey = '';
  private tops: THREE.Mesh[] = [];
  private tokens: THREE.Sprite[] = [];
  private pieces = new Map<string, { obj: THREE.Object3D; kind: string }>();
  private piecesGroup = new THREE.Group();
  private targets = new THREE.Group();
  private pirate = new THREE.Group();
  private pirateGoal = new THREE.Vector3(0, 1.2, 0);
  private clouds: { obj: THREE.Object3D; r: number; a: number; speed: number; y: number }[] = [];
  private anims: Anim[] = [];
  private flashes: { mesh: THREE.Mesh; until: number }[] = [];
  private bolt: THREE.Mesh | null = null;
  private stormCloud: THREE.Group | null = null;
  private onPick: ((id: number) => void) | null = null;
  private hover: THREE.Object3D | null = null;
  private down = { x: 0, y: 0, t: 0 };
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private last = 0;
  private tokenBounce: { t: THREE.Sprite; start: number; base: number }[] = [];
  private pirateHex = -1;
  readonly fx: Effects;

  constructor(canvas: HTMLCanvasElement) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 2 : 2));
    this.renderer.shadowMap.enabled = !mobile;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.add(new THREE.HemisphereLight(0xdff0ff, 0x7a6a5a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    sun.position.set(5, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);

    this.scene.add(this.root);
    this.root.add(this.piecesGroup, this.targets, this.pirate);
    this.buildPirate();
    this.buildClouds();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.15;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 20;
    this.controls.target.set(0, 0, 0.4);
    this.camera.position.set(0, 10.5, 8);
    this.fx = new Effects(this.scene, this.root, this.camera, this.controls.target);

    canvas.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    canvas.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit !== null && this.onPick) this.onPick(hit);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const obj = this.pickObject(e.clientX, e.clientY);
      this.hover = obj;
      canvas.style.cursor = obj ? 'pointer' : '';
    });
    addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Keep the whole archipelago visible in portrait by widening the vertical FOV.
    const hfov = 2 * Math.atan(Math.tan((27 * Math.PI) / 180) / aspect);
    this.camera.fov = Math.min(80, Math.max(42, (hfov * 180) / Math.PI));
    this.camera.updateProjectionMatrix();
  }

  /** Builds islands, numbers and docks. Only rebuilds when the board changes. */
  setBoard(board: Board) {
    const key = JSON.stringify(board.hexes.map((h) => [h.terrain, h.number])) + JSON.stringify(board.ports);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board = board;
    for (const child of [...this.root.children]) {
      if (child !== this.piecesGroup && child !== this.targets && child !== this.pirate && !child.userData.keep) this.root.remove(child);
    }
    this.piecesGroup.clear();
    this.pieces.clear();
    this.tops = [];
    this.tokens = [];
    this.bolt = null;
    this.stormCloud = null;
    this.pirateHex = -1;
    this.fx.setBoard(board);

    for (const hex of board.hexes) {
      const g = new THREE.Group();
      g.position.set(hex.x, 0, hex.z);
      const top = new THREE.Mesh(G.top, [
        mat(0x8e6b4c),
        mat(TERRAIN_COLOR[hex.terrain], { emissive: 0xffffff, emissiveIntensity: 0 }).clone(),
        mat(0x6f533d),
      ]);
      top.position.y = -0.12;
      top.receiveShadow = true;
      top.castShadow = true;
      top.userData.hex = hex.id;
      top.userData.base = new THREE.Color(TERRAIN_COLOR[hex.terrain]);
      g.add(top);
      this.tops.push(top);

      const rock = new THREE.Mesh(jitter(new THREE.ConeGeometry(0.82, 1.3 + (hex.id % 3) * 0.18, 8, 3), 0.16, hex.id), mat(0x8a6a4f));
      rock.rotation.x = Math.PI;
      rock.rotation.y = hex.id;
      rock.position.y = -0.24 - (1.3 + (hex.id % 3) * 0.18) / 2;
      g.add(rock);

      this.decorate(g, hex.terrain, hex.id);

      if (hex.number) {
        const t = numberToken(hex.number);
        t.position.set(0, 0.62, 0);
        if (innerWidth < innerHeight) t.scale.setScalar(0.62);
        g.add(t);
        this.tokens[hex.id] = t;
      }
      this.root.add(g);
    }

    for (const port of board.ports) {
      const e = board.edges[port.edge];
      const a = board.vertices[e.v[0]], b = board.vertices[e.v[1]];
      const h = board.hexes[e.hexes[0]];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const dx = mx - h.x, dz = mz - h.z;
      const len = Math.hypot(dx, dz);
      const px = mx + (dx / len) * 0.5, pz = mz + (dz / len) * 0.5;
      const g = new THREE.Group();
      const dock = new THREE.Mesh(G.dock, mat(0x9c7350));
      dock.position.set(px, -0.06, pz);
      dock.rotation.y = Math.atan2(dx, dz);
      dock.castShadow = true;
      g.add(dock);
      for (const v of [a, b]) {
        const plank = new THREE.Mesh(G.plank, mat(0xb88b60));
        const vx = v.x * 0.92 + mx * 0.08, vz = v.z * 0.92 + mz * 0.08;
        plank.position.set((px + vx) / 2, -0.04, (pz + vz) / 2);
        plank.scale.z = Math.hypot(px - vx, pz - vz) / 0.4;
        plank.lookAt(vx, -0.04, vz);
        g.add(plank);
      }
      const label = dockLabel(port.kind);
      label.position.set(px, 0.32, pz);
      g.add(label);
      this.root.add(g);
    }
  }

  private decorate(g: THREE.Group, terrain: Terrain, id: number) {
    const rnd = seeded(id + 11);
    const spots: [number, number][] = [];
    for (let tries = 0; spots.length < 8 && tries < 200; tries++) {
      const a = rnd() * Math.PI * 2, r = 0.18 + rnd() * 0.42;
      const p: [number, number] = [Math.cos(a) * r, Math.sin(a) * r];
      if (spots.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.19)) spots.push(p);
    }
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, s = 1) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(s);
      mesh.rotation.y = rnd() * Math.PI;
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    switch (terrain) {
      case 'timber':
        for (const [x, z] of spots.slice(0, 7)) {
          const s = 0.8 + rnd() * 0.5;
          add(G.trunk, mat(0x6b4a2f), x, 0.05 * s, z, s);
          add(G.tree, mat(rnd() > 0.5 ? 0x2e6e3a : 0x3a7d3f), x, 0.24 * s, z, s);
          add(G.tree2, mat(0x4a8f47), x, 0.38 * s, z, s);
        }
        break;
      case 'clay':
        spots.slice(0, 4).forEach(([x, z]) => add(G.mound, mat(0xb85a33), x, 0, z, 0.9 + rnd() * 0.5).scale.y *= 0.7);
        for (const [x, z] of spots.slice(4, 7)) {
          add(G.brick, mat(0xa4462a), x, 0.025, z);
          add(G.brick, mat(0xa4462a), x + 0.02, 0.075, z);
        }
        break;
      case 'fiber':
        for (const [x, z] of spots.slice(0, 7)) {
          add(G.stem, mat(0x4f8a54), x, 0.05, z);
          for (let i = 0; i < 3; i++) add(G.puff, mat(0xfbf8ff), x + (rnd() - 0.5) * 0.08, 0.12 + rnd() * 0.06, z + (rnd() - 0.5) * 0.08, 0.7 + rnd() * 0.4);
        }
        break;
      case 'grain':
        for (let i = -2; i <= 2; i++) {
          const row = add(G.row, mat(i % 2 ? 0xd9a636 : 0xf0cf6a), 0, 0.035, i * 0.2);
          row.rotation.y = 0.5;
          row.scale.x = 1 - Math.abs(i) * 0.22;
        }
        add(G.hay, mat(0xc7942e), spots[0][0], 0.13, spots[0][1]);
        break;
      case 'crystal':
        for (const [x, z] of spots.slice(0, 5)) {
          const c = add(G.crystal, mat(0x66e6ff, { emissive: 0x2ab8ff, emissiveIntensity: 0.55, roughness: 0.3 }), x, 0.12, z, 0.9 + rnd() * 0.7);
          c.scale.y *= 1.7;
          c.rotation.z = (rnd() - 0.5) * 0.4;
        }
        for (const [x, z] of spots.slice(5, 8)) add(G.rock, mat(0x6f7787), x, 0.04, z, 0.8 + rnd() * 0.6);
        break;
      case 'storm': {
        for (const [x, z] of spots.slice(0, 5)) add(G.rock, mat(0x3c3f4f), x, 0.04, z, 1 + rnd());
        const cloud = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const p = new THREE.Mesh(G.stormPuff, mat(0x5d6175, { emissive: 0xc9d4ff, emissiveIntensity: 0 }).clone());
          p.position.set((i - 2) * 0.13, Math.sin(i * 2) * 0.04, Math.cos(i * 3) * 0.08);
          p.scale.setScalar(0.8 + (i % 2) * 0.4);
          cloud.add(p);
        }
        cloud.position.y = 1.0;
        g.add(cloud);
        this.stormCloud = cloud;
        const shape = new THREE.Shape([
          new THREE.Vector2(0, 0), new THREE.Vector2(0.08, 0.22), new THREE.Vector2(0.02, 0.22),
          new THREE.Vector2(0.1, 0.45), new THREE.Vector2(-0.04, 0.18), new THREE.Vector2(0.03, 0.18), new THREE.Vector2(-0.05, 0),
        ].map((v) => v.multiplyScalar(1.6)).reverse());
        const bolt = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xfff27a, side: THREE.DoubleSide }));
        bolt.rotation.z = Math.PI;
        bolt.position.set(0.05, 0.92, 0);
        bolt.visible = false;
        g.add(bolt);
        this.bolt = bolt;
        break;
      }
    }
  }

  private buildPirate() {
    const balloon = new THREE.Mesh(G.balloon, mat(0x34303f));
    balloon.scale.set(1.35, 0.85, 0.85);
    balloon.castShadow = true;
    const band = new THREE.Mesh(G.band, mat(0xc0392b));
    band.rotation.y = Math.PI / 2;
    band.scale.set(0.85, 0.85, 1);
    const gondola = new THREE.Mesh(G.gondola, mat(0x6e4b2e));
    gondola.position.y = -0.33;
    gondola.castShadow = true;
    const fin1 = new THREE.Mesh(G.fin, mat(0xc0392b));
    fin1.position.set(-0.36, 0, 0);
    const fin2 = fin1.clone();
    fin2.rotation.x = Math.PI / 2;
    const ropes = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.1, -0.29, -0.06), new THREE.Vector3(-0.18, -0.12, -0.12),
        new THREE.Vector3(0.1, -0.29, -0.06), new THREE.Vector3(0.18, -0.12, -0.12),
        new THREE.Vector3(-0.1, -0.29, 0.06), new THREE.Vector3(-0.18, -0.12, 0.12),
        new THREE.Vector3(0.1, -0.29, 0.06), new THREE.Vector3(0.18, -0.12, 0.12),
      ]),
      new THREE.LineBasicMaterial({ color: 0x2a2018 }),
    );
    this.pirate.add(balloon, band, gondola, fin1, fin2, ropes);
    this.pirate.position.copy(this.pirateGoal);
  }

  private buildClouds() {
    const rnd = seeded(99);
    for (let i = 0; i < 16; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) {
        const p = new THREE.Mesh(G.cloudPuff, mat(0xffffff, { roughness: 1, transparent: true, opacity: 0.92 }));
        p.position.set((j - n / 2) * 0.55, rnd() * 0.25, (rnd() - 0.5) * 0.5);
        p.scale.setScalar(0.7 + rnd() * 0.7);
        c.add(p);
      }
      const r = 5.5 + rnd() * 6;
      const cloud = { obj: c, r, a: rnd() * Math.PI * 2, speed: 0.01 + rnd() * 0.02, y: -2.2 - rnd() * 2.5 };
      c.scale.setScalar(0.8 + rnd() * 0.9);
      this.clouds.push(cloud);
      this.scene.add(c);
    }
  }

  private makePiece(kind: string, color: string): THREE.Object3D {
    const body = mat(color);
    const dark = mat(new THREE.Color(color).multiplyScalar(0.62).getHex());
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, x = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    if (kind === 'outpost') {
      add(G.outpostBody, body, 0.075);
      add(G.outpostRoof, dark, 0.225).rotation.y = Math.PI / 4;
    } else if (kind === 'citadel') {
      add(G.citadelBase, body, 0.06);
      add(G.citadelTower, body, 0.27);
      add(G.citadelCap, dark, 0.5);
    } else {
      add(G.bridgeDeck, body, 0.03);
      for (const x of [-0.3, 0.3]) for (const z of [-0.055, 0.055]) add(G.bridgePost, dark, 0.08, x, z);
    }
    return g;
  }

  /** Syncs pieces and the pirate with the latest game view. */
  update(view: GameView) {
    this.setBoard(view.board);
    const b = this.board!;
    const seen = new Set<string>();
    view.buildings.forEach((bd, v) => {
      if (!bd) return;
      const key = `v${v}`;
      const kind = bd.citadel ? 'citadel' : 'outpost';
      seen.add(key);
      const cur = this.pieces.get(key);
      if (cur?.kind === kind) return;
      if (cur) this.piecesGroup.remove(cur.obj);
      const obj = this.makePiece(kind, view.players[bd.owner].color);
      obj.position.set(b.vertices[v].x, 0, b.vertices[v].z);
      obj.rotation.y = v * 1.3;
      this.drop(obj);
      this.pieces.set(key, { obj, kind });
    });
    view.bridges.forEach((owner, e) => {
      if (owner === null) return;
      const key = `e${e}`;
      seen.add(key);
      if (this.pieces.has(key)) return;
      const [a, c] = b.edges[e].v.map((i) => b.vertices[i]);
      const obj = this.makePiece('bridge', view.players[owner].color);
      obj.position.set((a.x + c.x) / 2, 0, (a.z + c.z) / 2);
      obj.rotation.y = -Math.atan2(c.z - a.z, c.x - a.x);
      this.drop(obj);
      this.pieces.set(key, { obj, kind: 'bridge' });
    });
    for (const [key, p] of this.pieces) {
      if (!seen.has(key)) {
        this.piecesGroup.remove(p.obj);
        this.pieces.delete(key);
      }
    }
    const h = b.hexes[view.pirate];
    this.pirateGoal.set(h.x + 0.05, 1.3, h.z - 0.1);
    if (this.pirateHex !== view.pirate) {
      // The island under the pirate falls into shadow.
      this.tops.forEach((top, i) => {
        const m = (top.material as THREE.MeshStandardMaterial[])[1];
        m.color.copy(top.userData.base as THREE.Color);
        if (i === view.pirate) m.color.multiplyScalar(0.55);
      });
      this.pirateHex = view.pirate;
    }
    this.tokens.forEach((t, i) => t && ((t.material as THREE.SpriteMaterial).opacity = i === view.pirate ? 0.35 : 1));
  }

  private drop(obj: THREE.Object3D) {
    this.piecesGroup.add(obj);
    this.anims.push({ obj, start: performance.now(), y: obj.position.y });
    obj.scale.setScalar(0.01);
  }

  hexPos(id: number) {
    const h = this.board!.hexes[id];
    return new THREE.Vector3(h.x, 0, h.z);
  }
  vertexPos(id: number) {
    const v = this.board!.vertices[id];
    return new THREE.Vector3(v.x, 0, v.z);
  }
  edgePos(id: number) {
    const [a, c] = this.board!.edges[id].v.map((i) => this.board!.vertices[i]);
    return new THREE.Vector3((a.x + c.x) / 2, 0, (a.z + c.z) / 2);
  }

  /** Number tokens matching the roll jump and glow. */
  bounceTokens(total: number) {
    if (!this.board) return;
    const now = performance.now();
    for (const h of this.board.hexes) {
      const t = this.tokens[h.id];
      if (t && h.number === total) this.tokenBounce.push({ t, start: now, base: t.scale.x });
    }
  }

  /** Briefly lights up islands (e.g. ones that just produced). */
  flashHexes(ids: number[]) {
    const until = performance.now() + 900;
    for (const id of new Set(ids)) if (this.tops[id]) this.flashes.push({ mesh: this.tops[id], until });
  }

  /** Shows clickable markers at the given spots. Pass null to clear. */
  setTargets(kind: TargetKind | null, ids: number[], color: string, onPick: ((id: number) => void) | null) {
    this.targets.clear();
    this.hover = null;
    this.onPick = onPick;
    if (!kind || !this.board) return;
    const b = this.board;
    const show = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false });
    const hit = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    for (const id of ids) {
      const g = new THREE.Group();
      g.userData.id = id;
      if (kind === 'vertex') {
        const v = b.vertices[id];
        g.position.set(v.x, 0.1, v.z);
        g.add(new THREE.Mesh(G.tVertex, show), new THREE.Mesh(G.tVertexHit, hit));
      } else if (kind === 'edge') {
        const [a, c] = b.edges[id].v.map((i) => b.vertices[i]);
        g.position.set((a.x + c.x) / 2, 0.05, (a.z + c.z) / 2);
        g.rotation.y = -Math.atan2(c.z - a.z, c.x - a.x);
        g.add(new THREE.Mesh(G.tEdge, show), new THREE.Mesh(G.tEdgeHit, hit));
      } else {
        const h = b.hexes[id];
        g.position.set(h.x, 0.03, h.z);
        g.add(new THREE.Mesh(G.tHex, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false })));
      }
      g.children.forEach((c) => (c.userData.id = id));
      this.targets.add(g);
    }
  }

  private pickObject(x: number, y: number): THREE.Object3D | null {
    if (!this.targets.children.length) return null;
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.targets.children, true);
    return hits.length ? hits[0].object.parent : null;
  }

  private pick(x: number, y: number): number | null {
    const obj = this.pickObject(x, y);
    return obj ? (obj.userData.id as number) : null;
  }

  /** Screen position (CSS px) of a board point, for DOM effects. */
  screenPos(x: number, z: number, y = 0.3): { x: number; y: number } {
    const v = new THREE.Vector3(x, y + this.root.position.y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  }
  hexScreen(id: number) {
    const h = this.board!.hexes[id];
    return this.screenPos(h.x, h.z, 0.4);
  }
  vertexScreen(id: number) {
    const v = this.board!.vertices[id];
    return this.screenPos(v.x, v.z, 0.2);
  }

  private frame() {
    const t = this.clock.getElapsedTime();
    const now = performance.now();
    const dt = Math.min(0.05, t - this.last);
    this.last = t;
    this.root.position.y = Math.sin(t * 0.7) * 0.05;
    this.controls.update();

    for (const c of this.clouds) {
      c.a += c.speed * 0.016;
      c.obj.position.set(Math.cos(c.a) * c.r, c.y + Math.sin(t * 0.3 + c.r) * 0.15, Math.sin(c.a) * c.r);
    }

    this.pirate.position.lerp(this.pirateGoal, 0.04);
    this.pirate.position.y = this.pirateGoal.y + Math.sin(t * 1.8) * 0.06;
    this.pirate.rotation.y = Math.sin(t * 0.5) * 0.4;
    this.pirate.rotation.z = Math.sin(t * 1.3) * 0.05;

    this.anims = this.anims.filter((a) => {
      const k = Math.min(1, (now - a.start) / 450);
      const back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
      a.obj.scale.setScalar(Math.max(0.01, back));
      a.obj.position.y = a.y + (1 - k) * (1 - k) * 0.8;
      return k < 1;
    });

    this.flashes = this.flashes.filter((f) => {
      const m = (f.mesh.material as THREE.MeshStandardMaterial[])[1];
      const left = f.until - now;
      m.emissiveIntensity = left > 0 ? 0.35 * Math.abs(Math.sin((left / 900) * Math.PI * 2)) : 0;
      return left > 0;
    });

    const pulse = 1 + Math.sin(t * 5) * 0.12;
    for (const g of this.targets.children) {
      const s = g === this.hover ? 1.45 : pulse;
      g.children[0].scale.set(s, g.userData.id !== undefined && this.targets.children.length && (g.children[0] as THREE.Mesh).geometry === G.tHex ? 1 : s, s);
    }

    if (this.bolt && this.stormCloud) {
      const flash = Math.sin(t * 1.7) > 0.985 || Math.sin(t * 2.9 + 1) > 0.992;
      this.bolt.visible = flash;
      for (const p of this.stormCloud.children) ((p as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = flash ? 0.8 : 0;
      this.stormCloud.position.x = Math.sin(t * 0.4) * 0.08;
    }

    this.tokenBounce = this.tokenBounce.filter((b) => {
      const k = (now - b.start) / 900;
      const jump = k < 1 ? Math.sin(k * Math.PI) : 0;
      b.t.scale.setScalar(b.base * (1 + jump * 0.45));
      b.t.position.y = 0.62 + jump * 0.35;
      return k < 1;
    });

    const shake = this.fx.update(dt, t);
    this.camera.position.add(shake);
    this.renderer.render(this.scene, this.camera);
    this.camera.position.sub(shake);
  }
}
