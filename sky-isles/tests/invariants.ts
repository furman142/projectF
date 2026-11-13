import { LIMITS, RESOURCES, resTotal, type GameState } from '../shared/types.ts';
import { countPieces, longestBridge, totalGlory } from '../shared/engine.ts';

/** Throws if the state breaks a rule that must always hold. */
export function checkInvariants(s: GameState) {
  const fail = (m: string) => { throw new Error(`invariant: ${m} (phase ${s.phase}, turn ${s.turnNumber})`); };
  const n = s.players.length;

  for (const r of RESOURCES) {
    const total = s.bank[r] + s.players.reduce((t, p) => t + p.hand[r], 0);
    if (total !== 19) fail(`${r} total is ${total}, not 19`);
    if (s.bank[r] < 0) fail(`bank ${r} negative`);
    s.players.forEach((p, i) => { if (p.hand[r] < 0 || !Number.isInteger(p.hand[r])) fail(`player ${i} ${r} = ${p.hand[r]}`); });
  }

  const held = s.players.reduce((t, p) => t + p.charters.length + p.newCharters.length + p.knights, 0);
  if (s.deck.length + held > 25) fail(`more than 25 charters exist (${s.deck.length} + ${held})`);

  if (s.current < 0 || s.current >= n) fail('current out of range');
  if (s.pirate < 0 || s.pirate >= s.board.hexes.length) fail('pirate out of range');

  s.players.forEach((p, i) => {
    const c = countPieces(s, i);
    if (c.bridges > LIMITS.bridge || c.outposts > LIMITS.outpost || c.citadels > LIMITS.citadel) fail(`player ${i} has too many pieces`);
    if (i !== s.current && p.newCharters.length) fail(`player ${i} has new charters outside their turn`);
    if (p.longest !== longestBridge(s, i)) fail(`player ${i} longest is stale`);
  });

  s.buildings.forEach((b, v) => {
    if (!b) return;
    if (s.board.vertices[v].adj.some((a) => s.buildings[a])) fail(`distance rule broken at vertex ${v}`);
    if (v !== s.lastOutpost && !s.board.vertices[v].edges.some((e) => s.bridges[e] === b.owner)) fail(`building at ${v} has no own bridge`);
  });

  s.bridges.forEach((o, e) => {
    if (o === null) return;
    const ok = s.board.edges[e].v.some((v) => s.buildings[v]?.owner === o || s.board.vertices[v].edges.some((x) => x !== e && s.bridges[x] === o));
    if (!ok) fail(`bridge ${e} of player ${o} is not connected`);
  });

  if (s.longestHolder !== null) {
    const h = s.longestHolder;
    if (s.players[h].longest < 5) fail('longest holder has under 5');
    if (s.players.some((p) => p.longest > s.players[h].longest)) fail('someone beats the longest holder');
  } else if (s.phase !== 'setup') {
    const max = Math.max(...s.players.map((p) => p.longest));
    const top = s.players.filter((p) => p.longest === max);
    if (max >= 5 && top.length === 1) fail('a unique longest bridge of 5+ has no holder');
  }

  if (s.fleetHolder !== null) {
    const h = s.fleetHolder;
    if (s.players[h].knights < 3) fail('fleet holder has under 3 knights');
    if (s.players.some((p) => p.knights > s.players[h].knights)) fail('someone beats the fleet holder');
  } else if (s.players.some((p) => p.knights >= 3)) fail('3+ knights but no fleet holder');

  if (s.phase === 'discard' && !s.discards.some((d) => d > 0)) fail('discard phase with nothing to discard');
  if (s.phase !== 'discard' && s.discards.some((d) => d > 0)) fail('pending discards outside discard phase');
  s.discards.forEach((d, i) => { if (d > resTotal(s.players[i].hand)) fail(`player ${i} must discard more than they hold`); });

  if (s.trade && s.phase !== 'main') fail(`trade offer open during ${s.phase}`);
  if (s.trade && s.trade.from !== s.current) fail('trade offer from a player whose turn it is not');
  if (s.phase === 'freeBridges' && s.freeBridges <= 0) fail('free bridge phase with none left');

  if ((s.phase === 'over') !== (s.winner !== null)) fail('winner and phase disagree');
  if (s.winner !== null && totalGlory(s, s.winner) < s.options.target) fail('winner below target');
  if (s.phase !== 'over' && s.phase !== 'setup' && totalGlory(s, s.current) >= s.options.target) fail('current player should have won');
  if (s.phase === 'setup' && s.setupStep >= s.setupOrder.length) fail('setup step past the end');
}
