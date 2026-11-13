import type { Card, NormalCard, PlayerId, Rank, Rng, RoundState, Suit } from './types';

export const RANKS: readonly Rank[] = ['A', 'K', 'Q', 'J', '10', '9'];
export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
export const MIN_PLAYERS = 2; // a match can shrink to 2 after eliminations
export const MAX_PLAYERS = RANKS.length;
export const JOKER: Card = { id: 'joker', kind: 'joker' };

/** One four-of-a-kind set per player, plus a single Joker. */
export function buildDeck(playerCount: number): Card[] {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`playerCount must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
  }
  const cards: Card[] = [];
  for (const rank of RANKS.slice(0, playerCount)) {
    for (const suit of SUITS) {
      cards.push({ id: `${rank}-${suit}`, kind: 'normal', rank, suit } satisfies NormalCard);
    }
  }
  cards.push(JOKER);
  return cards;
}

/** Fisher–Yates. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function countRanks(hand: readonly Card[]): Map<Rank, number> {
  const counts = new Map<Rank, number>();
  for (const card of hand) {
    if (card.kind === 'normal') counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return counts;
}

/** The rank this hand holds all four of, if any. */
export function fourOfAKindRank(hand: readonly Card[]): Rank | null {
  for (const [rank, n] of countRanks(hand)) if (n >= 4) return rank;
  return null;
}

/**
 * Deals a fresh round: 4 cards each, and one random player gets the Joker as
 * a 5th card. Re-deals if anyone starts with four of a kind, so a round can
 * never be over before the first pass.
 */
export function dealRound(order: readonly PlayerId[], rng: Rng): RoundState {
  const normals = buildDeck(order.length).filter((c) => c.kind === 'normal');
  for (;;) {
    const deck = shuffle(normals, rng);
    const hands: Record<PlayerId, Card[]> = {};
    order.forEach((id, i) => {
      hands[id] = deck.slice(i * 4, i * 4 + 4);
    });
    if (order.some((id) => fourOfAKindRank(hands[id]))) continue;
    const jokerSeat = Math.floor(rng() * order.length);
    hands[order[jokerSeat]].push(JOKER);
    return { order: order.slice(), hands, jokerLockedFor: null, requests: {}, requestsUsed: [], turn: 0, result: null };
  }
}
