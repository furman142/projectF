import { applyPasses, callFour } from './rules';
import { scoreRound, startRound } from './score';
import type { MatchState, PlayerId, Rng } from './types';

/**
 * Every way the match can change. A server (or a peer) can replay the same
 * actions through `reduce` to stay in sync, which is the hook for online play.
 */
export type Action =
  | { type: 'startRound' }
  | { type: 'pass'; passes: Record<PlayerId, string> }
  | { type: 'call'; player: PlayerId };

export function reduce(match: MatchState, action: Action, rng: Rng): MatchState {
  switch (action.type) {
    case 'startRound':
      return startRound(match, rng);
    case 'pass':
      if (!match.round) throw new Error('No round in progress');
      return { ...match, round: applyPasses(match.round, action.passes) };
    case 'call':
      if (!match.round) throw new Error('No round in progress');
      return scoreRound({ ...match, round: callFour(match.round, action.player) });
  }
}

/** Small seeded PRNG (mulberry32) for reproducible games and tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
