import { describe, expect, it } from 'vitest';
import { buildDeck, dealRound, fourOfAKindRank, shuffle } from '../src/game/deck';
import { seededRng } from '../src/game/engine';
import { hand } from './helpers';

describe('buildDeck', () => {
  it.each([3, 4, 5, 6])('has one four-of-a-kind set per player plus one Joker (%i players)', (n) => {
    const deck = buildDeck(n);
    expect(deck).toHaveLength(n * 4 + 1);
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
    expect(deck.filter((c) => c.kind === 'joker')).toHaveLength(1);
    const ranks = new Set(deck.flatMap((c) => (c.kind === 'normal' ? [c.rank] : [])));
    expect(ranks.size).toBe(n);
  });

  it('uses A, K, Q, J for four players', () => {
    const ranks = new Set(buildDeck(4).flatMap((c) => (c.kind === 'normal' ? [c.rank] : [])));
    expect([...ranks]).toEqual(['A', 'K', 'Q', 'J']);
  });

  it('rejects unsupported player counts', () => {
    expect(() => buildDeck(1)).toThrow();
    expect(() => buildDeck(7)).toThrow();
  });
});

describe('shuffle', () => {
  it('keeps every card and does not mutate the input', () => {
    const deck = buildDeck(4);
    const copy = deck.slice();
    const shuffled = shuffle(deck, seededRng(1));
    expect(deck).toEqual(copy);
    expect(shuffled.map((c) => c.id).sort()).toEqual(deck.map((c) => c.id).sort());
    expect(shuffled).not.toEqual(deck);
  });

  it('is deterministic for a given seed', () => {
    expect(shuffle(buildDeck(4), seededRng(7))).toEqual(shuffle(buildDeck(4), seededRng(7)));
  });
});

describe('dealRound', () => {
  it.each([3, 4, 5, 6])('gives everyone 4 cards and one player the Joker as a 5th (%i players)', (n) => {
    const order = Array.from({ length: n }, (_, i) => `p${i}`);
    for (let seed = 0; seed < 200; seed++) {
      const round = dealRound(order, seededRng(seed));
      const sizes = order.map((id) => round.hands[id].length).sort();
      expect(sizes).toEqual([...Array(n - 1).fill(4), 5]);
      const withJoker = order.filter((id) => round.hands[id].some((c) => c.kind === 'joker'));
      expect(withJoker).toHaveLength(1);
      expect(round.hands[withJoker[0]]).toHaveLength(5);
      const all = order.flatMap((id) => round.hands[id].map((c) => c.id));
      expect(new Set(all).size).toBe(n * 4 + 1);
    }
  });

  it('never deals a ready-made four of a kind', () => {
    const order = ['a', 'b', 'c'];
    for (let seed = 0; seed < 2000; seed++) {
      const round = dealRound(order, seededRng(seed));
      for (const id of order) expect(fourOfAKindRank(round.hands[id])).toBeNull();
    }
  });

  it('gives the Joker to different players across deals', () => {
    const order = ['a', 'b', 'c', 'd'];
    const holders = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const round = dealRound(order, seededRng(seed));
      holders.add(order.find((id) => round.hands[id].length === 5)!);
    }
    expect(holders.size).toBe(4);
  });

  it('starts unlocked, at turn 0, with no result', () => {
    const round = dealRound(['a', 'b', 'c', 'd'], seededRng(3));
    expect(round).toMatchObject({ jokerLockedFor: null, turn: 0, result: null });
  });
});

describe('fourOfAKindRank', () => {
  it('detects four of a kind in 4- and 5-card hands', () => {
    expect(fourOfAKindRank(hand('As Ah Ad Ac'))).toBe('A');
    expect(fourOfAKindRank(hand('Ks Qh Kh Kd Kc'))).toBe('K');
    expect(fourOfAKindRank(hand('Qs Qh Qd Qc JOKER'))).toBe('Q');
  });

  it('returns null otherwise', () => {
    expect(fourOfAKindRank(hand('As Ah Ad Kc'))).toBeNull();
    expect(fourOfAKindRank(hand('As Ah Ad JOKER'))).toBeNull();
  });
});
