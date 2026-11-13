import { describe, expect, it } from 'vitest';
import { reduce, seededRng } from '../src/game/engine';
import { callFour } from '../src/game/rules';
import {
  activePlayers,
  createMatch,
  isEliminated,
  matchWinner,
  PENALTY_WORD,
  scoreRound,
  startRound,
} from '../src/game/score';
import type { MatchState } from '../src/game/types';
import { round } from './helpers';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isHuman: i === 0 }));

/** Finish the current round with p0 calling and p1 stuck with the Joker. */
function loseRound(match: MatchState, loserIndex = 1): MatchState {
  const hands = ['As Ah Ad Ac', 'Ks Kh Kd Kc', 'Qs Qh Qd Qc'];
  hands[loserIndex] = hands[loserIndex].replace(/ \S+$/, ' JOKER');
  const r = round(hands);
  r.order = match.round!.order.slice(0, 3);
  r.hands = Object.fromEntries(r.order.map((id, i) => [id, r.hands[`p${i}`]]));
  return scoreRound({ ...match, round: callFour(r, r.order[0]) });
}

describe('match scoring', () => {
  it('starts everyone with no letters', () => {
    const match = createMatch(players(4));
    expect(match.players.every((p) => p.letters === 0)).toBe(true);
    expect(match.roundNumber).toBe(0);
    expect(() => createMatch(players(2))).toThrow();
    expect(() => createMatch(players(7))).toThrow();
  });

  it('gives the loser one letter per lost round and nobody else', () => {
    let match = startRound(createMatch(players(3)), seededRng(1));
    match = loseRound(match);
    expect(match.players.map((p) => p.letters)).toEqual([0, 1, 0]);
    match = loseRound(startRound(match, seededRng(2)));
    expect(match.players.map((p) => p.letters)).toEqual([0, 2, 0]);
  });

  it('eliminates a player who spells the whole word, and shrinks the next deal', () => {
    let match = createMatch(players(4));
    for (let i = 0; i < PENALTY_WORD.length; i++) {
      match = loseRound(startRound(match, seededRng(i)));
    }
    expect(isEliminated(match.players[1])).toBe(true);
    expect(activePlayers(match).map((p) => p.id)).toEqual(['p0', 'p2', 'p3']);
    expect(matchWinner(match)).toBeNull();

    match = startRound(match, seededRng(99));
    expect(match.round!.order).toEqual(['p0', 'p2', 'p3']);
    const cards = match.round!.order.flatMap((id) => match.round!.hands[id]);
    expect(cards).toHaveLength(3 * 4 + 1);
  });

  it('declares the last player standing the winner', () => {
    let match = createMatch(players(3));
    match = { ...match, players: match.players.map((p, i) => ({ ...p, letters: i === 0 ? 0 : 5 })) };
    expect(matchWinner(match)?.id).toBe('p0');
    expect(() => startRound(match, seededRng(1))).toThrow(/over/);
  });

  it('will not deal over a round that is still being played', () => {
    const match = startRound(createMatch(players(3)), seededRng(1));
    expect(() => startRound(match, seededRng(2))).toThrow(/in progress/);
  });
});

describe('engine reducer', () => {
  it('plays a round from actions alone and is reproducible from a seed', () => {
    const play = () => {
      const rng = seededRng(42);
      let match = reduce(createMatch(players(4)), { type: 'startRound' }, rng);
      const passes = Object.fromEntries(
        match.round!.order.map((id) => [id, match.round!.hands[id].find((c) => c.kind === 'normal')!.id]),
      );
      match = reduce(match, { type: 'pass', passes }, rng);
      return match;
    };
    const a = play();
    expect(a.round!.turn).toBe(1);
    expect(a.roundNumber).toBe(1);
    expect(a).toEqual(play());
  });

  it('scores the round when a call is made', () => {
    let match = startRound(createMatch(players(3)), seededRng(1));
    match = { ...match, round: round(['As Ah Ad Ac', 'Ks Kh Kd Kc', 'Qs Qh Qd JOKER']) };
    match = reduce(match, { type: 'call', player: 'p1' }, seededRng(1));
    expect(match.round!.result).toEqual({ caller: 'p1', loser: 'p2', rank: 'K' });
    expect(match.players.map((p) => p.letters)).toEqual([0, 0, 1]);
  });

  it('records a card request', () => {
    let match = startRound(createMatch(players(3)), seededRng(1));
    match = reduce(match, { type: 'request', player: 'p1', rank: 'A' }, seededRng(1));
    expect(match.round!.requests).toEqual({ p1: 'A' });
    expect(match.round!.requestsUsed).toEqual(['p1']);
  });

  it('rejects round actions before a round starts', () => {
    const match = createMatch(players(3));
    expect(() => reduce(match, { type: 'pass', passes: {} }, seededRng(1))).toThrow();
    expect(() => reduce(match, { type: 'call', player: 'p0' }, seededRng(1))).toThrow();
  });
});
