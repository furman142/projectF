import { describe, expect, it } from 'vitest';
import { act, finishedSetup, game, playUntil } from './helpers.ts';
import { reduce, legalOutposts, longestBridge, tradeRatio, totalGlory } from '../shared/engine.ts';
import { COSTS, emptyRes, resTotal, type GameState } from '../shared/types.ts';
import { viewFor } from '../shared/view.ts';

const give = (s: GameState, p: number, cards: Partial<Record<string, number>>) => {
  for (const [k, v] of Object.entries(cards)) (s.players[p].hand as Record<string, number>)[k] += v!;
};

describe('setup', () => {
  it('runs in snake order and pays out the second outpost', () => {
    let s = game(3);
    expect(s.setupOrder).toEqual([0, 1, 2, 2, 1, 0]);
    s = playUntil(s, finishedSetup);
    expect(s.phase).toBe('roll');
    expect(s.current).toBe(0);
    s.players.forEach((p, i) => {
      expect(s.buildings.filter((b) => b?.owner === i).length).toBe(2);
      expect(s.bridges.filter((o) => o === i).length).toBe(2);
      expect(resTotal(p.hand)).toBeGreaterThan(0);
      expect(resTotal(p.hand)).toBeLessThanOrEqual(3);
    });
  });

  it('enforces the distance rule and bridge-touches-outpost', () => {
    let s = game(2);
    const v = 10;
    s = act(s, 0, { type: 'placeOutpost', vertex: v });
    expect(reduce(s, 0, { type: 'placeOutpost', vertex: 11 }).ok).toBe(false);
    const far = s.board.edges.find((e) => !e.v.includes(v))!;
    expect(reduce(s, 0, { type: 'placeBridge', edge: far.id }).ok).toBe(false);
    const near = s.board.vertices[v].edges[0];
    s = act(s, 0, { type: 'placeBridge', edge: near });
    expect(s.current).toBe(1);
    for (const a of s.board.vertices[v].adj) expect(legalOutposts(s, 1)).not.toContain(a);
    expect(reduce(s, 0, { type: 'placeOutpost', vertex: 40 }).ok).toBe(false); // not their turn
  });
});

