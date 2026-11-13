import type { Board, Edge, Hex, Port, Resource, Terrain, Vertex } from './types.ts';
import { shuffle } from './rng.ts';

const SQ3 = Math.sqrt(3);
export const HEX_DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function hexCenter(q: number, r: number) {
  return { x: SQ3 * (q + r / 2), z: 1.5 * r };
}

/** Builds the 19-hex grid with shared vertices and edges (pointy-top hexes, size 1). */
export function buildTopology(): Board {
  const hexes: Hex[] = [];
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const vKey = new Map<string, number>();
  const eKey = new Map<string, number>();

  const vertexAt = (x: number, z: number) => {
    const key = `${Math.round(x * 100)},${Math.round(z * 100)}`;
    let id = vKey.get(key);
    if (id === undefined) {
      id = vertices.length;
      vKey.set(key, id);
      vertices.push({ id, x, z, hexes: [], edges: [], adj: [] });
    }
    return id;
  };

  for (let r = -2; r <= 2; r++) {
    for (let q = Math.max(-2, -r - 2); q <= Math.min(2, -r + 2); q++) {
      const { x, z } = hexCenter(q, r);
      const hex: Hex = { id: hexes.length, q, r, x, z, terrain: 'storm', number: null, vertices: [], edges: [] };
      for (let i = 0; i < 6; i++) {
        const a = ((60 * i - 30) * Math.PI) / 180;
        const v = vertexAt(x + Math.cos(a), z + Math.sin(a));
        hex.vertices.push(v);
        vertices[v].hexes.push(hex.id);
      }
      hexes.push(hex);
    }
  }

  for (const hex of hexes) {
    for (let i = 0; i < 6; i++) {
      const a = hex.vertices[i];
      const b = hex.vertices[(i + 1) % 6];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      let id = eKey.get(key);
      if (id === undefined) {
        id = edges.length;
        eKey.set(key, id);
        edges.push({ id, v: [a, b], hexes: [] });
        vertices[a].edges.push(id);
        vertices[b].edges.push(id);
        vertices[a].adj.push(b);
        vertices[b].adj.push(a);
      }
      edges[id].hexes.push(hex.id);
      hex.edges.push(id);
    }
  }
  return { hexes, vertices, edges, ports: [] };
}

export function hexNeighbors(board: Board, hex: Hex): Hex[] {
  return HEX_DIRS.map(([dq, dr]) => board.hexes.find((h) => h.q === hex.q + dq && h.r === hex.r + dr)).filter(
    (h): h is Hex => !!h,
  );
}

const TERRAINS: Terrain[] = [
  ...Array<Terrain>(4).fill('timber'),
  ...Array<Terrain>(3).fill('clay'),
  ...Array<Terrain>(4).fill('fiber'),
  ...Array<Terrain>(4).fill('grain'),
  ...Array<Terrain>(3).fill('crystal'),
  'storm',
];
const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const PORT_KINDS: (Resource | 'any')[] = ['any', 'any', 'any', 'any', 'timber', 'clay', 'fiber', 'grain', 'crystal'];

/** Random board: shuffled terrain, numbers with no two red numbers (6/8) touching, 9 docks on the coast. */
export function generateBoard(rng: { rng: number }): Board {
  const board = buildTopology();
  const terrains = shuffle(rng, [...TERRAINS]);
  board.hexes.forEach((h, i) => (h.terrain = terrains[i]));
  const land = board.hexes.filter((h) => h.terrain !== 'storm');

  for (let attempt = 0; ; attempt++) {
    const nums = shuffle(rng, [...NUMBERS]);
    land.forEach((h, i) => (h.number = nums[i]));
    const clash = land.some(
      (h) => (h.number === 6 || h.number === 8) && hexNeighbors(board, h).some((n) => n.number === 6 || n.number === 8),
    );
    if (!clash || attempt > 500) break;
  }

  const coast = board.edges
    .filter((e) => e.hexes.length === 1)
    .map((e) => {
      const a = board.vertices[e.v[0]];
      const b = board.vertices[e.v[1]];
      return { e, angle: Math.atan2((a.z + b.z) / 2, (a.x + b.x) / 2) };
    })
    .sort((p, q) => p.angle - q.angle);
  const kinds = shuffle(rng, [...PORT_KINDS]);
  const ports: Port[] = [];
  for (let i = 0; i < 9; i++) ports.push({ edge: coast[Math.floor((i * coast.length) / 9)].e.id, kind: kinds[i] });
  board.ports = ports;
  return board;
}
