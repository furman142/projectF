// Pure data types for the Joker game. Nothing here touches the DOM, so the
// same state can be serialised and sent over the wire for online play.

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9';

export interface NormalCard {
  id: string;
  kind: 'normal';
  rank: Rank;
  suit: Suit;
}

export interface JokerCard {
  id: 'joker';
  kind: 'joker';
}

export type Card = NormalCard | JokerCard;
export type PlayerId = string;
export type Difficulty = 'easy' | 'hard';

/** Returns a float in [0, 1). Injected everywhere so games are reproducible. */
export type Rng = () => number;

export interface RoundResult {
  caller: PlayerId;
  loser: PlayerId;
  rank: Rank;
}

export interface RoundState {
  /** Seat order. Each player passes to the next one in this list (their left). */
  order: PlayerId[];
  hands: Record<PlayerId, Card[]>;
  /** The player who just received the Joker and may not pass it this turn. */
  jokerLockedFor: PlayerId | null;
  /**
   * Card requests made this turn: requester → the rank they asked the player
   * on their right for. Cleared after every pass.
   */
  requests: Record<PlayerId, Rank>;
  /** Players who have already spent their one request for this round. */
  requestsUsed: PlayerId[];
  /** Number of completed passes in this round. */
  turn: number;
  result: RoundResult | null;
}

export interface MatchPlayer {
  id: PlayerId;
  name: string;
  isHuman: boolean;
  /** How many letters of the penalty word this player has collected. */
  letters: number;
}

export interface MatchState {
  players: MatchPlayer[];
  round: RoundState | null;
  roundNumber: number;
}