describe('turns', () => {
  it('produces resources on a roll and refuses actions out of phase', () => {
    let s = playUntil(game(4, 3), finishedSetup);
    expect(reduce(s, 0, { type: 'endTurn' }).ok).toBe(false);
    expect(reduce(s, 1, { type: 'roll' }).ok).toBe(false);
    s = act(s, 0, { type: 'roll' });
    expect(s.dice).not.toBeNull();
    expect(['main', 'discard', 'pirate']).toContain(s.phase);
  });

  it('a 7 forces discards and moves the pirate with a steal', () => {
    let s = playUntil(game(4, 5), finishedSetup);
    // Force a 7 by searching RNG states.
    for (let seed = 0; ; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      give(t, 1, { timber: 5, clay: 5 });
      const r = reduce(t, 0, { type: 'roll' });
      if (r.ok && r.state.dice![0] + r.state.dice![1] === 7) { s = r.state; break; }
    }
    expect(s.phase).toBe('discard');
    expect(s.discards[1]).toBe(Math.floor(resTotal(s.players[1].hand) / 2));
    expect(reduce(s, 0, { type: 'movePirate', hex: 0, victim: null }).ok).toBe(false);
    s = playUntil(s, (x) => x.phase !== 'discard');
    expect(s.phase).toBe('pirate');
    expect(reduce(s, 0, { type: 'movePirate', hex: s.pirate, victim: null }).ok).toBe(false);
    const before = resTotal(s.players[0].hand);
    s = playUntil(s, (x) => x.phase !== 'pirate');
    expect(s.phase).toBe('main');
    const stole = s.log.some((e) => e.ev.type === 'steal');
    expect(resTotal(s.players[0].hand)).toBe(before + (stole ? 1 : 0));
  });

  it('builds with costs and checks resources', () => {
    let s = playUntil(game(2, 9), (x) => x.phase === 'main');
    while (s.current !== 0 || s.phase !== 'main') s = playUntil(s, (x) => x.current === 0 && x.phase === 'main');
    s.players[0].hand = emptyRes();
    const outpost = s.buildings.findIndex((b) => b?.owner === 0);
    expect(reduce(s, 0, { type: 'upgrade', vertex: outpost }).ok).toBe(false);
    s.players[0].hand = { ...COSTS.citadel };
    s = act(s, 0, { type: 'upgrade', vertex: outpost });
    expect(s.buildings[outpost]!.citadel).toBe(true);
    expect(resTotal(s.players[0].hand)).toBe(0);
  });

  it('bank trade uses the 4:1 default', () => {
    let s = playUntil(game(2, 11), (x) => x.phase === 'main' && x.current === 0);
    s.players[0].hand = { ...emptyRes(), timber: 4 };
    const ratio = tradeRatio(s, 0, 'timber');
    s.players[0].hand.timber = ratio;
    s = act(s, 0, { type: 'bankTrade', give: 'timber', get: 'crystal' });
    expect(s.players[0].hand).toEqual({ ...emptyRes(), crystal: 1 });
  });

  it('player trades need acceptance and swap cards', () => {
    let s = playUntil(game(3, 12), (x) => x.phase === 'main' && x.current === 0);
    s.players[0].hand = { ...emptyRes(), timber: 2 };
    s.players[1].hand = { ...emptyRes(), crystal: 1 };
    s = act(s, 0, { type: 'offerTrade', give: { ...emptyRes(), timber: 2 }, want: { ...emptyRes(), crystal: 1 } });
    expect(reduce(s, 0, { type: 'confirmTrade', with: 1 }).ok).toBe(false);
    expect(reduce(s, 2, { type: 'respondTrade', accept: true }).ok).toBe(false); // has no crystal
    s = act(s, 1, { type: 'respondTrade', accept: true });
    s = act(s, 0, { type: 'confirmTrade', with: 1 });
    expect(s.players[0].hand.crystal).toBe(1);
    expect(s.players[1].hand.timber).toBe(2);
    expect(s.trade).toBeNull();
  });

  it('charters cannot be played on the turn they are bought', () => {
    let s = playUntil(game(2, 13), (x) => x.phase === 'main' && x.current === 0);
    s.deck.push('knight');
    s.players[0].hand = { ...COSTS.charter };
    s = act(s, 0, { type: 'buyCharter' });
    expect(s.players[0].newCharters).toEqual(['knight']);
    expect(reduce(s, 0, { type: 'playCharter', kind: 'knight' }).ok).toBe(false);
    s = act(s, 0, { type: 'endTurn' });
    expect(s.players[0].charters).toEqual(['knight']);
  });
});

describe('longest bridge', () => {
  it('counts the longest chain and opponents break it', () => {
    let s = game(2);
    // Hand-build a path of bridges for player 0 along the outer ring.
    const path: number[] = [];
    let v = s.board.vertices.find((x) => x.hexes.length === 1)!.id;
    const usedV = new Set([v]);
    for (let i = 0; i < 6; i++) {
      const e = s.board.vertices[v].edges.find((e) => {
        const o = s.board.edges[e].v.find((x) => x !== v)!;
        return !usedV.has(o) && s.board.edges[e].hexes.length === 1;
      })!;
      path.push(e);
      v = s.board.edges[e].v.find((x) => x !== v)!;
      usedV.add(v);
    }
    path.forEach((e) => (s.bridges[e] = 0));
    expect(longestBridge(s, 0)).toBe(6);
    const mid = [...usedV][3];
    s.buildings[mid] = { owner: 1, citadel: false };
    expect(longestBridge(s, 0)).toBe(3);
  });
});

describe('views', () => {
  it('hide other hands, the deck and other players steal results', () => {
    const s = playUntil(game(3, 4), finishedSetup);
    const v = viewFor(s, 1);
    expect(v.players[1].hand).toEqual(s.players[1].hand);
    expect(v.players[0].hand).toBeNull();
    expect(v.players[0].cardCount).toBe(resTotal(s.players[0].hand));
    expect('deck' in v).toBe(false);
    expect('rng' in v).toBe(false);
  });
});

describe('full games', () => {
  it('bots always finish a game with a valid winner', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const n = 2 + (seed % 3);
      const s = playUntil(game(n, seed * 7919), () => false);
      expect(s.phase).toBe('over');
      expect(s.winner).not.toBeNull();
      expect(totalGlory(s, s.winner!)).toBeGreaterThanOrEqual(10);
      // Resources are conserved: 19 of each in bank + hands.
      for (const r of ['timber', 'clay', 'fiber', 'grain', 'crystal'] as const) {
        expect(s.bank[r] + s.players.reduce((t, p) => t + p.hand[r], 0)).toBe(19);
      }
    }
  });
});
