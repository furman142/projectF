import { dealRound, MAX_PLAYERS } from './deck';
import type { MatchPlayer, MatchState, Rng } from './types';

/** Losing a round earns the next letter; spelling the whole word eliminates you. */
export const PENALTY_WORD = 'JOKER';

export interface PlayerConfig {
  id: string;
  name: string;
  isHuman: boolean;
}

export function createMatch(players: readonly PlayerConfig[]): MatchState {
  if (players.length < 3 || players.length > MAX_PLAYERS) {
    throw new Error(`A match needs 3 to ${MAX_PLAYERS} players`);
  }
  return {
    players: players.map((p) => ({ ...p, letters: 0 })),
    round: null,
    roundNumber: 0,
  };
}

export function isEliminated(player: MatchPlayer): boolean {
  return player.letters >= PENALTY_WORD.length;
}

export function activePlayers(match: MatchState): MatchPlayer[] {
  return match.players.filter((p) => !isEliminated(p));
}

/** The last player standing, once everyone else has been eliminated. */
export function matchWinner(match: MatchState): MatchPlayer | null {
  const alive = activePlayers(match);
  return alive.length === 1 ? alive[0] : null;
}

/** Deals a new round to the players still in the match (the deck shrinks with them). */
export function startRound(match: MatchState, rng: Rng): MatchState {
  if (matchWinner(match)) throw new Error('Match is already over');
  if (match.round && !match.round.result) throw new Error('Current round is still in progress');
  const order = activePlayers(match).map((p) => p.id);
  return { ...match, round: dealRound(order, rng), roundNumber: match.roundNumber + 1 };
}

/** Gives the round's loser their next letter. Call once per finished round. */
export function scoreRound(match: MatchState): MatchState {
  const result = match.round?.result;
  if (!result) throw new Error('Round has no result yet');
  return {
    ...match,
    players: match.players.map((p) =>
      p.id === result.loser ? { ...p, letters: Math.min(p.letters + 1, PENALTY_WORD.length) } : p,
    ),
  };
}
