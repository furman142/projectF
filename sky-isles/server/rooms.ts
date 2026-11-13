import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { newGame } from '../shared/engine.ts';
import { GameHost } from '../shared/host.ts';
import { MAX_SEATS, type ClientMsg, type LobbyInfo, type ServerMsg } from '../shared/protocol.ts';
import { PLAYER_COLORS, type Options } from '../shared/types.ts';

const BOT_NAMES = ['Captain Gale', 'Admiral Nimbus', 'Skipper Zephyr', 'Navigator Mist'];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const AWAY_AFTER_MS = 15_000;
const LOBBY_DROP_MS = 30_000;
const ROOM_IDLE_MS = 15 * 60_000;

interface Seat {
  name: string;
  color: string;
  bot: boolean;
  token: string;
  ws: WebSocket | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class Room {
  seats: Seat[] = [];
  host = 0;
  options: Options = { target: 10, friendlyPirate: false };
  game: GameHost | null = null;
  emptySince = Date.now();

  constructor(readonly code: string, private onEmpty: (r: Room) => void) {}

  seatOf(ws: WebSocket) {
    return this.seats.findIndex((s) => s.ws === ws);
  }

  send(ws: WebSocket | null, msg: ServerMsg) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  lobby(you: number): LobbyInfo {
    return {
      code: this.code,
      seats: this.seats.map((s) => ({ name: s.name, color: s.color, bot: s.bot, connected: s.bot || !!s.ws })),
      host: this.host,
      you,
      options: this.options,
      started: !!this.game,
    };
  }

  broadcastLobby() {
    this.seats.forEach((s, i) => this.send(s.ws, { t: 'lobby', lobby: this.lobby(i) }));
  }

  broadcastViews() {
    if (!this.game) return;
    this.seats.forEach((s, i) => this.send(s.ws, { t: 'view', view: this.game!.view(i) }));
  }

  addHuman(ws: WebSocket, name: string): number | string {
    if (this.game) return 'That game has already started';
    if (this.seats.length >= MAX_SEATS) return 'The room is full';
    const used = new Set(this.seats.map((s) => s.color));
    this.seats.push({ name, color: PLAYER_COLORS.find((c) => !used.has(c))!, bot: false, token: randomBytes(12).toString('hex'), ws, timer: null });
    return this.seats.length - 1;
  }

  /** Reattaches a returning player by their seat token. */
  reattach(ws: WebSocket, token: string): number {
    const i = this.seats.findIndex((s) => !s.bot && s.token === token);
    if (i < 0) return -1;
    const seat = this.seats[i];
    if (seat.ws && seat.ws !== ws) seat.ws.close();
    seat.ws = ws;
    if (seat.timer) clearTimeout(seat.timer);
    seat.timer = null;
    this.game?.setAway(i, false);
    return i;
  }

  welcome(i: number) {
    const s = this.seats[i];
    this.send(s.ws, { t: 'joined', code: this.code, seat: i, token: s.token });
    this.broadcastLobby();
    if (this.game) this.send(s.ws, { t: 'view', view: this.game.view(i) });
  }

  removeSeat(i: number) {
    const [gone] = this.seats.splice(i, 1);
    if (gone.timer) clearTimeout(gone.timer);
    if (this.host === i || this.host >= this.seats.length) this.host = Math.max(0, this.seats.findIndex((s) => !s.bot));
    else if (this.host > i) this.host--;
    if (!this.seats.some((s) => !s.bot)) this.onEmpty(this);
    else this.broadcastLobby();
  }

  disconnected(ws: WebSocket) {
    const i = this.seatOf(ws);
    if (i < 0) return;
    const seat = this.seats[i];
    seat.ws = null;
    if (!this.seats.some((s) => s.ws)) this.emptySince = Date.now();
    if (this.game) {
      seat.timer = setTimeout(() => { seat.timer = null; if (!seat.ws) this.game?.setAway(this.seats.indexOf(seat), true); }, AWAY_AFTER_MS);
      this.broadcastLobby();
    } else {
      seat.timer = setTimeout(() => { const j = this.seats.indexOf(seat); if (j >= 0 && !seat.ws) this.removeSeat(j); }, LOBBY_DROP_MS);
      this.broadcastLobby();
    }
  }

  handle(ws: WebSocket, msg: ClientMsg) {
    const i = this.seatOf(ws);
    if (i < 0) return;
    const isHost = i === this.host;
    const err = (message: string) => this.send(ws, { t: 'error', message });

    switch (msg.t) {
      case 'addBot': {
        if (!isHost || this.game) return;
        if (this.seats.length >= MAX_SEATS) return err('The room is full');
        const used = new Set(this.seats.map((s) => s.color));
        const names = new Set(this.seats.map((s) => s.name));
        this.seats.push({
          name: BOT_NAMES.find((n) => !names.has(n)) ?? 'Bot', color: PLAYER_COLORS.find((c) => !used.has(c))!,
          bot: true, token: '', ws: null, timer: null,
        });
        this.broadcastLobby();
        return;
      }
      case 'kick': {
        if (!isHost || this.game || msg.seat === i || !this.seats[msg.seat]) return;
        const target = this.seats[msg.seat];
        this.send(target.ws, { t: 'error', message: 'You were removed from the room', fatal: true });
        target.ws?.close();
        this.removeSeat(msg.seat);
        return;
      }
      case 'options': {
        if (!isHost || this.game) return;
        const o = msg.options ?? {};
        if ([8, 10, 12].includes(o.target as number)) this.options.target = o.target!;
        if (typeof o.friendlyPirate === 'boolean') this.options.friendlyPirate = o.friendlyPirate;
        this.broadcastLobby();
        return;
      }
      case 'start': {
        if (!isHost || this.game) return;
        if (this.seats.length < 2) return err('You need at least 2 players');
        const state = newGame({
          seed: randomBytes(4).readInt32LE(),
          players: this.seats.map((s) => ({ name: s.name, color: s.color, bot: s.bot })),
          options: this.options,
        });
        this.game = new GameHost(state, { botDelay: 900, onChange: () => this.broadcastViews() });
        this.seats.forEach((s, j) => !s.bot && !s.ws && this.game!.setAway(j, true));
        this.broadcastLobby();
        this.broadcastViews();
        this.game.start();
        return;
      }
      case 'action': {
        if (!this.game) return;
        const r = this.game.act(i, msg.action);
        this.send(ws, { t: 'result', id: msg.id, error: r.ok ? null : r.error });
        return;
      }
      case 'toLobby': {
        if (!isHost || !this.game || this.game.state.phase !== 'over') return;
        this.game.stop();
        this.game = null;
        // Drop players who left during the game.
        for (let j = this.seats.length - 1; j >= 0; j--) if (!this.seats[j].bot && !this.seats[j].ws) this.removeSeat(j);
        this.broadcastLobby();
        return;
      }
      case 'leave': {
        if (this.game) {
          this.seats[i].ws = null;
          this.game.setAway(i, true);
          this.broadcastLobby();
        } else this.removeSeat(i);
        return;
      }
    }
  }
}

export class Rooms {
  private rooms = new Map<string, Room>();
  private bySocket = new Map<WebSocket, Room>();

  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const r of this.rooms.values()) {
        if (!r.seats.some((s) => s.ws) && now - r.emptySince > ROOM_IDLE_MS) this.drop(r);
      }
    }, 60_000).unref();
  }

  get count() { return this.rooms.size; }

  private drop(r: Room) {
    r.game?.stop();
    this.rooms.delete(r.code);
  }

  private newCode(): string {
    for (;;) {
      const code = Array.from(randomBytes(4), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  handle(ws: WebSocket, msg: ClientMsg) {
    const fatal = (message: string) => ws.send(JSON.stringify({ t: 'error', message, fatal: true } satisfies ServerMsg));
    if (msg.t === 'create' || msg.t === 'join') {
      const name = String(msg.name ?? '').trim().slice(0, 16) || 'Player';
      const prev = this.bySocket.get(ws);
      if (prev) prev.disconnected(ws);
      let room: Room | undefined;
      if (msg.t === 'create') {
        room = new Room(this.newCode(), (r) => this.drop(r));
        this.rooms.set(room.code, room);
      } else {
        room = this.rooms.get(String(msg.code ?? '').toUpperCase());
        if (!room) return fatal('No room with that code');
      }
      let seat = msg.t === 'join' && msg.token ? room.reattach(ws, msg.token) : -1;
      if (seat < 0) {
        const r = room.addHuman(ws, name);
        if (typeof r === 'string') return fatal(r);
        seat = r;
      }
      this.bySocket.set(ws, room);
      room.welcome(seat);
      return;
    }
    this.bySocket.get(ws)?.handle(ws, msg);
  }

  closed(ws: WebSocket) {
    this.bySocket.get(ws)?.disconnected(ws);
    this.bySocket.delete(ws);
  }
}
