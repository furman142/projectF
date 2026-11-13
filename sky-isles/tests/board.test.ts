import { describe, expect, it } from 'vitest';
import { buildTopology, generateBoard, hexNeighbors } from '../shared/board.ts';

describe('board', () => {
  it('has 19 hexes, 54 vertices and 72 edges', () => {
    const b = buildTopology();
    expect(b.hexes.length).toBe(19);
    expect(b.vertices.length).toBe(54);
    expect(b.edges.length).toBe(72);
    expect(b.edges.filter((e) => e.hexes.length === 1).length).toBe(30);
    for (const v of b.vertices) expect(v.adj.length).toBeGreaterThanOrEqual(2);
  });

  it('places terrain, numbers and docks correctly', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const b = generateBoard({ rng: seed });
      const count = (t: string) => b.hexes.filter((h) => h.terrain === t).length;
      expect([count('timber'), count('clay'), count('fiber'), count('grain'), count('crystal'), count('storm')]).toEqual([4, 3, 4, 4, 3, 1]);
      const storm = b.hexes.find((h) => h.terrain === 'storm')!;
      expect(storm.number).toBeNull();
      for (const h of b.hexes) {
        if (h.number === 6 || h.number === 8) {
          expect(hexNeighbors(b, h).some((n) => n.number === 6 || n.number === 8)).toBe(false);
        }
      }
      expect(b.ports.length).toBe(9);
      const portVerts = b.ports.flatMap((p) => b.edges[p.edge].v);
      expect(new Set(portVerts).size).toBe(18);
    }
  });

  it('is deterministic for a seed', () => {
    expect(generateBoard({ rng: 7 })).toEqual(generateBoard({ rng: 7 }));
  });
});
