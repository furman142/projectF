import type { Card, Suit } from '../game/types';
import { h } from './dom';

const SUIT_PATHS: Record<Suit, string> = {
  hearts:
    'M12 21.2S3.6 15.6 2.3 10.4C1.4 6.8 3.6 3.6 6.9 3.6c2.1 0 3.8 1.2 5.1 3.2 1.3-2 3-3.2 5.1-3.2 3.3 0 5.5 3.2 4.6 6.8C20.4 15.6 12 21.2 12 21.2z',
  diamonds: 'M12 1.8l7.4 10.2L12 22.2 4.6 12z',
  spades:
    'M12 1.8s8.6 6.3 8.6 11.8c0 2.6-1.9 4.4-4.2 4.4-1.3 0-2.5-.6-3.3-1.6.2 2.2 1 3.9 2.5 5.4H8.4c1.5-1.5 2.3-3.2 2.5-5.4-.8 1-2 1.6-3.3 1.6-2.3 0-4.2-1.8-4.2-4.4C3.4 8.1 12 1.8 12 1.8z',
  clubs:
    'M12 2a4.4 4.4 0 0 1 3.7 6.8 4.4 4.4 0 1 1-2.8 7.5c.3 2.1 1.1 3.9 2.5 5.5H8.6c1.4-1.6 2.2-3.4 2.5-5.5a4.4 4.4 0 1 1-2.8-7.5A4.4 4.4 0 0 1 12 2z',
};

const SUIT_NAMES: Record<Suit, string> = { hearts: 'לב', diamonds: 'יהלום', spades: 'עלה', clubs: 'תלתן' };

export function suitSvg(suit: Suit): string {
  return `<svg class="suit" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${SUIT_PATHS[suit]}"/></svg>`;
}

const JESTER_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <path fill="currentColor" d="M9 33 5.5 14.5 17 22l7-13.5L31 22l11.5-7.5L39 33z"/>
  <circle fill="currentColor" cx="5.5" cy="12.5" r="3"/><circle fill="currentColor" cx="24" cy="6.5" r="3"/><circle fill="currentColor" cx="42.5" cy="12.5" r="3"/>
  <rect fill="currentColor" x="8.5" y="35.5" width="31" height="5" rx="2.5"/>
</svg>`;

export function cardLabel(card: Card): string {
  return card.kind === 'joker' ? 'ג׳וקר' : `${card.rank} ${SUIT_NAMES[card.suit]}`;
}

/** A face-up card. Rendered entirely with CSS and inline SVG (no image files). */
export function cardFace<K extends 'div' | 'button' = 'div'>(card: Card, tag?: K): HTMLElementTagNameMap[K] {
  const el = h((tag ?? 'div') as K, {
    'data-id': card.id,
    'aria-label': cardLabel(card),
    type: tag === 'button' ? 'button' : null,
  });
  if (card.kind === 'joker') {
    el.className = 'card card--joker';
    el.innerHTML = `<span class="card__shine"></span>
      <span class="card__corner"><b>J</b></span>
      <span class="card__jester">${JESTER_SVG}<em>JOKER</em></span>
      <span class="card__corner card__corner--br"><b>J</b></span>`;
  } else {
    const red = card.suit === 'hearts' || card.suit === 'diamonds';
    const suit = suitSvg(card.suit);
    el.className = `card card--${red ? 'red' : 'black'}`;
    el.innerHTML = `<span class="card__corner"><b>${card.rank}</b>${suit}</span>
      <span class="card__pip">${suit}</span>
      <span class="card__corner card__corner--br"><b>${card.rank}</b>${suit}</span>`;
  }
  return el;
}

export function cardBack(extraClass = ''): HTMLDivElement {
  return h('div', { class: `card card--back ${extraClass}`.trim(), 'aria-hidden': 'true' });
}
