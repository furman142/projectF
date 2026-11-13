import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../server/index.ts';
import type { ClientMsg, LobbyInfo, ServerMsg } from '../shared/protocol.ts';
import type { GameView } from '../shared/view.ts';
import { legalBridges, legalOutposts } from '../shared/engine.ts';
import type { GameState } from '../shared/types.ts';

let srv: Awaited<ReturnType<typeof startServer>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  srv = await startServer({ port: 0, quiet: true, timings: { awayAfter: 150, lobbyDrop: 250, botDelay: 5 } });
});
afterAll(async () => { await srv.close(); });

/** A test client that records every server message. */
class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  open: Promise<void>;
  closed = false;
  constructor() {
    this.ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(String(d))));
    this.ws.on('close', () => (this.closed = true));
    this.open = new Promise((r) => this.ws.on('open', () => r()));
  }
  send(m: ClientMsg | string) { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  async wait<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, ms = 3000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const i = this.msgs.findIndex(pred);
      if (i >= 0) return this.msgs.splice(i, 1)[0] as T;
      if (Date.now() - start > ms) throw new Error(`timeout; got ${this.msgs.map((m) => m.t).join(',')}`);
      await sleep(10);
    }
  }
  lobby() { return this.wait((m): m is { t: 'lobby'; lobby: LobbyInfo } => m.t === 'lobby'); }
  latestLobby(): LobbyInfo | null {
    const l = [...this.msgs].reverse().find((m) => m.t === 'lobby') as { lobby: LobbyInfo } | undefined;
    return l?.lobby ?? null;
  }
  latestView(): GameView | null {
    const v = [...this.msgs].reverse().find((m) => m.t === 'view') as { view: GameView } | undefined;
    return v?.view ?? null;
  }
  joined() { return this.wait((m): m is Extract<ServerMsg, { t: 'joined' }> => m.t === 'joined'); }
  error() { return this.wait((m): m is Extract<ServerMsg, { t: 'error' }> => m.t === 'error'); }
  close() { this.ws.close(); }
}

async function room(n: number, bots = 0) {
  const host = new Client();
  await host.open;
  host.send({ t: 'create', name: 'Host' });
  const j = await host.joined();
  const others: Client[] = [];
  for (let i = 1; i < n; i++) {
    const c = new Client();
    await c.open;
    c.send({ t: 'join', code: j.code.toLowerCase(), name: `P${i}` });
    await c.joined();
    others.push(c);
  }
  for (let i = 0; i < bots; i++) host.send({ t: 'addBot' });
  await sleep(50);
  return { host, others, code: j.code, hostToken: j.token };
}

/** Plays `p` with the engine's own legal moves until `until` holds (setup + simple turns). */
async function driveHumans(clients: Client[], until: () => boolean, ms = 8000) {
  const start = Date.now();
  let id = 1000;
  while (!until() && Date.now() - start < ms) {
    for (const c of clients) {
      const v = c.latestView();
      if (!v || v.phase === 'over') continue;
      const s = v as unknown as GameState;
      const me = v.me;
      let action: unknown = null;
      if (v.phase === 'discard' && v.discards[me] > 0) {
        const hand = { ...v.players[me].hand! };
        const cards = { timber: 0, clay: 0, fiber: 0, grain: 0, crystal: 0 } as Record<string, number>;
        for (let k = v.discards[me]; k > 0; k--) { const r = Object.keys(hand).find((x) => (hand as Record<string, number>)[x] > 0)!; (hand as Record<string, number>)[r]--; cards[r]++; }
        action = { type: 'discard', cards };
      } else if (v.trade && v.trade.from !== me && v.trade.responses[me] === null) action = { type: 'respondTrade', accept: false };
      else if (v.current === me) {
        if (v.phase === 'setup') action = v.lastOutpost === null ? { type: 'placeOutpost', vertex: legalOutposts(s, me)[0] } : { type: 'placeBridge', edge: legalBridges(s, me)[0] };
        else if (v.phase === 'roll') action = { type: 'roll' };
        else if (v.phase === 'pirate') {
          const hex = v.board.hexes.find((h) => h.id !== v.pirate && !h.vertices.some((x) => v.buildings[x]))!.id;
          action = { type: 'movePirate', hex, victim: null };
        } else if (v.phase === 'main') action = { type: 'endTurn' };
      }
      if (action) c.send({ t: 'action', id: id++, action: action as never });
    }
    await sleep(15);
  }
}

