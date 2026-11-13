import { describe, expect, it } from 'vitest';
import { chooseBotPass, createBotMemory, observePass, type BotMemory } from '../src/game/bot';
import { dealRound } from '../src/game/deck';
import { seededRng } from '../src/game/engine';
import { applyPasses, callFour, legalPasses, playersWhoCanCall, rightOf } from '../src/game/rules';
import type { Difficulty, RoundState } from '../src/game/types';
import { c, round } from './helpers';

const rng = () => seededRng(5);

describe('bot passing', () => {
  it.each(['easy', 'hard'] as const)('%s: passes the Joker as soon as it is allowed', (level) => {
    const r = round(['As Ah Kd Qc JOKER', 'Ks Kh Qd Jc', 'Ad Ac Qs Js']);
    for (let seed = 0; seed < 50; seed++) {
      expect(chooseBotPass(r, 'p0', level, createBotMemory(), seededRng(seed)).id).toBe('joker');
    }
  });

  it.each(['easy', 'hard'] as const)('%s: never passes a locked Joker', (level) => {
    const r = round(['As Ah Kd JOKER', 'Ks Kh Qd Jc Qc', 'Ad Ac Qs Js'], { jokerLockedFor: 'p0' });
    for (let seed = 0; seed < 50; seed++) {
      expect(chooseBotPass(r, 'p0', level, createBotMemory(), seededRng(seed)).kind).toBe('normal');
    }
  });

  it('hard: keeps the rank it has most of and passes the odd card out', () => {
    const r = round(['As Ah Ad Qc', 'Ks Kh Qd Jc JOKER', 'Kd Ac Qs Js']);
    for (let seed = 0; seed < 50; seed++) {
      expect(chooseBotPass(r, 'p0', 'hard', createBotMemory(), seededRng(seed))).toEqual(c('Qc'));
    }
  });

  it('hard: passes the card that helps least (a singleton before a pair)', () => {
    const r = round(['As Ah Ad Ks Kh', 'Qs Qh Qd Jc JOKER', 'Kd Ac Kc Js'], { jokerLockedFor: 'p1' });
    const r2 = { ...r, hands: { ...r.hands, p0: [c('As'), c('Ah'), c('Ks'), c('Kh'), c('Qc')] } };
    for (let seed = 0; seed < 50; seed++) {
      expect(chooseBotPass(r2, 'p0', 'hard', createBotMemory(), seededRng(seed))).toEqual(c('Qc'));
    }
  });

  it('hard: never breaks up a four of a kind it is waiting to call', () => {
    const r = round(['As Ah Ad Ac Ks', 'Qs Qh Qd Jc', 'Kd Kh Kc JOKER']);
    expect(chooseBotPass(r, 'p0', 'hard', createBotMemory(), rng())).toEqual(c('Ks'));
  });

  it('easy: makes random mistakes some of the time, hard never does', () => {
    const r = round(['As Ah Ad Qc', 'Ks Kh Qd Jc JOKER', 'Kd Ac Qs Js']);
    let easyMistakes = 0;
    for (let seed = 0; seed < 400; seed++) {
      if (chooseBotPass(r, 'p0', 'easy', createBotMemory(), seededRng(seed)).id !== 'Q-clubs') easyMistakes++;
    }
    // 30% random picks, 3 of 4 of which land on an ace → roughly 22%.
    expect(easyMistakes).toBeGreaterThan(40);
    expect(easyMistakes).toBeLessThan(160);
  });

  it('hard: uses what it has seen to break a tie between two pairs', () => {
    const r = round(['As Ah Ks Kh', 'Qs Qh Qd Jc JOKER', 'Kd Ac Kc Js'], { turn: 6 });
    // Two aces it passed on never came back: someone downstream collects aces.
    const memory: BotMemory = {
      ...createBotMemory(),
      outstanding: { 'A-diamonds': { rank: 'A', turn: 0 }, 'A-clubs': { rank: 'A', turn: 1 } },
      received: { K: 2 },
    };
    for (let seed = 0; seed < 50; seed++) {
      expect(chooseBotPass(r, 'p0', 'hard', memory, seededRng(seed)).kind).toBe('normal');
      const pass = chooseBotPass(r, 'p0', 'hard', memory, seededRng(seed));
      expect(pass.kind === 'normal' && pass.rank).toBe('A');
    }
  });
});

describe('bot memory', () => {
  it('tracks cards passed on, cards that came back, and what arrived', () => {
    let m = createBotMemory();
    m = observePass(m, { turn: 0, passed: c('Qc'), received: c('Kd'), handAfter: [c('As'), c('Ah'), c('Kd')] });
    expect(m.outstanding).toEqual({ 'Q-clubs': { rank: 'Q', turn: 0 } });
    expect(m.received).toEqual({ K: 1 });
    expect(m.best).toBe(2);
    expect(m.stuck).toBe(0);

    m = observePass(m, { turn: 1, passed: c('Kd'), received: c('Qc'), handAfter: [c('As'), c('Ah'), c('Qc')] });
    expect(Object.keys(m.outstanding)).toEqual(['K-diamonds']);
    expect(m.stuck).toBe(1);
  });
});

/** Play a whole round with bots in every seat. Returns the number of passes. */
function simulate(playerCount: number, level: Difficulty, seed: number): { turns: number; round: RoundState } {
  const random = seededRng(seed);
  const order = Array.from({ length: playerCount }, (_, i) => `p${i}`);
  let r = dealRound(order, random);
  let memory = Object.fromEntries(order.map((id) => [id, createBotMemory()]));
  for (let turns = 0; turns < 2000; turns++) {
    const callers = playersWhoCanCall(r);
    if (callers.length) return { turns, round: callFour(r, callers[0]) };
    const picks = Object.fromEntries(order.map((id) => [id, chooseBotPass(r, id, level, memory[id], random)]));
    for (const id of order) expect(legalPasses(r, id)).toContainEqual(picks[id]);
    const next = applyPasses(r, Object.fromEntries(order.map((id) => [id, picks[id].id])));
    memory = Object.fromEntries(
      order.map((id) => [
        id,
        observePass(memory[id], {
          turn: r.turn,
          passed: picks[id],
          received: picks[rightOf(r, id)],
          handAfter: next.hands[id],
        }),
      ]),
    );
    r = next;
  }
  throw new Error(`round did not finish (players=${playerCount}, level=${level}, seed=${seed})`);
}

describe('bot-only rounds', () => {
  it.each([
    [3, 'easy'],
    [4, 'easy'],
    [6, 'easy'],
    [2, 'hard'],
    [3, 'hard'],
    [4, 'hard'],
    [5, 'hard'],
    [6, 'hard'],
  ] as const)('%i %s bots always finish a round with legal moves only', (n, level) => {
    let total = 0;
    for (let seed = 0; seed < 300; seed++) {
      const { turns, round: r } = simulate(n, level, seed);
      expect(r.result).not.toBeNull();
      expect(r.result!.loser).not.toBe(r.result!.caller);
      total += turns;
    }
    expect(total / 300).toBeLessThan(60);
  });

  it('hard bots finish rounds faster than easy bots on average', () => {
    const average = (level: Difficulty) => {
      let total = 0;
      for (let seed = 0; seed < 400; seed++) total += simulate(4, level, seed).turns;
      return total / 400;
    };
    expect(average('hard')).toBeLessThan(average('easy'));
  });
});
