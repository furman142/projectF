import { resTotal, type CharterKind, type GameState, type LogEntry, type Player, type ResMap } from './types.ts';
import { publicGlory, totalGlory } from './engine.ts';

export interface ViewPlayer extends Omit<Player, 'hand' | 'charters' | 'newCharters'> {
  hand: ResMap | null;               // only for yourself
  charters: CharterKind[] | null;
  newCharters: CharterKind[] | null;
  cardCount: number;
  charterCount: number;
  glory: number;                     // public glory (your own includes hidden glory charters)
  connected: boolean;
}

export interface GameView extends Omit<GameState, 'players' | 'deck' | 'rng' | 'log'> {
  me: number; // -1 for spectators
  players: ViewPlayer[];
  deckCount: number;
  log: LogEntry[];
}

/** What player `me` is allowed to see. Hands, charters, the deck order and the RNG are hidden. */
export function viewFor(s: GameState, me: number, connected: boolean[] = []): GameView {
  const { deck, rng: _rng, players, log, ...rest } = s;
  return {
    ...structuredClone(rest),
    me,
    deckCount: deck.length,
    players: players.map((p, i) => ({
      name: p.name, color: p.color, bot: p.bot, knights: p.knights, longest: p.longest,
      hand: i === me ? { ...p.hand } : null,
      charters: i === me ? [...p.charters] : null,
      newCharters: i === me ? [...p.newCharters] : null,
      cardCount: resTotal(p.hand),
      charterCount: p.charters.length + p.newCharters.length,
      glory: i === me || s.phase === 'over' ? totalGlory(s, i) : publicGlory(s, i),
      connected: connected[i] ?? true,
    })),
    log: log.map((e) => {
      const ev = e.ev;
      if (ev.type === 'steal' && me !== ev.thief && me !== ev.victim) return { seq: e.seq, ev: { ...ev, res: null } };
      if (ev.type === 'buyCharter' && me !== ev.player) return { seq: e.seq, ev: { ...ev, kind: null } };
      return e;
    }),
  };
}
