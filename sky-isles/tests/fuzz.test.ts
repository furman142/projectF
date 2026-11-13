import { describe, expect, it } from 'vitest';
import { legalBridges, legalOutposts, legalUpgrades, newGame, reduce } from '../shared/engine.ts';
import { botAction } from '../shared/bot.ts';
import { RESOURCES, emptyRes, type Action, type GameState } from '../shared/types.ts';
import { checkInvariants } from './invariants.ts';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const GARBAGE: unknown[] = [null, undefined, -1, 1.5, NaN, Infinity, 1e9, '3', '', {}, [], true, -0];

/** Random actions: a mix of plausible moves, edge cases and junk. */
function randomAction(s: GameState, p: number, r: () => number): Action {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const junk = () => (r() < 0.5 ? pick(GARBAGE) : Math.floor(r() * 80) - 5);
  const res = () => pick([...RESOURCES]);
  const map = () => {
    const m = emptyRes();
    for (const k of RESOURCES) if (r() < 0.3) m[k] = Math.floor(r() * 4);
    return r() < 0.1 ? (junk() as never) : m;
  };
  const types: (() => unknown)[] = [
    () => ({ type: 'placeOutpost', vertex: r() < 0.6 ? pick(legalOutposts(s, p).concat([0])) : junk() }),
    () => ({ type: 'placeBridge', edge: r() < 0.6 ? pick(legalBridges(s, p).concat([0])) : junk() }),
    () => ({ type: 'upgrade', vertex: r() < 0.6 ? pick(legalUpgrades(s, p).concat([0])) : junk() }),
    () => ({ type: 'roll' }),
    () => ({ type: 'discard', cards: map() }),
    () => ({ type: 'movePirate', hex: r() < 0.7 ? Math.floor(r() * 19) : junk(), victim: r() < 0.7 ? Math.floor(r() * s.players.length) : junk() }),
    () => ({ type: 'buyCharter' }),
    () => ({ type: 'playCharter', kind: pick(['knight', 'bridges', 'plenty', 'monopoly', 'glory', 'nope', junk()]), res: r() < 0.8 ? [res(), res()].slice(0, 1 + Math.floor(r() * 2)) : junk() }),
    () => ({ type: 'bankTrade', give: r() < 0.9 ? res() : junk(), get: r() < 0.9 ? res() : junk() }),
    () => ({ type: 'offerTrade', give: map(), want: map() }),
    () => ({ type: 'respondTrade', accept: r() < 0.6 }),
    () => ({ type: 'confirmTrade', with: r() < 0.8 ? Math.floor(r() * s.players.length) : junk() }),
    () => ({ type: 'cancelTrade' }),
    () => ({ type: 'endTurn' }),
    () => junk(),
    () => ({ type: junk() }),
  ];
  return pick(types)() as Action;
}

function fuzzGame(seed: number, steps: number, opts: { target?: number; friendlyPirate?: boolean; players?: number } = {}) {
  const r = rng(seed);
  const n = opts.players ?? 2 + Math.floor(r() * 3);
  let s = newGame({
    seed,
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000', bot: true })),
    options: { target: opts.target ?? 10, friendlyPirate: opts.friendlyPirate ?? r() < 0.5 },
  });
  let applied = 0, rejected = 0;
  const history: [number, Action][] = [];
  for (let i = 0; i < steps && s.phase !== 'over'; i++) {
    let p: number, a: Action | null = null;
    if (r() < 0.55) {
      // Progress the game with a sensible move from whoever needs to act.
      const order = [s.current, ...s.players.keys()];
      p = order.find((x) => botAction(s, x)) ?? s.current;
      a = botAction(s, p);
    } else {
      p = r() < 0.9 ? Math.floor(r() * n) : Math.floor(r() * 10) - 3;
    }
    a ??= randomAction(s, p, r);
    const before = JSON.stringify(s);
    let res;
    try {
      res = reduce(s, p, a);
    } catch (e) {
      throw new Error(`reduce threw on ${JSON.stringify(a)} by ${p} in ${s.phase}: ${(e as Error).message}`);
    }
    if (JSON.stringify(s) !== before) throw new Error(`reduce mutated its input on ${JSON.stringify(a)}`);
    if (res.ok) {
      try { checkInvariants(res.state); } catch (e) {
        throw new Error(`${(e as Error).message}\n after ${JSON.stringify(a)} by player ${p}`);
      }
      s = res.state;
      history.push([p, a]);
      applied++;
    } else {
      expect(typeof res.error).toBe('string');
      rejected++;
    }
  }
  return { s, applied, rejected, history, seed, n };
}

describe('fuzz', () => {
  it('random and malformed actions never crash or break invariants', () => {
    let finished = 0, applied = 0, rejected = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const g = fuzzGame(seed * 104729, 6000);
      applied += g.applied;
      rejected += g.rejected;
      if (g.s.phase === 'over') finished++;
    }
    console.log(`fuzz: ${applied} applied, ${rejected} rejected, ${finished}/150 games finished`);
    expect(finished).toBeGreaterThan(100);
  });

  it('is deterministic: replaying the same actions gives the same state', () => {
    for (const seed of [11, 22, 33]) {
      const g = fuzzGame(seed, 3000);
      let s = newGame({ seed, players: Array.from({ length: g.n }, (_, i) => ({ name: `P${i}`, color: '#000', bot: true })), options: g.s.options });
      for (const [p, a] of g.history) {
        const r = reduce(s, p, a);
        if (!r.ok) throw new Error(`replay failed: ${r.error}`);
        s = r.state;
      }
      expect(s).toEqual(g.s);
    }
  });

  it('handles every target and the friendly pirate option', () => {
    for (const target of [8, 12]) for (const friendlyPirate of [true, false]) fuzzGame(target * 7 + Number(friendlyPirate), 8000, { target, friendlyPirate, players: 4 });
  });
});
