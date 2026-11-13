import { fourOfAKindRank } from './deck';
import type { Card, PlayerId, RoundState } from './types';

export function hasJoker(hand: readonly Card[]): boolean {
  return hand.some((c) => c.kind === 'joker');
}

export function jokerHolder(round: RoundState): PlayerId {
  const holder = round.order.find((id) => hasJoker(round.hands[id]));
  if (!holder) throw new Error('Joker is missing from the round');
  return holder;
}

/** The player each seat passes to: the next one in seat order (their left). */
export function leftOf(round: RoundState, id: PlayerId): PlayerId {
  const i = round.order.indexOf(id);
  if (i < 0) throw new Error(`Unknown player ${id}`);
  return round.order[(i + 1) % round.order.length];
}

export function rightOf(round: RoundState, id: PlayerId): PlayerId {
  const i = round.order.indexOf(id);
  if (i < 0) throw new Error(`Unknown player ${id}`);
  return round.order[(i - 1 + round.order.length) % round.order.length];
}

/** True while this player holds a Joker they received on the previous pass. */
export function isJokerLocked(round: RoundState, id: PlayerId): boolean {
  return round.jokerLockedFor === id && hasJoker(round.hands[id]);
}

/** Cards this player may pass right now (everything except a locked Joker). */
export function legalPasses(round: RoundState, id: PlayerId): Card[] {
  if (round.result) return [];
  const locked = isJokerLocked(round, id);
  return round.hands[id].filter((c) => !(locked && c.kind === 'joker'));
}

/**
 * Everyone passes one card to their left at the same time.
 * Throws if a pass is missing or illegal; the input state is not mutated.
 */
export function applyPasses(round: RoundState, passes: Record<PlayerId, string>): RoundState {
  if (round.result) throw new Error('Round is already over');
  const outgoing = new Map<PlayerId, Card>();
  for (const id of round.order) {
    const cardId = passes[id];
    const card = legalPasses(round, id).find((c) => c.id === cardId);
    if (!card) {
      const held = round.hands[id].some((c) => c.id === cardId);
      throw new Error(
        held ? `${id} must hold the Joker for one round` : `${id} cannot pass ${cardId ?? '(nothing)'}`,
      );
    }
    outgoing.set(id, card);
  }

  const hands: Record<PlayerId, Card[]> = {};
  for (const id of round.order) {
    hands[id] = round.hands[id].filter((c) => c.id !== outgoing.get(id)!.id);
  }
  let jokerLockedFor: PlayerId | null = null;
  for (const id of round.order) {
    const card = outgoing.get(id)!;
    const to = leftOf(round, id);
    hands[to].push(card);
    if (card.kind === 'joker') jokerLockedFor = to;
  }
  return { ...round, hands, jokerLockedFor, turn: round.turn + 1 };
}

/**
 * A player may call when they hold four of a kind and are not holding the
 * Joker (calling with the Joker in hand would make them their own loser).
 */
export function canCall(round: RoundState, id: PlayerId): boolean {
  if (round.result) return false;
  const hand = round.hands[id];
  return fourOfAKindRank(hand) !== null && !hasJoker(hand);
}

export function playersWhoCanCall(round: RoundState): PlayerId[] {
  return round.order.filter((id) => canCall(round, id));
}

/** Ends the round: whoever holds the Joker at this moment loses. */
export function callFour(round: RoundState, caller: PlayerId): RoundState {
  if (!canCall(round, caller)) throw new Error(`${caller} cannot call four of a kind`);
  return {
    ...round,
    result: { caller, loser: jokerHolder(round), rank: fourOfAKindRank(round.hands[caller])! },
  };
}
