import type { Action, GameState } from './types.ts';
import { reduce } from './engine.ts';
import { botAction } from './bot.ts';
import { viewFor, type GameView } from './view.ts';

export interface HostOptions {
  botDelay?: number;                       // ms between bot moves
  onChange?: (host: GameHost) => void;     // called after every successful action
}

/**
 * Owns the authoritative game state, applies actions and drives bots.
 * Runs in the browser for offline games and on the server for online games.
 */
export class GameHost {
  state: GameState;
  /** Seats played by the computer right now: bots, plus humans who are away. */
  auto = new Set<number>();
  connected: boolean[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(state: GameState, private opts: HostOptions = {}) {
    this.state = state;
    state.players.forEach((p, i) => p.bot && this.auto.add(i));
    this.connected = state.players.map((p) => !p.bot);
  }

  act(player: number, action: Action): { ok: true } | { ok: false; error: string } {
    const r = reduce(this.state, player, action);
    if (!r.ok) return r;
    this.state = r.state;
    this.opts.onChange?.(this);
    this.schedule();
    return { ok: true };
  }

  view(player: number): GameView {
    return viewFor(this.state, player, this.connected);
  }

  setAway(player: number, away: boolean) {
    if (this.state.players[player].bot) return;
    this.connected[player] = !away;
    if (away) this.auto.add(player);
    else this.auto.delete(player);
    this.opts.onChange?.(this);
    this.schedule();
  }

  start() {
    this.schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Finds the next bot that has something to do and runs it after a short delay. */
  schedule() {
    if (this.timer || this.stopped) return;
    const next = this.nextBotMove();
    if (!next) return;
    const s = this.state;
    const quick = s.phase === 'discard' || (s.trade && s.trade.from !== next.player);
    this.timer = setTimeout(() => {
      this.timer = null;
      const move = this.nextBotMove();
      if (!move) return;
      const r = this.act(move.player, move.action);
      if (!r.ok) {
        // A bot should never pick an illegal move; fall back to ending its turn so the game can't stall.
        console.warn('bot move rejected', move, r.error);
        if (this.state.current === move.player && this.state.phase === 'main') this.act(move.player, { type: 'endTurn' });
      }
    }, quick ? (this.opts.botDelay ?? 600) / 2 : this.opts.botDelay ?? 600);
  }

  nextBotMove(): { player: number; action: Action } | null {
    const s = this.state;
    if (s.phase === 'over') return null;
    const order = [s.current, ...s.players.keys()];
    for (const p of order) {
      if (!this.auto.has(p)) continue;
      const action = botAction(s, p);
      if (action) return { player: p, action };
    }
    return null;
  }
}
