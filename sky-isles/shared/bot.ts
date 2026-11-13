import {
  COSTS, LIMITS, RESOURCES, emptyRes, pips, resTotal,
  type Action, type GameState, type ResMap, type Resource,
} from './types.ts';
import {
  canAfford, countPieces, legalBridges, legalOutposts, legalUpgrades, outpostOk, pirateVictims, publicGlory, tradeRatio,
} from './engine.ts';

/** How good a vertex is to settle: production, variety and docks. */
export function vertexScore(s: GameState, v: number, p: number): number {
  const vert = s.board.vertices[v];
  let score = 0;
  const kinds = new Set<string>();
  const have = new Set<string>();
  s.buildings.forEach((b, i) => {
    if (b?.owner === p) s.board.vertices[i].hexes.forEach((h) => have.add(s.board.hexes[h].terrain));
  });
  for (const h of vert.hexes) {
    const hex = s.board.hexes[h];
    if (hex.terrain === 'storm') continue;
    const w = hex.terrain === 'crystal' || hex.terrain === 'grain' ? 1.1 : 1;
    score += pips(hex.number) * w * (h === s.pirate ? 0.4 : 1);
    if (!have.has(hex.terrain)) score += 1;
    kinds.add(hex.terrain);
  }
  score += kinds.size * 1.2;
  for (const port of s.board.ports) if (s.board.edges[port.edge].v.includes(v)) score += port.kind === 'any' ? 1.5 : 1;
  return score;
}

function canSettleLater(s: GameState, v: number): boolean {
  return !s.buildings[v] && s.board.vertices[v].adj.every((a) => !s.buildings[a]);
}

function bridgeScore(s: GameState, e: number, p: number): number {
  let best = 0;
  for (const v of s.board.edges[e].v) {
    if (canSettleLater(s, v)) best = Math.max(best, vertexScore(s, v, p));
    for (const a of s.board.vertices[v].adj) {
      if (canSettleLater(s, a)) best = Math.max(best, vertexScore(s, a, p) * 0.6);
    }
  }
  return best + Math.random() * 0.5;
}

function bestBy<T>(items: T[], score: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bs = -Infinity;
  for (const x of items) {
    const v = score(x);
    if (v > bs) { bs = v; best = x; }
  }
  return best;
}

function missing(hand: ResMap, cost: ResMap): ResMap {
  const m = emptyRes();
  for (const r of RESOURCES) m[r] = Math.max(0, cost[r] - hand[r]);
  return m;
}

type Goal = 'citadel' | 'outpost' | 'bridge' | 'charter';

function goals(s: GameState, p: number): Goal[] {
  const c = countPieces(s, p);
  const out: Goal[] = [];
  if (c.citadels < LIMITS.citadel && c.outposts > 0) out.push('citadel');
  if (c.outposts < LIMITS.outpost && legalOutposts(s, p).length) out.push('outpost');
  if (c.bridges < LIMITS.bridge && legalBridges(s, p).length && (!legalOutposts(s, p).length || c.bridges < 4)) out.push('bridge');
  if (s.deck.length) out.push('charter');
  return out;
}

/** One bank trade that gets closer to `cost` without spending what `cost` needs. */
function tradeToward(s: GameState, p: number, cost: ResMap): Action | null {
  const hand = s.players[p].hand;
  const need = missing(hand, cost);
  const want = RESOURCES.find((r) => need[r] > 0 && s.bank[r] > 0);
  if (!want) return null;
  let surplusTotal = 0;
  const options = RESOURCES.filter((r) => r !== want).map((r) => {
    const ratio = tradeRatio(s, p, r);
    const spare = hand[r] - cost[r];
    surplusTotal += Math.floor(Math.max(0, spare) / ratio);
    return { r, ratio, spare };
  });
  if (surplusTotal < resTotal(need)) return null; // can't finish the goal by trading alone
  const give = bestBy(options.filter((o) => o.spare >= o.ratio), (o) => o.spare - o.ratio * 0.5);
  return give ? { type: 'bankTrade', give: give.r, get: want } : null;
}

function pirateMove(s: GameState, p: number): Action {
  const leader = (o: number) => publicGlory(s, o);
  const hex = bestBy(s.board.hexes.filter((h) => h.id !== s.pirate), (h) => {
    let score = 0;
    for (const v of h.vertices) {
      const b = s.buildings[v];
      if (!b) continue;
      const w = (b.citadel ? 2 : 1) * pips(h.number);
      score += b.owner === p ? -w * 2 : w * (1 + leader(b.owner) / 5);
    }
    return score + (pirateVictims(s, p, h.id).length ? 1 : 0) + Math.random() * 0.1;
  })!;
  const victims = pirateVictims(s, p, hex.id);
  const victim = bestBy(victims, (o) => s.players[o].hand ? resTotal(s.players[o].hand) + leader(o) : 0);
  return { type: 'movePirate', hex: hex.id, victim: victim ?? null };
}

function discardFor(s: GameState, p: number): Action {
  const hand = { ...s.players[p].hand };
  const cards = emptyRes();
  for (let n = s.discards[p]; n > 0; n--) {
    const r = bestBy(RESOURCES.filter((x) => hand[x] > 0), (x) => hand[x] - (x === 'crystal' || x === 'grain' ? 0.5 : 0))!;
    hand[r]--;
    cards[r]++;
  }
  return { type: 'discard', cards };
}

