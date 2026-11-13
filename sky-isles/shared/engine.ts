import {
  COSTS, LIMITS, RESOURCES, emptyRes, resTotal,
  type Action, type CharterKind, type GameEvent, type GameState, type Options, type Player, type ResMap, type Resource,
} from './types.ts';
import { generateBoard } from './board.ts';
import { rand, randInt, shuffle } from './rng.ts';

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

export interface NewGameInput {
  players: { name: string; color: string; bot: boolean }[];
  seed: number;
  options?: Partial<Options>;
}

export function newGame(input: NewGameInput): GameState {
  const rng = { rng: input.seed | 0 };
  const board = generateBoard(rng);
  const n = input.players.length;
  const deck: CharterKind[] = shuffle(rng, [
    ...Array<CharterKind>(14).fill('knight'),
    ...Array<CharterKind>(5).fill('glory'),
    ...Array<CharterKind>(2).fill('bridges'),
    ...Array<CharterKind>(2).fill('plenty'),
    ...Array<CharterKind>(2).fill('monopoly'),
  ]);
  const order = [...Array(n).keys()];
  const s: GameState = {
    board,
    players: input.players.map((p) => ({
      ...p, hand: emptyRes(), charters: [], newCharters: [], knights: 0, longest: 0,
    })),
    buildings: board.vertices.map(() => null),
    bridges: board.edges.map(() => null),
    pirate: board.hexes.find((h) => h.terrain === 'storm')!.id,
    bank: { timber: 19, clay: 19, fiber: 19, grain: 19, crystal: 19 },
    deck,
    current: 0,
    phase: 'setup',
    setupOrder: [...order, ...order.reverse()],
    setupStep: 0,
    lastOutpost: null,
    discards: Array(n).fill(0),
    dice: null,
    charterPlayed: false,
    freeBridges: 0,
    returnPhase: 'main',
    trade: null,
    longestHolder: null,
    fleetHolder: null,
    winner: null,
    turnNumber: 0,
    rolls: Array(13).fill(0),
    rng: rng.rng,
    seq: 0,
    log: [],
    options: { target: 10, friendlyPirate: false, ...input.options },
  };
  s.current = s.setupOrder[0];
  return s;
}

// ---------- queries ----------

export function countPieces(s: GameState, p: number) {
  let outposts = 0, citadels = 0, bridges = 0;
  for (const b of s.buildings) if (b && b.owner === p) b.citadel ? citadels++ : outposts++;
  for (const o of s.bridges) if (o === p) bridges++;
  return { outposts, citadels, bridges };
}

export function publicGlory(s: GameState, p: number): number {
  const c = countPieces(s, p);
  return c.outposts + 2 * c.citadels + (s.longestHolder === p ? 2 : 0) + (s.fleetHolder === p ? 2 : 0);
}

export function totalGlory(s: GameState, p: number): number {
  const pl = s.players[p];
  const hidden = [...pl.charters, ...pl.newCharters].filter((k) => k === 'glory').length;
  return publicGlory(s, p) + hidden;
}

export function canAfford(hand: ResMap, cost: ResMap): boolean {
  return RESOURCES.every((r) => hand[r] >= cost[r]);
}

function distanceOk(s: GameState, v: number): boolean {
  return !s.buildings[v] && s.board.vertices[v].adj.every((a) => !s.buildings[a]);
}

export function outpostOk(s: GameState, p: number, v: number): boolean {
  if (v < 0 || v >= s.buildings.length || !distanceOk(s, v)) return false;
  if (s.phase === 'setup') return true;
  return s.board.vertices[v].edges.some((e) => s.bridges[e] === p);
}

export function bridgeOk(s: GameState, p: number, e: number): boolean {
  if (e < 0 || e >= s.bridges.length || s.bridges[e] !== null) return false;
  const edge = s.board.edges[e];
  if (s.phase === 'setup') return s.lastOutpost !== null && edge.v.includes(s.lastOutpost);
  return edge.v.some((v) => {
    const b = s.buildings[v];
    if (b) return b.owner === p;
    return s.board.vertices[v].edges.some((o) => o !== e && s.bridges[o] === p);
  });
}

export function legalOutposts(s: GameState, p: number): number[] {
  return s.board.vertices.filter((v) => outpostOk(s, p, v.id)).map((v) => v.id);
}
export function legalBridges(s: GameState, p: number): number[] {
  return s.board.edges.filter((e) => bridgeOk(s, p, e.id)).map((e) => e.id);
}
export function legalUpgrades(s: GameState, p: number): number[] {
  return s.buildings.flatMap((b, v) => (b && b.owner === p && !b.citadel ? [v] : []));
}

