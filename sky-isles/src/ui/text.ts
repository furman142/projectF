import { RESOURCES, type CharterKind, type GameEvent, type ResMap, type Resource } from '../../shared/types.ts';

export const RES_ICON: Record<Resource, string> = { timber: '🪵', clay: '🧱', fiber: '☁️', grain: '🌾', crystal: '💎' };
export const RES_NAME: Record<Resource, string> = { timber: 'Timber', clay: 'Clay', fiber: 'Fiber', grain: 'Grain', crystal: 'Crystal' };

export const CHARTERS: Record<CharterKind, { name: string; icon: string; text: string }> = {
  knight: { name: 'Sky Knight', icon: '⚔️', text: 'Move the pirate and steal a card. Counts toward Largest Fleet.' },
  glory: { name: 'Glory', icon: '⭐', text: '+1 Glory, kept secret until the end.' },
  bridges: { name: 'Bridge Builders', icon: '🌉', text: 'Build 2 bridges for free.' },
  plenty: { name: 'Bountiful Winds', icon: '🌬️', text: 'Take any 2 resources from the bank.' },
  monopoly: { name: 'Monopoly', icon: '👑', text: 'Every other player gives you all of one resource.' },
};

export function resList(m: ResMap): string {
  return RESOURCES.filter((r) => m[r] > 0).map((r) => `${m[r]}${RES_ICON[r]}`).join(' ') || 'nothing';
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** One log line for an event. `name(i)` returns HTML for a player name. */
export function describe(ev: GameEvent, name: (i: number) => string, me: number): string | null {
  const you = (i: number) => (i === me ? 'You' : name(i));
  switch (ev.type) {
    case 'turn': return `— ${ev.player === me ? 'Your' : name(ev.player) + '’s'} turn —`;
    case 'roll': return `${you(ev.player)} rolled <b>${ev.dice[0] + ev.dice[1]}</b>`;
    case 'produce': {
      if (!ev.gains.length) return 'Nobody produced anything';
      const by = new Map<number, ResMap>();
      for (const g of ev.gains) {
        const m = by.get(g.player) ?? { timber: 0, clay: 0, fiber: 0, grain: 0, crystal: 0 };
        m[g.res] += g.n;
        by.set(g.player, m);
      }
      return [...by].map(([p, m]) => `${you(p)} got ${resList(m)}`).join(', ');
    }
    case 'build': return `${you(ev.player)} built ${ev.piece === 'outpost' ? 'an outpost' : ev.piece === 'citadel' ? 'a citadel' : 'a bridge'}`;
    case 'setupGain': return ev.res.length ? `${you(ev.player)} got ${ev.res.map((r) => RES_ICON[r]).join(' ')}` : null;
    case 'discard': return `${you(ev.player)} discarded ${ev.n} cards`;
    case 'pirate': return `${you(ev.player)} moved the sky pirate`;
    case 'steal': return `${you(ev.thief)} stole ${ev.res ? RES_ICON[ev.res] : 'a card'} from ${ev.victim === me ? 'you' : name(ev.victim)}`;
    case 'buyCharter': return `${you(ev.player)} bought a charter${ev.kind ? ` (${CHARTERS[ev.kind].name})` : ''}`;
    case 'playCharter': {
      const c = CHARTERS[ev.kind];
      const extra = ev.kind === 'monopoly' && ev.res ? ` and took ${ev.n} ${RES_ICON[ev.res[0]]}` : ev.kind === 'plenty' && ev.res ? `: ${ev.res.map((r) => RES_ICON[r]).join(' ')}` : '';
      return `${you(ev.player)} played ${c.icon} ${c.name}${extra}`;
    }
    case 'bank': return `${you(ev.player)} traded ${ev.n}${RES_ICON[ev.give]} for 1${RES_ICON[ev.get]} with the bank`;
    case 'offer': return `${you(ev.player)} offered a trade`;
    case 'trade': return `${you(ev.a)} traded ${resList(ev.give)} for ${resList(ev.want)} with ${ev.b === me ? 'you' : name(ev.b)}`;
    case 'award':
      return ev.player === null
        ? `Nobody holds ${ev.kind === 'longest' ? 'Longest Sky-Bridge' : 'Largest Fleet'} now`
        : `${you(ev.player)} ${ev.player === me ? 'take' : 'takes'} ${ev.kind === 'longest' ? '🌉 Longest Sky-Bridge' : '⚔️ Largest Fleet'} (+2)`;
    case 'win': return `🏆 ${you(ev.player)} ${ev.player === me ? 'win' : 'wins'}!`;
  }
}
