import type { Card, NormalCard, Rank, RoundState, Suit } from '../src/game/types';

export const JOKER: Card = { id: 'joker', kind: 'joker' };

const SUIT_BY_LETTER: Record<string, Suit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };

/** c('As') → ace of spades, c('10h') → ten of hearts, c('JOKER') → the Joker. */
export function c(code: string): Card {
  if (code === 'JOKER') return JOKER;
  const suit = SUIT_BY_LETTER[code.slice(-1)];
  const rank = code.slice(0, -1) as Rank;
  return { id: `${rank}-${suit}`, kind: 'normal', rank, suit } satisfies NormalCard;
}

export function hand(codes: string): Card[] {
  return codes.split(' ').map(c);
}

/** Build a round from "hand strings" in seat order: p0 passes to p1, and so on. */
export function round(hands: string[], extra: Partial<RoundState> = {}): RoundState {
  const order = hands.map((_, i) => `p${i}`);
  return {
    order,
    hands: Object.fromEntries(order.map((id, i) => [id, hand(hands[i])])),
    jokerLockedFor: null,
    requests: {},
    requestsUsed: [],
    turn: 0,
    result: null,
    ...extra,
  };
}

export const ids = (cards: readonly Card[]) => cards.map((card) => card.id).sort();