/** Best trade ratio for a resource: 2 with a matching dock, 3 with a generic dock, else 4. */
export function tradeRatio(s: GameState, p: number, res: Resource): number {
  let ratio = 4;
  for (const port of s.board.ports) {
    const owned = s.board.edges[port.edge].v.some((v) => s.buildings[v]?.owner === p);
    if (!owned) continue;
    if (port.kind === res) return 2;
    if (port.kind === 'any') ratio = 3;
  }
  return ratio;
}

export function pirateVictims(s: GameState, p: number, hex: number): number[] {
  const out = new Set<number>();
  for (const v of s.board.hexes[hex].vertices) {
    const b = s.buildings[v];
    if (!b || b.owner === p || resTotal(s.players[b.owner].hand) === 0) continue;
    if (s.options.friendlyPirate && publicGlory(s, b.owner) <= 2) continue;
    out.add(b.owner);
  }
  return [...out];
}

/** Longest single chain of a player's bridges; an opponent's building breaks the chain. */
export function longestBridge(s: GameState, p: number): number {
  const used = new Set<number>();
  let best = 0;
  const dfs = (v: number, len: number) => {
    if (len > best) best = len;
    const b = s.buildings[v];
    if (len > 0 && b && b.owner !== p) return;
    for (const e of s.board.vertices[v].edges) {
      if (s.bridges[e] !== p || used.has(e)) continue;
      used.add(e);
      const [a, c] = s.board.edges[e].v;
      dfs(a === v ? c : a, len + 1);
      used.delete(e);
    }
  };
  const starts = new Set<number>();
  s.bridges.forEach((o, e) => { if (o === p) s.board.edges[e].v.forEach((v) => starts.add(v)); });
  for (const v of starts) dfs(v, 0);
  return best;
}

// ---------- mutation helpers ----------

function emit(s: GameState, ev: GameEvent) {
  s.log.push({ seq: ++s.seq, ev });
  if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}

function pay(s: GameState, p: number, cost: ResMap) {
  for (const r of RESOURCES) {
    s.players[p].hand[r] -= cost[r];
    s.bank[r] += cost[r];
  }
}

function updateLongest(s: GameState) {
  s.players.forEach((pl, i) => (pl.longest = longestBridge(s, i)));
  const lens = s.players.map((pl) => pl.longest);
  const max = Math.max(...lens);
  const prev = s.longestHolder;
  let holder: number | null;
  if (prev !== null && lens[prev] >= 5 && lens[prev] === max) holder = prev;
  else {
    const top = lens.flatMap((l, i) => (l === max ? [i] : []));
    holder = max >= 5 && top.length === 1 ? top[0] : null;
  }
  if (holder !== prev) {
    s.longestHolder = holder;
    emit(s, { type: 'award', kind: 'longest', player: holder });
  }
}

function updateFleet(s: GameState, p: number) {
  const k = s.players[p].knights;
  const h = s.fleetHolder;
  if (k >= 3 && h !== p && (h === null || k > s.players[h].knights)) {
    s.fleetHolder = p;
    emit(s, { type: 'award', kind: 'fleet', player: p });
  }
}

function produce(s: GameState, total: number) {
  let gains: { player: number; hex: number; res: Resource; n: number }[] = [];
  for (const hex of s.board.hexes) {
    if (hex.number !== total || hex.id === s.pirate || hex.terrain === 'storm') continue;
    for (const v of hex.vertices) {
      const b = s.buildings[v];
      if (b) gains.push({ player: b.owner, hex: hex.id, res: hex.terrain, n: b.citadel ? 2 : 1 });
    }
  }
  for (const r of RESOURCES) {
    const mine = gains.filter((g) => g.res === r);
    const demand = mine.reduce((n, g) => n + g.n, 0);
    if (demand <= s.bank[r]) continue;
    const owners = new Set(mine.map((g) => g.player));
    if (owners.size > 1) gains = gains.filter((g) => g.res !== r);
    else {
      // A single player takes whatever is left in the bank.
      let left = s.bank[r];
      gains = gains.flatMap((g) => {
        if (g.res !== r) return [g];
        const n = Math.min(g.n, left);
        left -= n;
        return n > 0 ? [{ ...g, n }] : [];
      });
    }
  }
  for (const g of gains) {
    s.players[g.player].hand[g.res] += g.n;
    s.bank[g.res] -= g.n;
  }
  emit(s, { type: 'produce', gains });
}

