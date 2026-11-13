import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameHost } from '../shared/host.ts';
import { newGame } from '../shared/engine.ts';
import * as bot from '../shared/bot.ts';

const make = (bots: boolean[]) => newGame({ seed: 77, players: bots.map((b, i) => ({ name: `P${i}`, color: '', bot: b })) });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('GameHost', () => {
  it('an all-bot game plays itself to the end on timers', async () => {
    vi.useFakeTimers();
    let changes = 0;
    const host = new GameHost(make([true, true, true]), { botDelay: 10, onChange: () => changes++ });
    host.start();
    for (let i = 0; i < 20000 && host.state.phase !== 'over'; i++) await vi.advanceTimersByTimeAsync(10);
    expect(host.state.phase).toBe('over');
    expect(changes).toBeGreaterThan(50);
  });

  it('waits for humans, and a human who goes away is played by a bot until they return', async () => {
    vi.useFakeTimers();
    const host = new GameHost(make([false, true]), { botDelay: 10 });
    host.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(host.state.phase).toBe('setup');
    expect(host.state.current).toBe(0); // waiting on the human
    host.setAway(0, true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.state.phase).not.toBe('setup');
    host.setAway(0, false);
    // Let the bot finish whatever turn it is on; it must then stop acting for seat 0.
    for (let i = 0; i < 2000 && host.state.current !== 0; i++) await vi.advanceTimersByTimeAsync(10);
    const before = JSON.stringify(host.state);
    await vi.advanceTimersByTimeAsync(1000);
    if (host.state.current === 0 && host.state.phase === 'roll') expect(JSON.stringify(host.state)).toBe(before);
  });

  it('stop() halts bots', async () => {
    vi.useFakeTimers();
    const host = new GameHost(make([true, true]), { botDelay: 10 });
    host.start();
    await vi.advanceTimersByTimeAsync(100);
    host.stop();
    const seq = host.state.seq;
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.state.seq).toBe(seq);
  });

  it('BUG CHECK: a rejected bot move outside the main phase must not freeze the game', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = bot.botAction;
    let sabotaged = 0;
    const spy = vi.spyOn(bot, 'botAction').mockImplementation((s, p) => {
      // Break the bot's first two roll-phase moves.
      if (s.phase === 'roll' && sabotaged < 2) { sabotaged++; return { type: 'endTurn' }; }
      return real(s, p);
    });
    const host = new GameHost(make([true, true]), { botDelay: 10 });
    host.start();
    for (let i = 0; i < 20000 && host.state.phase !== 'over'; i++) await vi.advanceTimersByTimeAsync(10);
    expect(sabotaged).toBe(2);
    expect(host.state.phase).toBe('over');
    spy.mockRestore();
  });
});
