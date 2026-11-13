import { describe, expect, it } from 'vitest';
import { newGame, reduce, legalBridges, legalOutposts, longestBridge, pirateVictims, tradeRatio, totalGlory, outpostOk } from '../shared/engine.ts';
import { COSTS, emptyRes, resTotal, type Action, type GameState, type ResMap } from '../shared/types.ts';
import { checkInvariants } from './invariants.ts';

/** A blank 3-player game already in player 0's main phase, with no pieces. Build the scene by hand. */
function blank(n = 3): GameState {
  const s = newGame({ seed: 42, players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000', bot: false })) });
  s.phase = 'main';
  s.setupStep = s.setupOrder.length;
  s.turnNumber = 1;
  s.dice = [3, 4];
  return s;
}
const ok = (s: GameState, p: number, a: Action) => {
  const r = reduce(s, p, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
};
const err = (s: GameState, p: number, a: Action) => {
  const r = reduce(s, p, a);
  expect(r.ok, `${a.type} should fail`).toBe(false);
  return r.ok ? '' : r.error;
};
const res = (m: Partial<ResMap>): ResMap => ({ ...emptyRes(), ...m });
const give = (s: GameState, p: number, m: Partial<ResMap>) => {
  for (const [k, v] of Object.entries(m)) { (s.players[p].hand as Record<string, number>)[k] += v!; (s.bank as Record<string, number>)[k] -= v!; }
};
/** Places an outpost with one bridge for `p` at vertex v (no rules checked). */
function settle(s: GameState, p: number, v: number, citadel = false) {
  s.buildings[v] = { owner: p, citadel };
  const e = s.board.vertices[v].edges.find((e) => s.bridges[e] === null)!;
  s.bridges[e] = p;
  return e;
}
/** A path of `len` connected edges starting at vertex v, avoiding vertices in `avoid`. */
function path(s: GameState, v: number, len: number): { edges: number[]; verts: number[] } {
  const edges: number[] = [], verts = [v];
  for (let i = 0; i < len; i++) {
    const cur = verts[verts.length - 1];
    const e = s.board.vertices[cur].edges.find((e) => {
      const o = s.board.edges[e].v.find((x) => x !== cur)!;
      return !verts.includes(o) && s.bridges[e] === null && !edges.includes(e);
    });
    if (e === undefined) throw new Error('path stuck');
    edges.push(e);
    verts.push(s.board.edges[e].v.find((x) => x !== cur)!);
  }
  return { edges, verts };
}
const coastVertex = (s: GameState) => s.board.vertices.find((v) => v.hexes.length === 1)!.id;
/** Recomputes derived bridge lengths after hand-placing pieces. */
const sync = (s: GameState) => s.players.forEach((p, i) => (p.longest = longestBridge(s, i)));
/** Gives charters taken from the deck so the 25-card total stays right. */
function deal(s: GameState, p: number, kinds: GameState['deck']) {
  for (const k of kinds) {
    const i = s.deck.indexOf(k);
    if (i < 0) throw new Error(`no ${k} left in deck`);
    s.deck.splice(i, 1);
    s.players[p].charters.push(k);
  }
}

describe('setup', () => {
  it('only the second outpost pays out, one card per adjacent non-storm island', () => {
    let s = newGame({ seed: 5, players: [{ name: 'a', color: '', bot: false }, { name: 'b', color: '', bot: false }] });
    const v1 = s.board.vertices.find((v) => v.hexes.length === 3)!.id;
    s = ok(s, 0, { type: 'placeOutpost', vertex: v1 });
    expect(resTotal(s.players[0].hand)).toBe(0);
    s = ok(s, 0, { type: 'placeBridge', edge: legalBridges(s, 0)[0] });
    s = ok(s, 1, { type: 'placeOutpost', vertex: legalOutposts(s, 1)[10] });
    s = ok(s, 1, { type: 'placeBridge', edge: legalBridges(s, 1)[0] });
    // Player 1 goes again (snake order)
    expect(s.current).toBe(1);
    const v2 = legalOutposts(s, 1).find((v) => s.board.vertices[v].hexes.length === 3 && s.board.vertices[v].hexes.every((h) => s.board.hexes[h].terrain !== 'storm'))!;
    s = ok(s, 1, { type: 'placeOutpost', vertex: v2 });
    expect(resTotal(s.players[1].hand)).toBe(3);
    expect(err(s, 1, { type: 'endTurn' })).toBeTruthy();
    expect(err(s, 1, { type: 'roll' })).toBeTruthy();
  });

  it('cannot place two outposts in a row or a bridge first', () => {
    let s = newGame({ seed: 5, players: [{ name: 'a', color: '', bot: false }, { name: 'b', color: '', bot: false }] });
    err(s, 0, { type: 'placeBridge', edge: 0 });
    s = ok(s, 0, { type: 'placeOutpost', vertex: 0 });
    err(s, 0, { type: 'placeOutpost', vertex: 30 });
  });
});

describe('building', () => {
  it('outposts after setup must touch your own bridge, and bridges cannot pass an opponent building', () => {
    const s = blank();
    const v = coastVertex(s);
    const e = settle(s, 0, v);
    const far = s.board.edges[e].v.find((x) => x !== v)!;
    give(s, 0, { ...COSTS.outpost });
    // far is adjacent to v: distance rule
    expect(outpostOk(s, 0, far)).toBe(false);
    // An opponent building at the end of my bridge blocks extending through it.
    const t = structuredClone(s);
    t.buildings[far] = { owner: 1, citadel: false };
    const through = t.board.vertices[far].edges.filter((x) => x !== e);
    for (const x of through) expect(legalBridges(t, 0)).not.toContain(x);
  });

  it('piece limits: 5 outposts, upgrading frees one', () => {
    const s = blank();
    const spots = [0, 10, 20, 30, 40].map((i) => s.board.vertices.filter((v) => !s.board.vertices[v.id].adj.some((a) => s.buildings[a]))[i]?.id);
    let placed = 0;
    for (const v of s.board.vertices.map((x) => x.id)) {
      if (placed === 5) break;
      if (!s.buildings[v] && s.board.vertices[v].adj.every((a) => !s.buildings[a])) { settle(s, 0, v); placed++; }
    }
    void spots;
    const target = legalOutposts(s, 0)[0];
    give(s, 0, { ...COSTS.outpost });
    if (target !== undefined) expect(err(s, 0, { type: 'placeOutpost', vertex: target })).toMatch(/No outposts left/);
    give(s, 0, { ...COSTS.citadel });
    const own = s.buildings.findIndex((b) => b?.owner === 0);
    const t = ok(s, 0, { type: 'upgrade', vertex: own });
    if (target !== undefined && outpostOk(t, 0, target)) ok(t, 0, { type: 'placeOutpost', vertex: target });
  });
});

describe('production', () => {
  it('a citadel gets 2, the pirate blocks, and a bank shortage with 2 claimants pays nobody', () => {
    const s = blank();
    const hex = s.board.hexes.find((h) => h.number && h.terrain !== 'storm')!;
    const r = hex.terrain as keyof ResMap;
    settle(s, 0, hex.vertices[0], true);
    settle(s, 1, hex.vertices[3]);
    s.phase = 'roll';
    const roll = (t: GameState) => {
      for (let seed = 0; seed < 5000; seed++) {
        const u = structuredClone(t);
        u.rng = seed;
        const out = reduce(u, 0, { type: 'roll' });
        if (out.ok && out.state.dice![0] + out.state.dice![1] === hex.number) return out.state;
      }
      throw new Error('no roll');
    };
    const a = roll(s);
    expect(a.players[0].hand[r]).toBe(2);
    expect(a.players[1].hand[r]).toBe(1);

    const blocked = structuredClone(s);
    blocked.pirate = hex.id;
    const b = roll(blocked);
    expect(b.players[0].hand[r] + b.players[1].hand[r]).toBe(0);

    const short = structuredClone(s);
    give(short, 2, { [r]: 17 }); // bank keeps 2, demand is 3
    const c = roll(short);
    expect(c.players[0].hand[r]).toBe(0);
    expect(c.players[1].hand[r]).toBe(0);

    const single = structuredClone(s);
    single.buildings[hex.vertices[3]] = null;
    give(single, 2, { [r]: 18 }); // bank keeps 1, only player 0 claims 2
    const d = roll(single);
    expect(d.players[0].hand[r]).toBe(1);
    expect(d.bank[r]).toBe(0);
  });
});

describe('the pirate', () => {
  it('needs a different island, a valid victim, and skips players without cards', () => {
    const s = blank();
    s.phase = 'pirate';
    const hex = s.board.hexes.find((h) => h.id !== s.pirate)!;
    settle(s, 1, hex.vertices[0]);
    settle(s, 2, hex.vertices[3]);
    give(s, 1, { timber: 2 });
    err(s, 0, { type: 'movePirate', hex: s.pirate, victim: null });
    expect(pirateVictims(s, 0, hex.id)).toEqual([1]);
    err(s, 0, { type: 'movePirate', hex: hex.id, victim: null });
    err(s, 0, { type: 'movePirate', hex: hex.id, victim: 2 });
    err(s, 0, { type: 'movePirate', hex: hex.id, victim: 0 });
    const t = ok(s, 0, { type: 'movePirate', hex: hex.id, victim: 1 });
    expect(t.players[0].hand.timber).toBe(1);
    expect(t.phase).toBe('main');
  });

  it('friendly pirate protects players with 2 or less glory', () => {
    const s = blank();
    s.options.friendlyPirate = true;
    s.phase = 'pirate';
    const hex = s.board.hexes.find((h) => h.id !== s.pirate)!;
    settle(s, 1, hex.vertices[0]);
    give(s, 1, { clay: 3 });
    expect(pirateVictims(s, 0, hex.id)).toEqual([]);
    s.buildings[hex.vertices[0]] = { owner: 1, citadel: true }; // 2 glory: still protected
    expect(pirateVictims(s, 0, hex.id)).toEqual([]);
    settle(s, 1, hex.vertices[3]); // 3 glory
    expect(pirateVictims(s, 0, hex.id)).toEqual([1]);
  });

  it('a 7 makes players over 7 discard exactly half, then the pirate moves', () => {
    const s = blank();
    s.phase = 'roll';
    give(s, 1, { timber: 5, clay: 4 }); // 9 cards -> discard 4
    give(s, 2, { grain: 7 });            // 7 cards -> safe
    let t: GameState | null = null;
    for (let seed = 0; !t; seed++) {
      const u = structuredClone(s); u.rng = seed;
      const r = reduce(u, 0, { type: 'roll' });
      if (r.ok && r.state.dice![0] + r.state.dice![1] === 7) t = r.state;
    }
    expect(t.phase).toBe('discard');
    expect(t.discards).toEqual([0, 4, 0]);
    err(t, 2, { type: 'discard', cards: res({ grain: 3 }) });
    err(t, 1, { type: 'discard', cards: res({ timber: 3 }) });
    err(t, 1, { type: 'discard', cards: res({ grain: 4 }) });
    err(t, 0, { type: 'movePirate', hex: 0, victim: null });
    t = ok(t, 1, { type: 'discard', cards: res({ timber: 2, clay: 2 }) });
    expect(t.phase).toBe('pirate');
    err(t, 1, { type: 'discard', cards: res({ timber: 1 }) });
  });
});

describe('charters', () => {
  it('a knight before rolling returns to the roll phase', () => {
    const s = blank();
    s.phase = 'roll';
    s.players[0].charters = ['knight'];
    let t = ok(s, 0, { type: 'playCharter', kind: 'knight' });
    expect(t.phase).toBe('pirate');
    const hex = t.board.hexes.find((h) => h.id !== t.pirate)!.id;
    t = ok(t, 0, { type: 'movePirate', hex, victim: null });
    expect(t.phase).toBe('roll');
    err(t, 0, { type: 'endTurn' });
    ok(t, 0, { type: 'roll' });
  });

  it('only one charter per turn, never one bought this turn, and glory cannot be played', () => {
    const s = blank();
    s.players[0].charters = ['plenty', 'monopoly', 'glory'];
    s.players[0].newCharters = ['knight'];
    err(s, 0, { type: 'playCharter', kind: 'knight' });
    err(s, 0, { type: 'playCharter', kind: 'glory' as never });
    const t = ok(s, 0, { type: 'playCharter', kind: 'plenty', res: ['crystal', 'crystal'] });
    expect(t.players[0].hand.crystal).toBe(2);
    err(t, 0, { type: 'playCharter', kind: 'monopoly', res: ['clay'] });
  });

  it('plenty fails if the bank is out; monopoly takes everything', () => {
    const s = blank();
    deal(s, 0, ['plenty', 'monopoly']);
    give(s, 1, { crystal: 19 });
    err(s, 0, { type: 'playCharter', kind: 'plenty', res: ['crystal', 'grain'] });
    give(s, 2, { grain: 3 });
    const t = ok(s, 0, { type: 'playCharter', kind: 'monopoly', res: ['crystal'] });
    expect(t.players[0].hand.crystal).toBe(19);
    expect(t.players[1].hand.crystal).toBe(0);
    checkInvariants(t);
  });

  it('bridge builders gives 2 free bridges, or 1 if only 1 is left', () => {
    const s = blank();
    settle(s, 0, coastVertex(s));
    s.players[0].charters = ['bridges'];
    let t = ok(s, 0, { type: 'playCharter', kind: 'bridges' });
    expect(t.phase).toBe('freeBridges');
    err(t, 0, { type: 'endTurn' });
    t = ok(t, 0, { type: 'placeBridge', edge: legalBridges(t, 0)[0] });
    t = ok(t, 0, { type: 'placeBridge', edge: legalBridges(t, 0)[0] });
    expect(t.phase).toBe('main');
    expect(resTotal(t.players[0].hand)).toBe(0);

    const u = blank();
    const v = coastVertex(u);
    settle(u, 0, v);
    const p = path(u, v, 13);
    p.edges.forEach((e) => (u.bridges[e] = 0)); // 14 bridges used
    u.players[0].charters = ['bridges'];
    let w = ok(u, 0, { type: 'playCharter', kind: 'bridges' });
    expect(w.freeBridges).toBe(1);
    w = ok(w, 0, { type: 'placeBridge', edge: legalBridges(w, 0)[0] });
    expect(w.phase).toBe('main');
  });

  it('buying the winning glory charter wins at once', () => {
    const s = blank();
    for (const v of s.board.vertices.map((x) => x.id)) {
      if (s.buildings.filter((b) => b?.owner === 0).length === 4) break;
      if (s.board.vertices[v].adj.every((a) => !s.buildings[a]) && !s.buildings[v]) settle(s, 0, v, true);
    }
    s.players[0].charters = ['glory'];
    expect(totalGlory(s, 0)).toBe(9);
    s.deck.push('glory');
    give(s, 0, { ...COSTS.charter });
    const t = ok(s, 0, { type: 'buyCharter' });
    expect(t.phase).toBe('over');
    expect(t.winner).toBe(0);
    err(t, 0, { type: 'endTurn' });
  });
});

describe('awards', () => {
  it('longest bridge: 5 to claim, and an opponent outpost in the middle cuts it', () => {
    const s = blank();
    const v = coastVertex(s);
    const e0 = settle(s, 0, v);
    // A straight chain: e0 + 4 edges = 5 bridges.
    const a = path(s, v, 4);
    a.edges.forEach((e) => (s.bridges[e] = 0));
    sync(s);
    expect(s.players[0].longest).toBe(5);
    // Building a 6th bridge through the engine triggers the award.
    const end = a.verts[a.verts.length - 1];
    // Extend without closing a ring back to the start (a ring stays 6 long when cut once).
    const used = new Set([...a.verts, ...s.board.edges[e0].v]);
    const next = s.board.vertices[end].edges.find((e) => s.bridges[e] === null && !s.board.edges[e].v.every((x) => used.has(x)))!;
    give(s, 0, { ...COSTS.bridge });
    let t = ok(s, 0, { type: 'placeBridge', edge: next });
    expect(t.players[0].longest).toBe(6);
    expect(t.longestHolder).toBe(0);
    checkInvariants(t);

    // Player 1 reaches an interior vertex of the chain from inland and builds there.
    const interior = a.verts.slice(1).find((x) =>
      t.board.vertices[x].edges.some((e) => t.bridges[e] === null) && t.board.vertices[x].adj.every((y) => !t.buildings[y]));
    expect(interior).toBeDefined();
    const inland = t.board.vertices[interior!].edges.find((e) => t.bridges[e] === null)!;
    t.bridges[inland] = 1;
    sync(t);
    t.current = 1;
    give(t, 1, { ...COSTS.outpost });
    t = ok(t, 1, { type: 'placeOutpost', vertex: interior! });
    expect(t.players[0].longest).toBeLessThan(6);
    expect(t.players[0].longest).toBe(longestBridge(t, 0));
    if (t.players[0].longest < 5) expect(t.longestHolder).toBeNull();
  });

  it('a ring of bridges cut once stays a full path (rules: a road may end at an opponent)', () => {
    const s = blank();
    const hex = s.board.hexes[0];
    hex.edges.forEach((e) => (s.bridges[e] = 0));
    s.buildings[hex.vertices[0]] = { owner: 0, citadel: false };
    expect(longestBridge(s, 0)).toBe(6);
    s.buildings[hex.vertices[3]] = { owner: 1, citadel: false };
    expect(longestBridge(s, 0)).toBe(6);
  });

  it('largest fleet: 3 knights to claim, a tie does not steal it', () => {
    const s = blank();
    s.players[1].knights = 3;
    s.fleetHolder = 1;
    s.players[0].knights = 2;
    s.players[0].charters = ['knight'];
    let t = ok(s, 0, { type: 'playCharter', kind: 'knight' });
    expect(t.fleetHolder).toBe(1);
    t = ok(t, 0, { type: 'movePirate', hex: t.board.hexes.find((h) => h.id !== t.pirate)!.id, victim: null });
    t = ok(t, 0, { type: 'endTurn' });
    t.current = 0; t.phase = 'main'; t.charterPlayed = false;
    t.players[0].charters = ['knight'];
    t = ok(t, 0, { type: 'playCharter', kind: 'knight' });
    expect(t.fleetHolder).toBe(0);
  });

  it('you only win on your own turn', () => {
    const s = blank();
    for (const v of s.board.vertices.map((x) => x.id)) {
      if (s.buildings.filter((b) => b?.owner === 1).length === 4) break;
      if (s.board.vertices[v].adj.every((a) => !s.buildings[a]) && !s.buildings[v]) settle(s, 1, v, true);
    }
    s.players[1].charters = ['glory', 'glory']; // 10 glory, but it's player 0's turn
    // Still player 0's turn: no winner yet.
    expect(s.winner).toBeNull();
    // As soon as it becomes their turn, player 1 wins.
    const t = ok(s, 0, { type: 'endTurn' });
    expect(t.winner).toBe(1);
  });
});

describe('trading', () => {
  it('validates offers, responses and confirmation', () => {
    const s = blank();
    give(s, 0, { timber: 2 });
    give(s, 1, { crystal: 1 });
    err(s, 0, { type: 'offerTrade', give: res({ timber: 1 }), want: res({ timber: 1 }) });
    err(s, 0, { type: 'offerTrade', give: res({ timber: 3 }), want: res({ crystal: 1 }) });
    err(s, 0, { type: 'offerTrade', give: res({}), want: res({ crystal: 1 }) });
    err(s, 1, { type: 'offerTrade', give: res({ crystal: 1 }), want: res({ timber: 1 }) });
    let t = ok(s, 0, { type: 'offerTrade', give: res({ timber: 2 }), want: res({ crystal: 1 }) });
    err(t, 0, { type: 'respondTrade', accept: true });
    err(t, 2, { type: 'respondTrade', accept: true });
    t = ok(t, 2, { type: 'respondTrade', accept: false });
    err(t, 0, { type: 'confirmTrade', with: 2 });
    t = ok(t, 1, { type: 'respondTrade', accept: true });
    // Player 1 loses the crystal before the proposer confirms.
    const u = structuredClone(t);
    u.players[1].hand.crystal = 0; u.bank.crystal++;
    err(u, 0, { type: 'confirmTrade', with: 1 });
    t = ok(t, 0, { type: 'confirmTrade', with: 1 });
    expect(t.players[0].hand).toEqual(res({ crystal: 1 }));
    expect(t.players[1].hand).toEqual(res({ timber: 2 }));
  });

  it('an open offer is withdrawn when the proposer leaves the main phase', () => {
    const s = blank();
    give(s, 0, { timber: 1 });
    give(s, 1, { crystal: 1 });
    deal(s, 0, ['knight', 'bridges']);
    let t = ok(s, 0, { type: 'offerTrade', give: res({ timber: 1 }), want: res({ crystal: 1 }) });
    t = ok(t, 1, { type: 'respondTrade', accept: true });
    const k = ok(t, 0, { type: 'playCharter', kind: 'knight' });
    expect(k.trade).toBeNull();
    err(k, 0, { type: 'confirmTrade', with: 1 });
    checkInvariants(k);
  });

  it('dock ratios: 2:1 matching dock, 3:1 generic, 4:1 otherwise', () => {
    const s = blank();
    expect(tradeRatio(s, 0, 'timber')).toBe(4);
    const generic = s.board.ports.find((p) => p.kind === 'any')!;
    settle(s, 0, s.board.edges[generic.edge].v[0]);
    expect(tradeRatio(s, 0, 'timber')).toBe(3);
    const special = s.board.ports.find((p) => p.kind !== 'any')!;
    s.buildings[s.board.edges[special.edge].v[1]] = { owner: 0, citadel: false };
    expect(tradeRatio(s, 0, special.kind as keyof ResMap)).toBe(2);
    give(s, 0, { [special.kind]: 2 });
    const t = ok(s, 0, { type: 'bankTrade', give: special.kind as never, get: special.kind === 'clay' ? 'grain' : 'clay' });
    expect(resTotal(t.players[0].hand)).toBe(1);
    err(s, 0, { type: 'bankTrade', give: 'timber', get: 'timber' });
  });
});
