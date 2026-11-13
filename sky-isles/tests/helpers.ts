import { newGame, reduce } from '../shared/engine.ts';
import type { Action, GameState } from '../shared/types.ts';
import { botAction } from '../shared/bot.ts';

export function game(n = 4, seed = 1): GameState {
  return newGame({
    seed,
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000', bot: true })),
  });
}

export function act(s: GameState, p: number, a: Action): GameState {
  const r = reduce(s, p, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

/** Plays bot moves until `until` is true (or the game ends). */
export function playUntil(s: GameState, until: (s: GameState) => boolean, max = 20000): GameState {
  for (let i = 0; i < max && !until(s) && s.phase !== 'over'; i++) {
    let moved = false;
    for (const p of [s.current, ...s.players.keys()]) {
      const a = botAction(s, p);
      if (!a) continue;
      s = act(s, p, a);
      moved = true;
      break;
    }
    if (!moved) throw new Error(`stalled in phase ${s.phase}`);
  }
  return s;
}

export const finishedSetup = (s: GameState) => s.phase !== 'setup';