function stealRandom(s: GameState, thief: number, victim: number): Resource | null {
  const hand = s.players[victim].hand;
  const total = resTotal(hand);
  if (!total) return null;
  let k = randInt(s, total);
  for (const r of RESOURCES) {
    if (k < hand[r]) {
      hand[r]--;
      s.players[thief].hand[r]++;
      return r;
    }
    k -= hand[r];
  }
  return null;
}

function isRes(x: unknown): x is Resource {
  return typeof x === 'string' && (RESOURCES as readonly string[]).includes(x);
}
function isResMap(x: unknown): x is ResMap {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return RESOURCES.every((r) => Number.isInteger(m[r]) && (m[r] as number) >= 0 && (m[r] as number) <= 99);
}

// ---------- reducer ----------

/** Applies one action by `p`. Never mutates the input; returns a new state or an error. */
export function reduce(state: GameState, p: number, action: Action): Result {
  const s = structuredClone(state);
  const err = apply(s, p, action);
  if (err) return { ok: false, error: err };
  if (s.phase !== 'setup' && s.phase !== 'over' && totalGlory(s, s.current) >= s.options.target) {
    s.winner = s.current;
    s.phase = 'over';
    s.trade = null;
    emit(s, { type: 'win', player: s.current });
  }
  return { ok: true, state: s };
}