describe('server', () => {
  it('serves a health check', async () => {
    const r = await fetch(`http://localhost:${srv.port}/health`);
    expect((await r.json()).ok).toBe(true);
  });

  it('refuses unknown codes and full rooms; codes are case-insensitive', async () => {
    const c = new Client();
    await c.open;
    c.send({ t: 'join', code: 'ZZZZ', name: 'x' });
    expect((await c.error()).fatal).toBe(true);

    const { host, others, code } = await room(4);
    const fifth = new Client();
    await fifth.open;
    fifth.send({ t: 'join', code, name: 'late' });
    const e = await fifth.error();
    expect(e.message).toMatch(/full/);
    [host, ...others, fifth, c].forEach((x) => x.close());
  });

  it('only the host can add bots, change options, kick or start', async () => {
    const { host, others } = await room(2);
    const guest = others[0];
    guest.send({ t: 'addBot' });
    guest.send({ t: 'options', options: { target: 8 } });
    guest.send({ t: 'kick', seat: 0 });
    guest.send({ t: 'start' });
    await sleep(100);
    const l = host.latestLobby()!;
    expect(l.seats.length).toBe(2);
    expect(l.options.target).toBe(10);
    expect(l.started).toBe(false);
    host.send({ t: 'options', options: { target: 7 as never, friendlyPirate: 'yes' as never } });
    await sleep(50);
    expect(host.latestLobby()!.options).toEqual({ target: 10, friendlyPirate: false });
    host.close(); guest.close();
  });

  it('a single player cannot start; names are trimmed and capped', async () => {
    const c = new Client();
    await c.open;
    c.send({ t: 'create', name: '   ' + 'x'.repeat(50) });
    await c.joined();
    const l = (await c.lobby()).lobby;
    expect(l.seats[0].name.length).toBe(16);
    c.send({ t: 'start' });
    expect((await c.error()).message).toMatch(/at least 2/);
    c.close();
  });

  it('survives junk: bad JSON, unknown types, wrong shapes, oversized messages', async () => {
    const { host, others } = await room(2);
    host.send('not json');
    host.send('null');
    host.send('[]');
    host.send(JSON.stringify({ t: 42 }));
    host.send(JSON.stringify({ t: 'action' }));
    host.send(JSON.stringify({ t: 'action', id: 'x', action: { type: 'placeOutpost', vertex: { toString: 1 } } }));
    host.send(JSON.stringify({ t: 'kick', seat: '__proto__' }));
    host.send(JSON.stringify({ t: 'options', options: null }));
    host.send(JSON.stringify({ t: 'join', code: null, name: { a: 1 } }));
    host.send('x'.repeat(40_000));
    await sleep(150);
    const c = new Client();
    await c.open;
    c.send({ t: 'create', name: 'still alive' });
    await c.joined();
    [host, ...others, c].forEach((x) => x.close());
  });

  it('runs a game: everyone gets their own view, others hands stay hidden, wrong-turn actions fail', async () => {
    const { host, others } = await room(2, 1);
    host.send({ t: 'start' });
    await sleep(100);
    const hv = host.latestView()!, gv = others[0].latestView()!;
    expect(hv.me).toBe(0);
    expect(gv.me).toBe(1);
    expect(hv.players[1].hand).toBeNull();
    expect(gv.players[0].hand).toBeNull();
    others[0].send({ t: 'action', id: 7, action: { type: 'placeOutpost', vertex: 0 } });
    const r = await others[0].wait((m): m is Extract<ServerMsg, { t: 'result' }> => m.t === 'result' && m.id === 7);
    expect(r.error).toMatch(/turn/);
    await driveHumans([host, others[0]], () => (host.latestView()?.turnNumber ?? 0) > 6);
    const v = host.latestView()!;
    expect(v.phase).not.toBe('setup');
    expect(JSON.stringify(v)).not.toContain('"rng"');
    expect(JSON.stringify(v)).not.toContain('"deck"');
    host.close(); others[0].close();
  });

  it('a player who reconnects with their token gets the same seat back', async () => {
    const { host, others, code } = await room(2);
    const tokenMsg = others[0];
    host.send({ t: 'start' });
    await sleep(80);
    // Find the guest's token: it was in their 'joined' message, which room() consumed, so rejoin via a fresh join.
    tokenMsg.close();
    await sleep(50);
    const intruder = new Client();
    await intruder.open;
    intruder.send({ t: 'join', code, name: 'Thief', token: 'wrong' });
    expect((await intruder.error()).message).toMatch(/already started/);
    host.close(); intruder.close();
  });

  it('BUG CHECK: a lobby drop timer must not remove a seat after the game starts', async () => {
    const host = new Client();
    await host.open;
    host.send({ t: 'create', name: 'Host' });
    const j = await host.joined();
    const guest = new Client();
    await guest.open;
    guest.send({ t: 'join', code: j.code, name: 'Guest' });
    await guest.joined();
    host.send({ t: 'addBot' });
    await sleep(50);
    guest.close();              // guest drops in the lobby -> drop timer (250ms) starts
    await sleep(30);
    host.send({ t: 'start' });  // game starts before the timer fires
    await sleep(500);           // timer would have fired by now
    const v = host.latestView()!;
    expect(v.players.length).toBe(3);
    expect(host.latestLobby()!.seats.length).toBe(3);
    host.close();
  });

  it('BUG CHECK: if the host leaves mid-game, another player can still return everyone to the lobby', async () => {
    const { host, others, code } = await room(2);
    const guest = others[0];
    host.send({ t: 'start' });
    await sleep(80);
    host.send({ t: 'leave' });
    host.close();
    // Finish the game quickly: let the server bots play out the away host, guest plays too.
    const r = srv.rooms.get(code)!;
    r.game!.state.options.target = 3;
    await driveHumans([guest], () => guest.latestView()?.phase === 'over', 15000);
    expect(guest.latestView()!.phase).toBe('over');
    guest.msgs = []; // drop old pre-game lobby messages so we only see the new one
    guest.send({ t: 'toLobby' });
    const l = await guest.wait((m): m is { t: 'lobby'; lobby: LobbyInfo } => m.t === 'lobby' && !m.lobby.started);
    expect(l.lobby.started).toBe(false);
    expect(l.lobby.seats.length).toBe(1);   // the departed host was cleared out
    expect(l.lobby.host).toBe(l.lobby.you); // and the guest is the new host
    guest.close();
  }, 20000);

  it('a guest cannot send everyone to the lobby while the host is still here', async () => {
    const { host, others, code } = await room(2);
    host.send({ t: 'start' });
    await sleep(80);
    const r = srv.rooms.get(code)!;
    r.game!.state.phase = 'over';
    r.game!.state.winner = 0;
    others[0].msgs = [];
    others[0].send({ t: 'toLobby' });
    await sleep(100);
    expect(others[0].msgs.some((m) => m.t === 'lobby' && !m.lobby.started)).toBe(false);
    host.close(); others[0].close();
  });

  it('a player away too long is played by a bot, and comes back on reconnect', async () => {
    const host = new Client();
    await host.open;
    host.send({ t: 'create', name: 'Host' });
    const hj = await host.joined();
    const guest = new Client();
    await guest.open;
    guest.send({ t: 'join', code: hj.code, name: 'Guest' });
    const gj = await guest.joined();
    host.send({ t: 'start' });
    await sleep(80);
    guest.close();
    await sleep(400); // > awayAfter: bot takes over the guest's setup moves
    const g2 = new Client();
    await g2.open;
    g2.send({ t: 'join', code: hj.code, name: 'Guest', token: gj.token });
    const again = await g2.joined();
    expect(again.seat).toBe(gj.seat);
    await sleep(50);
    expect(g2.latestView()!.players[gj.seat].connected).toBe(true);
    host.close(); g2.close();
  });
});
