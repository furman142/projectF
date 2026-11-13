import { RANKS } from '../game/deck';
import { isJokerLocked, rightOf } from '../game/rules';
import { PENALTY_WORD } from '../game/score';
import type { Card, MatchPlayer, MatchState, PlayerId, RoundState } from '../game/types';
import { cardBack, cardFace } from './card';
import { h, ICONS, reducedMotion, wait } from './dom';

export interface TableHandlers {
  onCardTap(cardId: string): void;
  onPass(): void;
  onCall(): void;
  onMenu(): void;
  onToggleSound(): void;
}

const HUES = [205, 18, 285, 150, 340];

/** The penalty word with the first `count` letters lit. */
export function lettersEl(count: number, newest = false): HTMLElement {
  const el = h('span', { class: 'letters', 'aria-label': `${count} מתוך ${PENALTY_WORD.length} אותיות` });
  [...PENALTY_WORD].forEach((letter, i) => {
    const on = i < count;
    el.append(h('i', { class: `${on ? 'on' : ''} ${on && newest && i === count - 1 ? 'new' : ''}`.trim() }, letter));
  });
  return el;
}

export function avatarEl(player: MatchPlayer, index: number): HTMLElement {
  return h('span', { class: 'avatar', style: `--hue:${HUES[(index + HUES.length - 1) % HUES.length]}` }, player.name[0]);
}

/** Sort a hand for display: grouped by rank, Joker last. */
export function sortHand(hand: readonly Card[]): Card[] {
  const weight = (c: Card) => (c.kind === 'joker' ? 99 : RANKS.indexOf(c.rank));
  return hand.slice().sort((a, b) => weight(a) - weight(b) || a.id.localeCompare(b.id));
}

const RING = `<svg class="table__ring" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">
  <circle cx="50" cy="50" r="46" stroke-width="1" stroke-dasharray="2 5" opacity=".7"/>
  ${[0, 120, 240]
    .map(
      (a) =>
        `<g transform="rotate(${a} 50 50)"><path d="M50 4a46 46 0 0 1 28 9.5" stroke-width="2.2"/><path d="M73 7.5l5.5 6-8 1.5" stroke-width="2.2" stroke-linejoin="round"/></g>`,
    )
    .join('')}
</svg>`;

/** Renders the game screen. Knows nothing about rules beyond what it is shown. */
export class TableView {
  readonly el: HTMLElement;
  private readonly table: HTMLElement;
  private readonly status: HTMLElement;
  private readonly roundPill: HTMLElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly me: HTMLElement;
  private readonly meId: HTMLElement;
  private readonly chipSlot: HTMLElement;
  private readonly hand: HTMLElement;
  private readonly passBtn: HTMLButtonElement;
  private readonly callBtn: HTMLButtonElement;
  private seats = new Map<PlayerId, HTMLElement>();

