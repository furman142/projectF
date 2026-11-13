import { countRanks } from './deck';
import { legalPasses } from './rules';
import type { Card, Difficulty, NormalCard, PlayerId, Rank, Rng, RoundState } from './types';

/** How often an Easy bot throws away a random card instead of thinking. */
export const EASY_MISTAKE_RATE = 0.3;

/**
 * What a bot remembers within a round. Bots only ever learn from cards that
 * passed through their own hand, exactly like a human at the table.
 */
export interface BotMemory {
  /** Cards this bot passed on that have not come back, and when they left. */
  outstanding: Record<string, { rank: Rank; turn: number }>;
  /** How many cards of each rank arrived from the player on the right. */
  received: Partial<Record<Rank, number>>;
  /** Best same-rank count seen so far, and how many turns it has not improved. */
  best: number;
  stuck: number;
}

export function createBotMemory(): BotMemory {
  return { outstanding: {}, received: {}, best: 0, stuck: 0 };
}

function bestCount(hand: readonly Card[]): number {
  return Math.max(0, ...countRanks(hand).values());
}

/** Update a bot's memory after a pass. Returns a new object. */
export function observePass(
  memory: BotMemory,
  event: { turn: number; passed: Card; received: Card; handAfter: readonly Card[] },
): BotMemory {
  const outstanding = { ...memory.outstanding };
  const received = { ...memory.received };
  if (event.passed.kind === 'normal') {
    outstanding[event.passed.id] = { rank: event.passed.rank, turn: event.turn };
  }
  delete outstanding[event.received.id];
  if (event.received.kind === 'normal') {
    received[event.received.rank] = (received[event.received.rank] ?? 0) + 1;
  }
  const best = bestCount(event.handAfter);
  const improved = best > memory.best;
  return { outstanding, received, best: Math.max(best, memory.best), stuck: improved ? 0 : memory.stuck + 1 };
}

/**
 * Cards of each rank that this bot sent round the table and never saw again:
 * a sign that someone downstream is collecting that rank.
 */
function hoardedDownstream(memory: BotMemory, turn: number, playerCount: number): Map<Rank, number> {
  const hoarded = new Map<Rank, number>();
  for (const { rank, turn: sentAt } of Object.values(memory.outstanding)) {
    if (turn - sentAt >= playerCount) hoarded.set(rank, (hoarded.get(rank) ?? 0) + 1);
  }
  return hoarded;
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

/** Lowest score wins; ties are broken at random so bots are not predictable. */
function pickLowest<T>(items: readonly T[], score: (item: T) => number, rng: Rng): T {
  let best: T[] = [];
  let bestScore = Infinity;
  for (const item of items) {
    const s = score(item);
    if (s < bestScore) {
      best = [item];
      bestScore = s;
    } else if (s === bestScore) {
      best.push(item);
    }
  }
  return pick(best, rng);
}

/**
 * Choose the card a bot passes this turn.
 *  - The Joker goes as soon as the hold rule allows.
 *  - Otherwise keep the rank held most and pass the least useful card.
 *  - Easy: sometimes passes a random card instead.
 *  - Hard: uses its memory to chase ranks that are still flowing and to avoid
 *    feeding a rank that somebody downstream is hoarding.
 */
export function chooseBotPass(
  round: RoundState,
  id: PlayerId,
  difficulty: Difficulty,
  memory: BotMemory,
  rng: Rng,
): Card {
  const legal = legalPasses(round, id);
  if (legal.length === 0) throw new Error(`${id} has nothing to pass`);
  const joker = legal.find((c) => c.kind === 'joker');
  if (joker) return joker;

  const normals = legal as NormalCard[];
  if (difficulty === 'easy' && rng() < EASY_MISTAKE_RATE) return pick(normals, rng);

  const counts = countRanks(round.hands[id]);
  const top = Math.max(...counts.values());
  const playerCount = round.order.length;

  // Two bots can each sit on a pair of the same rank forever. If nothing has
  // improved for a few laps of the table, give up on a weak hand and reshuffle.
  if (top <= 2 && memory.stuck >= playerCount * 3) return pick(normals, rng);

  const hoarded = difficulty === 'hard' ? hoardedDownstream(memory, round.turn, playerCount) : new Map();
  const incoming = (rank: Rank) => (difficulty === 'hard' ? (memory.received[rank] ?? 0) : 0);

  // Which rank to collect: the most held; Hard breaks ties toward ranks that
  // keep arriving and away from ranks that disappear downstream.
  const candidates = [...counts.keys()].filter((r) => counts.get(r) === top);
  const target = pickLowest(candidates, (r) => (hoarded.get(r) ?? 0) * 2 - incoming(r), rng);

  const spare = normals.filter((c) => c.rank !== target);
  if (spare.length === 0) return pick(normals, rng);

  // Pass the card that helps least: fewest of its rank in hand. Hard also
  // prefers to let go of a rank nobody downstream seems to want.
  return pickLowest(
    spare,
    (c) => (counts.get(c.rank) ?? 0) * 10 + (hoarded.get(c.rank) ?? 0) * 2 - incoming(c.rank) * 0.5,
    rng,
  );
}
