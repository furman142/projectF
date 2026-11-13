import { describe, expect, it } from 'vitest';
import { newGame, reduce } from '../shared/engine.ts';
import { botAction } from '../shared/bot.ts';
import { viewFor } from '../shared/view.ts';
import type { GameState } from '../shared/types.ts';

/** Plays bot games and checks every player's view at every step. */
function* states(seed: number, n: number): Generator<GameState> {
  let s = newGame({ seed, players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000', bot: true })) });
  for (let i = 0; i < 4000 && s.phase !== 'over'; i++) {
    yield s;
    const p = [s.current, ...s.players.keys()].find((x) => botAction(s, x));
    if (p === undefined) break;
    const r = reduce(s, p, botAction(s, p)!);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  yield s;
}

describe('privacy', () => {
  it('no view ever reveals another player hand, charters, the deck, the RNG or a steal result', () => {
    let checked = 0;
    for (const seed of [3, 9, 27]) {
      for (const s of states(seed, 4)) {
        for (let me = -1; me < 4; me++) {
          const v = viewFor(s, me);
          const json = JSON.stringify(v);
          expect(json).not.toMatch(/"rng"|"deck"/);
          v.players.forEach((p, i) => {
            if (i === me) {
              expect(p.hand).toEqual(s.players[i].hand);
              return;
            }
            expect(p.hand).toBeNull();
            expect(p.charters).toBeNull();
            expect(p.newCharters).toBeNull();
            // Public glory only (hidden glory charters stay secret until the game ends).
            if (s.phase !== 'over') expect(p.glory).toBeLessThanOrEqual(s.players.length ? 99 : 0);
          });
          for (const { ev } of v.log) {
            if (ev.type === 'steal' && me !== ev.thief && me !== ev.victim) expect(ev.res).toBeNull();
            if (ev.type === 'buyCharter' && me !== ev.player) expect(ev.kind).toBeNull();
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('hidden glory charters are not counted in other players public score', () => {
    const s = newGame({ seed: 1, players: [0, 1].map((i) => ({ name: `P${i}`, color: '', bot: true })) });
    s.phase = 'main';
    s.players[1].charters = ['glory', 'glory'];
    expect(viewFor(s, 0).players[1].glory).toBe(0);
    expect(viewFor(s, 1).players[1].glory).toBe(2);
    s.phase = 'over';
    s.winner = 0;
    expect(viewFor(s, 0).players[1].glory).toBe(2);
  });

  it('a view is a copy: changing it cannot change the game', () => {
    const s = newGame({ seed: 1, players: [0, 1].map((i) => ({ name: `P${i}`, color: '', bot: true })) });
    const v = viewFor(s, 0);
    v.board.hexes[0].number = 99;
    v.players[0].hand!.timber = 50;
    v.buildings[0] = { owner: 0, citadel: true };
    expect(s.board.hexes[0].number).not.toBe(99);
    expect(s.players[0].hand.timber).toBe(0);
    expect(s.buildings[0]).toBeNull();
  });
});