function respond(s: GameState, p: number): Action {
  const t = s.trade!;
  const hand = s.players[p].hand;
  if (!canAfford(hand, t.want) || publicGlory(s, t.from) >= s.options.target - 2) return { type: 'respondTrade', accept: false };
  const g = goals(s, p)[0];
  const cost = g ? COSTS[g] : COSTS.charter;
  const before = resTotal(missing(hand, cost));
  const after = { ...hand };
  for (const r of RESOURCES) after[r] += t.give[r] - t.want[r];
  const better = resTotal(missing(after, cost)) < before;
  const fair = resTotal(t.give) >= resTotal(t.want);
  return { type: 'respondTrade', accept: better && fair };
}

/** The next action a bot in seat `p` wants to take, or null if it has nothing to do. */
export function botAction(s: GameState, p: number): Action | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'discard') return s.discards[p] > 0 ? discardFor(s, p) : null;
  if (s.trade && s.trade.from !== p && s.trade.responses[p] === null) return respond(s, p);
  if (s.current !== p) return null;
  const pl = s.players[p];

  switch (s.phase) {
    case 'setup': {
      if (s.lastOutpost === null) {
        const v = bestBy(legalOutposts(s, p), (v) => vertexScore(s, v, p) + Math.random() * 0.3)!;
        return { type: 'placeOutpost', vertex: v };
      }
      return { type: 'placeBridge', edge: bestBy(legalBridges(s, p), (e) => bridgeScore(s, e, p))! };
    }
    case 'pirate':
      return pirateMove(s, p);
    case 'freeBridges':
      return { type: 'placeBridge', edge: bestBy(legalBridges(s, p), (e) => bridgeScore(s, e, p))! };
    case 'roll': {
      const blocked = s.board.hexes[s.pirate].vertices.some((v) => s.buildings[v]?.owner === p);
      if (blocked && !s.charterPlayed && pl.charters.includes('knight')) return { type: 'playCharter', kind: 'knight' };
      return { type: 'roll' };
    }
    case 'main': {
      if (s.trade?.from === p) return { type: 'cancelTrade' };
      const hand = pl.hand;
      if (!s.charterPlayed) {
        const blocked = s.board.hexes[s.pirate].vertices.some((v) => s.buildings[v]?.owner === p);
        if (blocked && pl.charters.includes('knight')) return { type: 'playCharter', kind: 'knight' };
        if (pl.charters.includes('bridges') && legalBridges(s, p).length && countPieces(s, p).bridges < LIMITS.bridge - 1)
          return { type: 'playCharter', kind: 'bridges' };
      }
      const gs = goals(s, p);
      for (const g of gs) {
        if (!canAfford(hand, COSTS[g])) continue;
        if (g === 'citadel') {
          const v = bestBy(legalUpgrades(s, p), (v) => vertexScore(s, v, p));
          if (v !== undefined) return { type: 'upgrade', vertex: v };
        } else if (g === 'outpost') {
          const v = bestBy(legalOutposts(s, p), (v) => vertexScore(s, v, p));
          if (v !== undefined) return { type: 'placeOutpost', vertex: v };
        } else if (g === 'bridge') {
          return { type: 'placeBridge', edge: bestBy(legalBridges(s, p), (e) => bridgeScore(s, e, p))! };
        } else return { type: 'buyCharter' };
      }
      if (!s.charterPlayed && gs.length) {
        const need = missing(hand, COSTS[gs[0]]);
        const lacking = RESOURCES.filter((r) => need[r] > 0);
        if (pl.charters.includes('plenty') && resTotal(need) <= 2) {
          const res: Resource[] = [];
          for (const r of lacking) for (let i = 0; i < need[r]; i++) res.push(r);
          while (res.length < 2) res.push(lacking[0] ?? 'crystal');
          if (res.every((r) => s.bank[r] >= res.filter((x) => x === r).length)) return { type: 'playCharter', kind: 'plenty', res };
        }
        if (pl.charters.includes('monopoly') && lacking.length) return { type: 'playCharter', kind: 'monopoly', res: [lacking[0]] };
      }
      for (const g of gs) {
        const t = tradeToward(s, p, COSTS[g]);
        if (t) return t;
      }
      return { type: 'endTurn' };
    }
  }
  return null;
}

/**
 * Plain legal moves to try if a bot's chosen move is rejected, so the game can never freeze.
 * Ordered from "least harmful" to "anything legal".
 */
export function fallbackActions(s: GameState, p: number): Action[] {
  const out: Action[] = [];
  if (s.phase === 'discard' && s.discards[p] > 0) out.push(discardFor(s, p));
  if (s.trade && s.trade.from !== p && s.trade.responses[p] === null) out.push({ type: 'respondTrade', accept: false });
  if (s.current !== p) return out;
  if (s.trade?.from === p) out.push({ type: 'cancelTrade' });
  switch (s.phase) {
    case 'roll': out.push({ type: 'roll' }); break;
    case 'main': out.push({ type: 'endTurn' }); break;
    case 'pirate':
      for (const h of s.board.hexes) {
        if (h.id === s.pirate) continue;
        const victims = pirateVictims(s, p, h.id);
        out.push({ type: 'movePirate', hex: h.id, victim: victims[0] ?? null });
      }
      break;
    case 'setup':
      if (s.lastOutpost === null) legalOutposts(s, p).forEach((v) => out.push({ type: 'placeOutpost', vertex: v }));
      else legalBridges(s, p).forEach((e) => out.push({ type: 'placeBridge', edge: e }));
      break;
    case 'freeBridges':
      legalBridges(s, p).forEach((e) => out.push({ type: 'placeBridge', edge: e }));
      break;
  }
  return out;
}

export { outpostOk };
