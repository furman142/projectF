export const RESOURCES = ['timber', 'clay', 'fiber', 'grain', 'crystal'] as const;
export type Resource = (typeof RESOURCES)[number];
export type ResMap = Record<Resource, number>;
export type Terrain = Resource | 'storm';
export type CharterKind = 'knight' | 'glory' | 'bridges' | 'plenty' | 'monopoly';
export type PlayableCharter = Exclude<CharterKind, 'glory'>;

export interface Hex { id: number; q: number; r: number; x: number; z: number; terrain: Terrain; number: number | null; vertices: number[]; edges: number[] }
export interface Vertex { id: number; x: number; z: number; hexes: number[]; edges: number[]; adj: number[] }
export interface Edge { id: number; v: [number, number]; hexes: number[] }
export interface Port { edge: number; kind: Resource | 'any' }
export interface Board { hexes: Hex[]; vertices: Vertex[]; edges: Edge[]; ports: Port[] }

export interface Building { owner: number; citadel: boolean }

export interface Player {
  name: string;
  color: string;
  bot: boolean;
  hand: ResMap;
  charters: CharterKind[];     // playable (bought on an earlier turn)
  newCharters: CharterKind[];  // bought this turn
  knights: number;             // knights played
  longest: number;             // current longest bridge length
}

export type Phase = 'setup' | 'roll' | 'discard' | 'pirate' | 'main' | 'freeBridges' | 'over';

export interface TradeOffer { from: number; give: ResMap; want: ResMap; responses: (boolean | null)[] }

export interface Options { target: number; friendlyPirate: boolean }

export type GameEvent =
  | { type: 'turn'; player: number }
  | { type: 'roll'; player: number; dice: [number, number] }
  | { type: 'produce'; gains: { player: number; hex: number; res: Resource; n: number }[] }
  | { type: 'build'; player: number; piece: 'outpost' | 'citadel' | 'bridge'; at: number }
  | { type: 'setupGain'; player: number; res: Resource[] }
  | { type: 'discard'; player: number; n: number }
  | { type: 'pirate'; player: number; hex: number }
  | { type: 'steal'; thief: number; victim: number; res: Resource | null }
  | { type: 'buyCharter'; player: number; kind: CharterKind | null }
  | { type: 'playCharter'; player: number; kind: PlayableCharter; res?: Resource[]; n?: number }
  | { type: 'bank'; player: number; give: Resource; get: Resource; n: number }
  | { type: 'offer'; player: number }
  | { type: 'trade'; a: number; b: number; give: ResMap; want: ResMap }
  | { type: 'award'; kind: 'longest' | 'fleet'; player: number | null }
  | { type: 'win'; player: number };

export interface LogEntry { seq: number; ev: GameEvent }

export interface GameState {
  board: Board;
  players: Player[];
  buildings: (Building | null)[]; // by vertex id
  bridges: (number | null)[];     // owner by edge id
  pirate: number;                 // hex id
  bank: ResMap;
  deck: CharterKind[];
  current: number;
  phase: Phase;
  setupOrder: number[];
  setupStep: number;
  lastOutpost: number | null;     // during setup: outpost waiting for its bridge
  discards: number[];             // cards each player still has to discard
  dice: [number, number] | null;
  charterPlayed: boolean;
  freeBridges: number;
  returnPhase: 'roll' | 'main';   // phase to go back to after the pirate / free bridges
  trade: TradeOffer | null;
  longestHolder: number | null;
  fleetHolder: number | null;
  winner: number | null;
  turnNumber: number;
  rolls: number[];                // count per dice total (index = total)
  rng: number;
  seq: number;
  log: LogEntry[];
  options: Options;
}

export type Action =
  | { type: 'placeOutpost'; vertex: number }
  | { type: 'placeBridge'; edge: number }
  | { type: 'upgrade'; vertex: number }
  | { type: 'roll' }
  | { type: 'discard'; cards: ResMap }
  | { type: 'movePirate'; hex: number; victim: number | null }
  | { type: 'buyCharter' }
  | { type: 'playCharter'; kind: PlayableCharter; res?: Resource[] }
  | { type: 'bankTrade'; give: Resource; get: Resource }
  | { type: 'offerTrade'; give: ResMap; want: ResMap }
  | { type: 'respondTrade'; accept: boolean }
  | { type: 'confirmTrade'; with: number }
  | { type: 'cancelTrade' }
  | { type: 'endTurn' };

export const COSTS = {
  bridge: { timber: 1, clay: 1, fiber: 0, grain: 0, crystal: 0 },
  outpost: { timber: 1, clay: 1, fiber: 1, grain: 1, crystal: 0 },
  citadel: { timber: 0, clay: 0, fiber: 0, grain: 2, crystal: 3 },
  charter: { timber: 0, clay: 0, fiber: 1, grain: 1, crystal: 1 },
} satisfies Record<string, ResMap>;

export const LIMITS = { bridge: 15, outpost: 5, citadel: 4 };

export const PLAYER_COLORS = ['#e4573d', '#3f7fe0', '#f2b630', '#8e5bd8'];

export function emptyRes(): ResMap {
  return { timber: 0, clay: 0, fiber: 0, grain: 0, crystal: 0 };
}
export function resTotal(r: ResMap): number {
  return RESOURCES.reduce((n, k) => n + r[k], 0);
}
export function pips(n: number | null): number {
  return n == null ? 0 : 6 - Math.abs(7 - n);
}
