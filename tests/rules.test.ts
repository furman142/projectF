import { describe, expect, it } from 'vitest';
import {
  applyPasses,
  callFour,
  canCall,
  isJokerLocked,
  jokerHolder,
  leftOf,
  legalPasses,
  playersWhoCanCall,
  rightOf,
} from '../src/game/rules';
import { ids, round } from './helpers';

const start = () => round(['As Ks Qs Js JOKER', 'Ah Kh Qh Jh', 'Ad Kd Qd Jd', 'Ac Kc Qc Jc']);

describe('passing', () => {
  it('moves each chosen card to the player on the left, all at once', () => {
    const next = applyPasses(start(), { p0: 'A-spades', p1: 'K-hearts', p2: 'Q-diamonds', p3: 'J-clubs' });
    expect(ids(next.hands.p1)).toEqual(ids(round(['Ah Qh Jh As']).hands.p0));
    expect(ids(next.hands.p2)).toEqual(ids(round(['Ad Kd Jd Kh']).hands.p0));
    expect(ids(next.hands.p3)).toEqual(ids(round(['Ac Kc Qc Qd']).hands.p0));
    expect(ids(next.hands.p0)).toEqual(ids(round(['Ks Qs Js JOKER Jc']).hands.p0));
    expect(next.turn).toBe(1);
  });

  it('wraps around: the last seat passes to the first', () => {
    const r = start();
    expect(leftOf(r, 'p3')).toBe('p0');
    expect(rightOf(r, 'p0')).toBe('p3');
    expect(leftOf(r, 'p1')).toBe('p2');
  });

  it('keeps hand sizes and the full set of cards', () => {
    const before = start();
    const next = applyPasses(before, { p0: 'joker', p1: 'A-hearts', p2: 'A-diamonds', p3: 'A-clubs' });
    for (const id of before.order) expect(next.hands[id]).toHaveLength(before.hands[id].length);
    const all = (r: typeof before) => ids(r.order.flatMap((id) => r.hands[id]));
    expect(all(next)).toEqual(all(before));
  });

  it('does not mutate the previous state', () => {
    const before = start();
    const snapshot = JSON.stringify(before);
    applyPasses(before, { p0: 'joker', p1: 'A-hearts', p2: 'A-diamonds', p3: 'A-clubs' });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('rejects a missing pass or a card the player does not hold', () => {
    expect(() => applyPasses(start(), { p0: 'joker', p1: 'A-hearts', p2: 'A-diamonds' })).toThrow();
    expect(() =>
      applyPasses(start(), { p0: 'A-hearts', p1: 'A-hearts', p2: 'A-diamonds', p3: 'A-clubs' }),
    ).toThrow(/cannot pass/);
  });

  it('rejects passes once the round is over', () => {
    const over = callFour(round(['As Ah Ad Ac', 'Ks Kh Kd JOKER', 'Kc Qs Qh Qd Qc']), 'p0');
    expect(() => applyPasses(over, { p0: 'A-spades', p1: 'K-spades', p2: 'K-clubs' })).toThrow(/over/);
    expect(legalPasses(over, 'p0')).toEqual([]);
  });
});

describe('Joker hold rule', () => {
  const passJoker = () =>
    applyPasses(start(), { p0: 'joker', p1: 'A-hearts', p2: 'A-diamonds', p3: 'A-clubs' });

  it('the dealt Joker may be passed straight away', () => {
    const r = start();
    expect(isJokerLocked(r, 'p0')).toBe(false);
    expect(legalPasses(r, 'p0').map((card) => card.id)).toContain('joker');
  });

  it('locks the Joker for the player who just received it', () => {
    const r = passJoker();
    expect(jokerHolder(r)).toBe('p1');
    expect(r.jokerLockedFor).toBe('p1');
    expect(isJokerLocked(r, 'p1')).toBe(true);
    expect(legalPasses(r, 'p1').map((card) => card.id)).not.toContain('joker');
    expect(legalPasses(r, 'p1')).toHaveLength(3);
  });

  it('refuses an attempt to pass a locked Joker', () => {
    expect(() =>
      applyPasses(passJoker(), { p0: 'K-spades', p1: 'joker', p2: 'K-diamonds', p3: 'K-clubs' }),
    ).toThrow(/must hold the Joker/);
  });

  it('unlocks after the holder has kept it for one round', () => {
    const held = applyPasses(passJoker(), {
      p0: 'K-spades',
      p1: 'K-hearts',
      p2: 'K-diamonds',
      p3: 'K-clubs',
    });
    expect(jokerHolder(held)).toBe('p1');
    expect(held.jokerLockedFor).toBeNull();
    expect(legalPasses(held, 'p1').map((card) => card.id)).toContain('joker');

    const moved = applyPasses(held, { p0: 'Q-spades', p1: 'joker', p2: 'Q-diamonds', p3: 'Q-clubs' });
    expect(jokerHolder(moved)).toBe('p2');
    expect(moved.jokerLockedFor).toBe('p2');
  });

  it('only locks the Joker holder, nobody else', () => {
    const r = passJoker();
    for (const id of ['p0', 'p2', 'p3']) {
      expect(isJokerLocked(r, id)).toBe(false);
      expect(legalPasses(r, id)).toHaveLength(r.hands[id].length);
    }
  });
});

describe('win detection', () => {
  it('a player with four of a kind can call', () => {
    const r = round(['As Ah Ad Ac', 'Ks Kh Kd JOKER', 'Kc Qs Qh Qd Qc']);
    expect(canCall(r, 'p0')).toBe(true);
    expect(canCall(r, 'p1')).toBe(false);
    expect(canCall(r, 'p2')).toBe(true); // four queens inside a 5-card hand
    expect(playersWhoCanCall(r)).toEqual(['p0', 'p2']);
  });

  it('three of a kind is not enough', () => {
    const r = round(['As Ah Ad Kc', 'Ks Kh Kd JOKER', 'Ac Qs Qh Qd Qc']);
    expect(canCall(r, 'p0')).toBe(false);
  });

  it('a player holding the Joker cannot call, even with four of a kind', () => {
    const r = round(['As Ah Ad Ac JOKER', 'Ks Kh Kd Kc', 'Qs Qh Qd Qc']);
    expect(canCall(r, 'p0')).toBe(false);
    expect(() => callFour(r, 'p0')).toThrow();
  });

  it('detects a four completed by a pass', () => {
    const before = round(['As Ah Ad Kc', 'Ks Kh Kd JOKER', 'Ac Qs Qh Qd Jc']);
    expect(playersWhoCanCall(before)).toEqual([]);
    const after = applyPasses(before, { p0: 'K-clubs', p1: 'K-spades', p2: 'A-clubs' });
    expect(playersWhoCanCall(after)).toEqual(['p0']);
  });

  it('nobody can call after the round has ended', () => {
    const over = callFour(round(['As Ah Ad Ac', 'Ks Kh Kd JOKER', 'Kc Qs Qh Qd Qc']), 'p0');
    expect(playersWhoCanCall(over)).toEqual([]);
    expect(() => callFour(over, 'p2')).toThrow();
  });
});

describe('loser detection', () => {
  it('the player holding the Joker when someone calls loses', () => {
    const r = callFour(round(['As Ah Ad Ac', 'Ks Kh Kd JOKER', 'Kc Qs Qh Qd Qc']), 'p0');
    expect(r.result).toEqual({ caller: 'p0', loser: 'p1', rank: 'A' });
  });

  it('follows the Joker as it moves round the table', () => {
    let r = round(['As Ah Ad Kc JOKER', 'Ks Kh Kd Qs', 'Ac Qh Qd Qc']);
    r = applyPasses(r, { p0: 'joker', p1: 'Q-spades', p2: 'A-clubs' });
    // p0 now has four aces + Kc, p1 holds the (locked) Joker, p2 has four queens.
    expect(jokerHolder(r)).toBe('p1');
    expect(callFour(r, 'p2').result).toEqual({ caller: 'p2', loser: 'p1', rank: 'Q' });
    expect(callFour(r, 'p0').result).toEqual({ caller: 'p0', loser: 'p1', rank: 'A' });
  });

  it('the caller is never the loser', () => {
    const r = callFour(round(['Ks Kh Kd JOKER', 'As Ah Ad Ac', 'Kc Qs Qh Qd Qc']), 'p2');
    expect(r.result!.loser).not.toBe(r.result!.caller);
    expect(r.result!.loser).toBe('p0');
  });
});
