import type { Difficulty } from '../game/types';

export interface Settings {
  players: number;
  difficulty: Difficulty;
  sound: boolean;
}

const KEY = 'joker.settings.v1';
const DEFAULTS: Settings = { players: 4, difficulty: 'easy', sound: true };

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      players: [3, 4, 5, 6].includes(saved.players ?? 0) ? saved.players! : DEFAULTS.players,
      difficulty: saved.difficulty === 'hard' || saved.difficulty === 'easy' ? saved.difficulty : DEFAULTS.difficulty,
      sound: typeof saved.sound === 'boolean' ? saved.sound : DEFAULTS.sound,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode: settings just won't persist */
  }
}