function apply(s: GameState, p: number, a: Action): string | null {
  if (!a || typeof a !== 'object') return 'Bad action';
  if (s.phase === 'over') return 'The game is over';
  if (p < 0 || p >= s.players.length) return 'Not a player';
  const pl: Player = s.players[p];
  const mine = p === s.current;

  switch (a.type) {
    case 'placeOutpost': {
      if (!mine) return 'Not your turn';
      if (s.phase === 'setup') {
        if (s.lastOutpost !== null) return 'Place a bridge next';
        if (!outpostOk(s, p, a.vertex)) return 'You cannot build there';
        s.buildings[a.vertex] = { owner: p, citadel: false };
        s.lastOutpost = a.vertex;
        emit(s, { type: 'build', player: p, piece: 'outpost', at: a.vertex });
        if (s.setupStep >= s.players.length) {
          const got: Resource[] = [];
          for (const h of s.board.vertices[a.vertex].hexes) {
            const t = s.board.hexes[h].terrain;
            if (t !== 'storm' && s.bank[t] > 0) { pl.hand[t]++; s.bank[t]--; got.push(t); }
          }
          emit(s, { type: 'setupGain', player: p, res: got });
        }
        return null;
      }
      if (s.phase !== 'main') return 'You cannot build now';
      if (countPieces(s, p).outposts >= LIMITS.outpost) return 'No outposts left';
      if (!canAfford(pl.hand, COSTS.outpost)) return 'Not enough resources';
      if (!outpostOk(s, p, a.vertex)) return 'You cannot build there';
      pay(s, p, COSTS.outpost);
      s.buildings[a.vertex] = { owner: p, citadel: false };
      emit(s, { type: 'build', player: p, piece: 'outpost', at: a.vertex });
      updateLongest(s);
      return null;
    }

    case 'placeBridge': {
      if (!mine) return 'Not your turn';
      if (s.phase === 'setup') {
        if (s.lastOutpost === null) return 'Place an outpost first';
        if (!bridgeOk(s, p, a.edge)) return 'The bridge must touch your new outpost';
        s.bridges[a.edge] = p;
        emit(s, { type: 'build', player: p, piece: 'bridge', at: a.edge });
        s.lastOutpost = null;
        s.setupStep++;
        if (s.setupStep >= s.setupOrder.length) {
          s.current = 0;
          s.phase = 'roll';
          s.turnNumber = 1;
          emit(s, { type: 'turn', player: 0 });
        } else s.current = s.setupOrder[s.setupStep];
        updateLongest(s);
        return null;
      }
      const free = s.phase === 'freeBridges';
      if (!free && s.phase !== 'main') return 'You cannot build now';
      if (countPieces(s, p).bridges >= LIMITS.bridge) return 'No bridges left';
      if (!free && !canAfford(pl.hand, COSTS.bridge)) return 'Not enough resources';
      if (!bridgeOk(s, p, a.edge)) return 'You cannot build there';
      if (!free) pay(s, p, COSTS.bridge);
      s.bridges[a.edge] = p;
      emit(s, { type: 'build', player: p, piece: 'bridge', at: a.edge });
      updateLongest(s);
      if (free) {
        s.freeBridges--;
        if (s.freeBridges <= 0 || countPieces(s, p).bridges >= LIMITS.bridge || !legalBridges(s, p).length) {
          s.freeBridges = 0;
          s.phase = s.returnPhase;
        }
      }
      return null;
    }

    case 'upgrade': {
      if (!mine) return 'Not your turn';
      if (s.phase !== 'main') return 'You cannot build now';
      const b = s.buildings[a.vertex];
      if (!b || b.owner !== p || b.citadel) return 'Upgrade one of your outposts';
      if (countPieces(s, p).citadels >= LIMITS.citadel) return 'No citadels left';
      if (!canAfford(pl.hand, COSTS.citadel)) return 'Not enough resources';
      pay(s, p, COSTS.citadel);
      b.citadel = true;
      emit(s, { type: 'build', player: p, piece: 'citadel', at: a.vertex });
      return null;
    }

    case 'roll': {
      if (!mine) return 'Not your turn';
      if (s.phase !== 'roll') return 'You cannot roll now';
      const dice: [number, number] = [1 + Math.floor(rand(s) * 6), 1 + Math.floor(rand(s) * 6)];
      const total = dice[0] + dice[1];
      s.dice = dice;
      s.rolls[total]++;
      emit(s, { type: 'roll', player: p, dice });
      if (total === 7) {
        s.discards = s.players.map((x) => { const n = resTotal(x.hand); return n > 7 ? Math.floor(n / 2) : 0; });
        s.returnPhase = 'main';
        s.phase = s.discards.some((d) => d > 0) ? 'discard' : 'pirate';
      } else {
        produce(s, total);
        s.phase = 'main';
      }
      return null;
    }

    case 'discard': {
      if (s.phase !== 'discard' || s.discards[p] <= 0) return 'You do not need to discard';
      if (!isResMap(a.cards) || resTotal(a.cards) !== s.discards[p]) return `Discard exactly ${s.discards[p]} cards`;
      if (!canAfford(pl.hand, a.cards)) return 'You do not have those cards';
      pay(s, p, a.cards);
      emit(s, { type: 'discard', player: p, n: s.discards[p] });
      s.discards[p] = 0;
      if (s.discards.every((d) => d === 0)) s.phase = 'pirate';
      return null;
    }

    case 'movePirate': {
      if (!mine) return 'Not your turn';
      if (s.phase !== 'pirate') return 'You cannot move the pirate now';
      if (!Number.isInteger(a.hex) || a.hex < 0 || a.hex >= s.board.hexes.length) return 'Pick an island';
      if (a.hex === s.pirate) return 'The pirate must move to a different island';
      const victims = pirateVictims(s, p, a.hex);
      if (victims.length && !victims.includes(a.victim as number)) return 'Choose a player to steal from';
      s.pirate = a.hex;
      emit(s, { type: 'pirate', player: p, hex: a.hex });
      if (victims.length) emit(s, { type: 'steal', thief: p, victim: a.victim!, res: stealRandom(s, p, a.victim!) });
      s.phase = s.returnPhase;
      return null;
    }

    case 'buyCharter': {
      if (!mine) return 'Not your turn';
      if (s.phase !== 'main') return 'You cannot buy now';
      if (!s.deck.length) return 'No charters left';
      if (!canAfford(pl.hand, COSTS.charter)) return 'Not enough resources';
      pay(s, p, COSTS.charter);
      const kind = s.deck.pop()!;
      pl.newCharters.push(kind);
      emit(s, { type: 'buyCharter', player: p, kind });
      return null;
    }

    case 'playCharter': {
      if (!mine) return 'Not your turn';
      if (s.phase !== 'roll' && s.phase !== 'main') return 'You cannot play a charter now';
      if (s.charterPlayed) return 'Only one charter per turn';
      const idx = pl.charters.indexOf(a.kind);
      if (idx < 0 || a.kind === ('glory' as string)) return 'You have no such charter to play';
      const res = a.res ?? [];
      if (a.kind === 'plenty') {
        if (res.length !== 2 || !res.every(isRes)) return 'Pick two resources';
        const need = emptyRes();
        res.forEach((r) => need[r]++);
        if (!canAfford(s.bank, need)) return 'The bank is out of that resource';
        res.forEach((r) => { pl.hand[r]++; s.bank[r]--; });
        emit(s, { type: 'playCharter', player: p, kind: 'plenty', res });
      } else if (a.kind === 'monopoly') {
        if (res.length !== 1 || !isRes(res[0])) return 'Pick one resource';
        const r = res[0];
        let n = 0;
        s.players.forEach((o, i) => { if (i !== p) { n += o.hand[r]; o.hand[r] = 0; } });
        pl.hand[r] += n;
        emit(s, { type: 'playCharter', player: p, kind: 'monopoly', res: [r], n });
      } else if (a.kind === 'knight') {
        pl.knights++;
        emit(s, { type: 'playCharter', player: p, kind: 'knight' });
        updateFleet(s, p);
        s.returnPhase = s.phase;
        s.phase = 'pirate';
      } else if (a.kind === 'bridges') {
        emit(s, { type: 'playCharter', player: p, kind: 'bridges' });
        const left = LIMITS.bridge - countPieces(s, p).bridges;
        s.freeBridges = Math.min(2, left);
        s.returnPhase = s.phase;
        if (s.freeBridges > 0 && legalBridges(s, p).length) s.phase = 'freeBridges';
        else s.freeBridges = 0;
      } else return 'Unknown charter';
      pl.charters.splice(idx, 1);
      s.charterPlayed = true;
      return null;
    }

    case 'bankTrade': {
      if (!mine) return 'Not your turn';
      if (s.phase !== 'main') return 'You cannot trade now';
      if (!isRes(a.give) || !isRes(a.get) || a.give === a.get) return 'Pick two different resources';
      const n = tradeRatio(s, p, a.give);
      if (pl.hand[a.give] < n) return `You need ${n} ${a.give}`;
      if (s.bank[a.get] < 1) return 'The bank is out of that resource';
      pl.hand[a.give] -= n; s.bank[a.give] += n;
      pl.hand[a.get]++; s.bank[a.get]--;
      emit(s, { type: 'bank', player: p, give: a.give, get: a.get, n });
      return null;
    }

    case 'offerTrade': {
      if (!mine) return 'Not your turn';
      if (s.phase !== 'main') return 'You cannot trade now';
      if (!isResMap(a.give) || !isResMap(a.want)) return 'Bad offer';
      if (!resTotal(a.give) || !resTotal(a.want)) return 'Offer at least one card for at least one card';
      if (RESOURCES.some((r) => a.give[r] && a.want[r])) return 'You cannot give and ask for the same resource';
      if (!canAfford(pl.hand, a.give)) return 'You do not have those cards';
      s.trade = { from: p, give: { ...a.give }, want: { ...a.want }, responses: s.players.map(() => null) };
      emit(s, { type: 'offer', player: p });
      return null;
    }

    case 'respondTrade': {
      const t = s.trade;
      if (!t || p === t.from) return 'No offer to answer';
      if (a.accept && !canAfford(pl.hand, t.want)) return 'You do not have the cards they want';
      t.responses[p] = !!a.accept;
      return null;
    }

    case 'confirmTrade': {
      const t = s.trade;
      if (!t || p !== t.from) return 'No offer to confirm';
      const o = a.with;
      if (t.responses[o] !== true) return 'That player has not accepted';
      if (!canAfford(pl.hand, t.give) || !canAfford(s.players[o].hand, t.want)) return 'Someone no longer has the cards';
      for (const r of RESOURCES) {
        pl.hand[r] += t.want[r] - t.give[r];
        s.players[o].hand[r] += t.give[r] - t.want[r];
      }
      emit(s, { type: 'trade', a: p, b: o, give: t.give, want: t.want });
      s.trade = null;
      return null;
    }

    case 'cancelTrade': {
      if (!s.trade || p !== s.trade.from) return 'No offer to cancel';
      s.trade = null;
      return null;
    }

    case 'endTurn': {
      if (!mine) return 'Not your turn';
      if (s.phase !== 'main') return 'You cannot end your turn now';
      s.trade = null;
      pl.charters.push(...pl.newCharters);
      pl.newCharters = [];
      s.charterPlayed = false;
      s.dice = null;
      s.current = (s.current + 1) % s.players.length;
      s.phase = 'roll';
      s.turnNumber++;
      emit(s, { type: 'turn', player: s.current });
      return null;
    }
  }
  return 'Unknown action';
}
