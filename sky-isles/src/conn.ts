import type { Action, Options } from '../shared/types.ts';
import type { GameView } from '../shared/view.ts';
import type { ClientMsg, LobbyInfo, ServerMsg } from '../shared/protocol.ts';
import { GameHost } from '../shared/host.ts';
import { newGame } from '../shared/engine.ts';

/** What the game screen talks to: a local host (vs bots) or the online server. */
export interface Conn {
  readonly online: boolean;
  onView: (v: GameView) => void;
  send(a: Action): Promise<string | null>;
  close(): void;
}

export class LocalConn implements Conn {
  readonly online = false;
  onView: (v: GameView) => void = () => {};
  private host: GameHost;

  constructor(players: { name: string; color: string; bot: boolean }[], options: Partial<Options>) {
    const state = newGame({ players, seed: (Math.random() * 2 ** 31) | 0, options });
    this.host = new GameHost(state, { botDelay: 750, onChange: (h) => this.onView(h.view(0)) });
  }
  start() {
    this.onView(this.host.view(0));
    this.host.start();
  }
  send(a: Action) {
    const r = this.host.act(0, a);
    return Promise.resolve(r.ok ? null : r.error);
  }
  close() {
    this.host.stop();
  }
}

export class NetConn implements Conn {
  readonly online = true;
  onView: (v: GameView) => void = () => {};
  onLobby: (l: LobbyInfo) => void = () => {};
  onError: (msg: string, fatal: boolean) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};
  seat = -1;
  code = '';
  lastLobby: LobbyInfo | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, (e: string | null) => void>();
  private closed = false;
  private retry = 0;

  constructor(private first: ClientMsg) {
    this.connect();
  }

  private connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${location.pathname.replace(/[^/]*$/, '')}ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
      const saved = this.code ? loadSeat(this.code) : null;
      if (saved) ws.send(JSON.stringify({ t: 'join', code: this.code, name: saved.name, token: saved.token } satisfies ClientMsg));
      else ws.send(JSON.stringify(this.first));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as ServerMsg;
      switch (msg.t) {
        case 'joined':
          this.seat = msg.seat;
          this.code = msg.code;
          saveSeat(msg.code, { token: msg.token, name: nameOf(this.first) });
          history.replaceState(null, '', `?room=${msg.code}`);
          break;
        case 'lobby': this.onLobby(msg.lobby); break;
        case 'view': this.onView(msg.view); break;
        case 'result': this.pending.get(msg.id)?.(msg.error); this.pending.delete(msg.id); break;
        case 'error':
          if (msg.fatal) { this.closed = true; ws.close(); }
          this.onError(msg.message, !!msg.fatal);
          break;
      }
    };
    ws.onclose = () => {
      this.onStatus(false);
      for (const res of this.pending.values()) res('Connection lost');
      this.pending.clear();
      if (this.closed) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  msg(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  send(action: Action): Promise<string | null> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.resolve('Not connected');
    const id = this.nextId++;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.msg({ t: 'action', id, action });
    });
  }

  close() {
    this.closed = true;
    this.msg({ t: 'leave' });
    this.ws?.close();
    if (this.code) localStorage.removeItem(`sky-seat-${this.code}`);
    history.replaceState(null, '', location.pathname);
  }
}

function nameOf(m: ClientMsg) {
  return m.t === 'create' || m.t === 'join' ? m.name : '';
}
function saveSeat(code: string, v: { token: string; name: string }) {
  try { localStorage.setItem(`sky-seat-${code}`, JSON.stringify(v)); } catch { /* private mode */ }
}
export function loadSeat(code: string): { token: string; name: string } | null {
  try { return JSON.parse(localStorage.getItem(`sky-seat-${code}`) ?? 'null'); } catch { return null; }
}