  constructor(
    private readonly humanId: PlayerId,
    private readonly handlers: TableHandlers,
  ) {
    this.roundPill = h('div', { class: 'round-pill' });
    this.soundBtn = h('button', { class: 'icon-btn', type: 'button', onclick: () => handlers.onToggleSound() });
    this.status = h('div', { class: 'table__status', 'aria-live': 'polite' });
    this.table = h(
      'section',
      { class: 'table' },
      h('div', { class: 'table__felt' }),
      h('div', { class: 'table__center', html: RING }),
    );
    this.table.querySelector('.table__center')!.append(this.status);

    this.meId = h('div', { class: 'me__id' });
    this.chipSlot = h('div', { class: 'me__chip' });
    this.hand = h('div', { class: 'hand' });
    this.passBtn = h(
      'button',
      { class: 'btn btn--gold btn--pass', type: 'button', disabled: true, onclick: () => handlers.onPass() },
      h('span', {}, 'העבר'),
      h('span', { html: ICONS.arrow, style: 'display:grid' }),
    );
    this.callBtn = h(
      'button',
      { class: 'btn btn--call', type: 'button', disabled: true, onclick: () => handlers.onCall() },
      'רביעייה!',
    );
    this.me = h(
      'section',
      { class: 'me' },
      h('div', { class: 'me__bar' }, this.meId, this.chipSlot),
      this.hand,
      h('div', { class: 'actions' }, this.passBtn, this.callBtn),
    );

    this.el = h(
      'main',
      { class: 'screen game' },
      h(
        'header',
        { class: 'topbar' },
        h('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': 'תפריט',
          html: ICONS.menu,
          onclick: () => handlers.onMenu(),
        }),
        this.roundPill,
        this.soundBtn,
      ),
      this.table,
      this.me,
    );
  }

  setSound(on: boolean): void {
    this.soundBtn.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
    this.soundBtn.setAttribute('aria-label', on ? 'השתקת צלילים' : 'הפעלת צלילים');
  }

  setRound(roundNumber: number, playerCount: number): void {
    this.roundPill.replaceChildren(`סיבוב ${roundNumber}`, h('small', {}, `${playerCount} שחקנים`));
  }

  setStatus(text: string): void {
    if (this.status.textContent === text) return;
    this.status.textContent = text;
    this.status.classList.remove('swap');
    void this.status.offsetWidth;
    this.status.classList.add('swap');
  }

  /** Opponents sit clockwise from the human, who is always at the bottom. */
  renderSeats(match: MatchState, dealing = false): void {
    const round = match.round!;
    const n = round.order.length;
    const mine = round.order.indexOf(this.humanId);
    for (const seat of this.seats.values()) seat.remove();
    this.seats.clear();
    this.table.classList.toggle('table--crowded', n >= 5);

    for (let k = 1; k < n; k++) {
      const id = round.order[(mine + k) % n];
      const index = match.players.findIndex((p) => p.id === id);
      const player = match.players[index];
      const angle = (2 * Math.PI * k) / n;
      const x = 50 - 34 * Math.sin(angle);
      const y = 50 + 37 * Math.cos(angle);
      const fan = h('div', { class: `seat__fan ${dealing ? 'is-dealing' : ''}` });
      const count = round.hands[id].length;
      for (let i = 0; i < count; i++) {
        const back = cardBack();
        back.style.setProperty('--rot', `${(i - (count - 1) / 2) * 9}deg`);
        back.style.setProperty('--i', String(i));
        fan.append(back);
      }
      const seat = h(
        'div',
        { class: 'seat', style: `left:${x}%;top:${y}%`, 'data-id': id },
        fan,
        h(
          'div',
          { class: 'seat__plate' },
          h('span', { class: 'seat__check', html: ICONS.check }),
          avatarEl(player, index),
          h('span', {}, player.name),
        ),
        lettersEl(player.letters),
      );
      this.seats.set(id, seat);
      this.table.append(seat);
    }

    const me = match.players.find((p) => p.id === this.humanId)!;
    this.meId.replaceChildren(h('span', {}, me.name), lettersEl(me.letters));
  }

  setReady(id: PlayerId, ready: boolean): void {
    this.seats.get(id)?.classList.toggle('is-ready', ready);
  }

  clearReady(): void {
    for (const seat of this.seats.values()) seat.classList.remove('is-ready');
  }

  markResult(caller: PlayerId, loser: PlayerId): void {
    this.seats.get(caller)?.classList.add('is-caller');
    this.seats.get(loser)?.classList.add('is-loser');
  }

  renderHand(round: RoundState, opts: { dealing?: boolean; hiddenId?: string } = {}): void {
    const cards = sortHand(round.hands[this.humanId]);
    const locked = isJokerLocked(round, this.humanId);
    this.hand.className = `hand hand--${cards.length} ${opts.dealing ? 'is-dealing' : ''}`;
    this.hand.replaceChildren(
      ...cards.map((card, i) => {
        const el = cardFace(card, 'button');
        const offset = i - (cards.length - 1) / 2;
        el.style.setProperty('--rot', `${offset * 4}deg`);
        el.style.setProperty('--drop', `${offset * offset * 2.5}px`);
        el.style.setProperty('--i', String(i));
        if (card.kind === 'joker' && locked) {
          el.classList.add('is-locked');
          el.append(h('span', { class: 'card__lock', html: ICONS.lock }));
          el.setAttribute('aria-label', 'ג׳וקר — נעול לסיבוב הזה');
        }
        if (card.id === opts.hiddenId) el.classList.add('is-hidden');
        el.addEventListener('click', () => this.handlers.onCardTap(card.id));
        return el;
      }),
    );
    if (opts.dealing) setTimeout(() => this.hand.classList.remove('is-dealing'), 1200);

    const joker = round.hands[this.humanId].some((c) => c.kind === 'joker');
    this.me.classList.toggle('has-joker', joker);
    const state = !joker ? 'none' : locked ? 'locked' : 'free';
    if (this.chipSlot.dataset.state !== state) {
      this.chipSlot.dataset.state = state;
      this.chipSlot.replaceChildren();
      if (state === 'locked') {
        this.chipSlot.append(
          h('span', { class: 'joker-chip joker-chip--locked' }, h('span', { html: ICONS.lock, style: 'display:grid' }), 'חייבים להחזיק סיבוב אחד'),
        );
      } else if (state === 'free') {
        this.chipSlot.append(h('span', { class: 'joker-chip' }, 'הג׳וקר אצלכם — העבירו אותו!'));
      }
    }
  }

  private cardEl(cardId: string): HTMLElement | null {
    return this.hand.querySelector<HTMLElement>(`[data-id="${cardId}"]`);
  }

  setSelection(cardId: string | null): void {
    for (const el of this.hand.children) el.classList.toggle('is-selected', (el as HTMLElement).dataset.id === cardId);
    this.hand.classList.toggle('has-selection', cardId !== null);
  }

  setActions(state: { canPass: boolean; canCall: boolean }): void {
    this.passBtn.disabled = !state.canPass;
    this.callBtn.disabled = !state.canCall;
    this.callBtn.classList.toggle('is-live', state.canCall);
  }

  shake(cardId: string): void {
    const el = this.cardEl(cardId);
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  toast(text: string): void {
    this.el.querySelector('.toast')?.remove();
    const toast = h('div', { class: 'toast', role: 'status' }, text);
    this.el.append(toast);
    setTimeout(() => toast.remove(), 2300);
  }

  /** Full-screen "four of a kind!" flash. Resolves when it has faded. */
  async burst(title: string, sub: string, bad: boolean): Promise<void> {
    const el = h(
      'div',
      { class: `burst ${bad ? 'burst--bad' : ''}` },
      h('div', { class: 'burst__rays' }),
      h('div', { class: 'burst__title' }, title),
      h('div', { class: 'burst__sub' }, sub),
    );
    this.el.append(el);
    await wait(reducedMotion() ? 900 : 1650);
    el.remove();
  }

  /**
   * Animates every player's card sliding to the player on their left, then
   * leaves the hand showing `next`. `picks` is what each player passed.
   */
  async animatePass(prev: RoundState, next: RoundState, picks: Record<PlayerId, Card>): Promise<void> {
    const human = this.humanId;
    const received = picks[rightOf(prev, human)];
    const lastMini = (id: PlayerId) => this.seats.get(id)?.querySelector<HTMLElement>('.seat__fan .card:last-child');
    // offsetWidth, not the rect's width: fanned cards are rotated, which inflates their bounding box.
    const center = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: el.offsetWidth };
    };

    // 1. Where every card starts, measured before anything moves.
    const outgoing = this.cardEl(picks[human].id)!;
    const from = new Map<PlayerId, { x: number; y: number; w: number }>();
    for (const id of prev.order) {
      const el = id === human ? outgoing : lastMini(id);
      if (el) from.set(id, center(el));
    }
    const before = new Map<string, DOMRect>();
    for (const el of this.hand.children) before.set((el as HTMLElement).dataset.id!, el.getBoundingClientRect());

    // 2. Lay out the new hand with a gap where the incoming card will land.
    this.table.classList.add('is-passing');
    this.renderHand(next, { hiddenId: received.id });
    this.setSelection(null);
    const duration = reducedMotion() ? 1 : 620;
    for (const el of this.hand.children as Iterable<HTMLElement>) {
      const old = before.get(el.dataset.id!);
      if (!old) continue;
      const now = el.getBoundingClientRect();
      el.animate(
        { translate: [`${old.left - now.left}px ${old.top - now.top}px`, '0px 0px'] },
        { duration: duration * 0.7, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }

    // 3. Where every card lands.
    const slot = this.cardEl(received.id)!;
    const to = new Map<PlayerId, { x: number; y: number; w: number }>();
    for (const id of prev.order) {
      const el = id === human ? slot : lastMini(id);
      if (el) to.set(id, center(el));
    }
    for (const id of prev.order) if (id !== human) lastMini(id)?.style.setProperty('visibility', 'hidden');

    // 4. Fly.
    const flights = prev.order.map((id, i) => {
      const a = from.get(id);
      const b = to.get(prev.order[(i + 1) % prev.order.length]);
      if (!a || !b) return Promise.resolve();
      const width = Math.max(a.w, b.w);
      const height = width * 1.4;
      const inner = h('div', { class: 'flyer__inner' });
      const flyer = h('div', { class: 'flyer', style: `width:${width}px;height:${height}px` }, inner);
      const showFace = id === human;
      if (showFace) inner.append(cardFace(picks[id]));
      inner.append(cardBack(showFace ? 'is-flip' : ''));
      this.el.append(flyer);
      const at = (p: { x: number; y: number; w: number }, lift = 0, turn = 0) =>
        `translate(${p.x - width / 2}px, ${p.y - height / 2 - lift}px) scale(${p.w / width}) rotate(${turn}deg)`;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2 };
      const options: KeyframeAnimationOptions = {
        duration,
        delay: reducedMotion() ? 0 : i * 35,
        easing: 'cubic-bezier(0.45, 0.05, 0.25, 1)',
        fill: 'both',
      };
      if (showFace) inner.animate({ transform: ['rotateY(0deg)', 'rotateY(180deg)'] }, { ...options, duration: duration * 0.6 });
      return flyer
        .animate({ transform: [at(a), at(mid, 26, 10), at(b)] }, options)
        .finished.then(() => flyer.remove());
    });
    await Promise.all(flights);

    // 5. Reveal what arrived.
    for (const id of prev.order) if (id !== human) lastMini(id)?.style.removeProperty('visibility');
    this.table.classList.remove('is-passing');
    slot.classList.remove('is-hidden');
    slot.classList.add('reveal');
    setTimeout(() => slot.classList.remove('reveal'), 500);
  }
}
