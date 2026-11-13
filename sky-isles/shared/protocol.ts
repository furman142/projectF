import type { Action, Options } from './types.ts';
import type { GameView } from './view.ts';

export interface SeatInfo { name: string; color: string; bot: boolean; connected: boolean }
export interface LobbyInfo { code: string; seats: SeatInfo[]; host: number; options: Options; started: boolean }

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string; token?: string }
  | { t: 'addBot' }
  | { t: 'kick'; seat: number }
  | { t: 'options'; options: Partial<Options> }
  | { t: 'start' }
  | { t: 'action'; id: number; action: Action }
  | { t: 'toLobby' }
  | { t: 'leave' };

export type ServerMsg =
  | { t: 'joined'; code: string; seat: number; token: string }
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'view'; view: GameView }
  | { t: 'result'; id: number; error: string | null }
  | { t: 'error'; message: string; fatal?: boolean };

export const MAX_SEATS = 4;
