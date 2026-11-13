import { PENALTY_WORD, isEliminated } from '../game/score';
import type { Card, MatchState, PlayerId, Rank } from '../game/types';
import { cardFace, suitSvg } from './card';
import { h, ICONS } from './dom';
import type { Settings } from './storage';
import { avatarEl, lettersEl, sortHand } from './table';

const DIFFICULTY_LABEL = { easy: 'קל', hard: 'קשה' } as const;

// ---------- Home ----------

export interface HomeHandlers {
  onPlay(): void;
  onSettings(): void;
  onRules(): void;
  onInstall: (() => void) | null;
}

export function homeScreen(settings: Settings, handlers: HomeHandlers): HTMLElement {
  const hero: Card[] = [
    { id: 'A-spades', kind: 'normal', rank: 'A', suit: 'spades' },
    { id: 'K-hearts', kind: 'normal', rank: 'K', suit: 'hearts' },
    { id: 'joker', kind: 'joker' },
  ];
  // Suits drifting up behind the logo. Fixed values so the layout is stable.
  const drift = [
    [8, 0, 26, 13], [22, 5, 16, 17], [36, 2, 34, 15], [52, 7, 18, 19], [66, 1, 30, 14],
    [80, 4, 20, 16], [92, 8, 26, 18], [15, 10, 14, 21], [45, 12, 22, 20], [74, 11, 16, 22],
  ];
  const suits = ['spades', 'hearts', 'clubs', 'diamonds'] as const;
  return h(
    'main',
    { class: 'screen home' },
    h(
      'div',
      { class: 'home__suits', 'aria-hidden': 'true' },
      ...drift.map(([x, delay, size, dur], i) =>
        h('span', { class: i % 2 ? 'is-red' : '', style: `left:${x}%;width:${size}px;animation-delay:-${delay}s;animation-duration:${dur}s`, html: suitSvg(suits[i % 4]) }),
      ),
    ),
    h(
      'div',
      { class: 'home__hero' },
      h('div', { class: 'home__cards', 'aria-hidden': 'true' }, ...hero.map((card) => cardFace(card))),
      h('h1', { class: 'home__title' }, 'ג׳וקר'),
      h('p', { class: 'home__tagline' }, 'אספו רביעייה. אל תיתקעו עם הג׳וקר.'),
    ),
    h(
      'div',
      { class: 'home__menu' },
      h(
        'div',
        { class: 'home__summary' },
        h('span', {}, `${settings.players} שחקנים`),
        h('span', {}, `רמה: ${DIFFICULTY_LABEL[settings.difficulty]}`),
      ),
      h('button', { class: 'btn btn--gold btn--wide home__play', type: 'button', onclick: handlers.onPlay }, 'משחק חדש'),
      h(
        'div',
        { class: 'home__row' },
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: handlers.onSettings }, h('span', { html: ICONS.gear, style: 'display:grid' }), 'הגדרות'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: handlers.onRules }, h('span', { html: ICONS.help, style: 'display:grid' }), 'איך משחקים'),
      ),
      handlers.onInstall &&
        h('button', { class: 'btn home__install', type: 'button', onclick: handlers.onInstall }, h('span', { html: ICONS.download, style: 'display:grid' }), 'התקנה למסך הבית'),
    ),
  );
}

// ---------- Bottom sheet ----------

export interface Sheet {
  el: HTMLElement;
  close(): Promise<void>;
}

export function openSheet(
  root: HTMLElement,
  opts: { title?: string; body: HTMLElement; onDismiss?: () => void; className?: string },
): Sheet {
  let closed = false;
  const close = () =>
    new Promise<void>((resolve) => {
      if (closed) return resolve();
      closed = true;
      backdrop.classList.add('is-closing');
      setTimeout(() => {
        backdrop.remove();
        resolve();
      }, 190);
    });
  const dismiss = opts.onDismiss && (() => void close().then(opts.onDismiss));
  const sheet = h(
    'div',
    { class: `sheet ${opts.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title ?? 'תוצאות' },
    h('div', { class: 'sheet__grip' }),
    opts.title &&
      h(
        'div',
        { class: 'sheet__head' },
        h('h2', { class: 'sheet__title' }, opts.title),
        dismiss && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'סגירה', html: ICONS.close, onclick: dismiss }),
      ),
    opts.body,
  );
  const backdrop = h('div', { class: 'backdrop' }, sheet);
  if (dismiss) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) dismiss();
    });
  }
  root.append(backdrop);
  return { el: backdrop, close };
}

// ---------- Settings ----------

function segmented<T extends string | number>(
  options: { value: T; label: string }[],
  current: T,
  onPick: (value: T) => void,
): HTMLElement {
  const el = h('div', { class: 'segmented', role: 'group' });
  for (const option of options) {
    const btn = h('button', { type: 'button', 'aria-pressed': String(option.value === current) }, option.label);
    btn.addEventListener('click', () => {
      for (const b of el.children) b.setAttribute('aria-pressed', String(b === btn));
      onPick(option.value);
    });
    el.append(btn);
  }
  return el;
}

export function switchRow(label: string, on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const btn = h('button', { class: 'switch-row', type: 'button', role: 'switch', 'aria-checked': String(on) }, label, h('span', { class: 'switch' }));
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return btn;
}

const DIFFICULTY_HINT = {
  easy: 'הבוטים טועים מדי פעם ומכריזים קצת לאט.',
  hard: 'הבוטים משחקים מדויק, זוכרים מה עבר ומכריזים מהר.',
} as const;

export function settingsBody(settings: Settings, onChange: (patch: Partial<Settings>) => void, onDone: () => void): HTMLElement {
  const hint = h('p', { class: 'field__hint' }, DIFFICULTY_HINT[settings.difficulty]);
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'sheet__body' },
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'מספר שחקנים'),
        segmented(
          [3, 4, 5, 6].map((n) => ({ value: n, label: String(n) })),
          settings.players,
          (players) => onChange({ players }),
        ),
        h('p', { class: 'field__hint' }, 'אתם ועוד בוטים. לכל שחקן יש רביעייה אחת בחפיסה.'),
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'רמת קושי'),
        segmented(
          [
            { value: 'easy' as const, label: 'קל' },
            { value: 'hard' as const, label: 'קשה' },
          ],
          settings.difficulty,
          (difficulty) => {
            hint.textContent = DIFFICULTY_HINT[difficulty];
            onChange({ difficulty });
          },
        ),
        hint,
      ),
      h(
        'div',
        { class: 'field' },
        switchRow('בקשת קלף מהשכן', settings.requests, (requests) => onChange({ requests })),
        h('p', { class: 'field__hint' }, 'פעם אחת בכל חלוקה אפשר לבקש דרגה מהשחקן שמעביר אליכם. גם הבוטים יכולים לבקש מכם.'),
      ),
      switchRow('צלילים', settings.sound, (sound) => onChange({ sound })),
    ),
    h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--gold btn--wide', type: 'button', onclick: onDone }, 'סיום')),
  );
}

// ---------- Rules ----------

export function rulesBody(onDone: () => void, requests = true): HTMLElement {
  const rules = [
    'כל שחקן מקבל <b>4 קלפים</b>. שחקן אחד מקבל גם את <b>הג׳וקר</b> כקלף חמישי.',
    'בכל סיבוב <b>כולם יחד</b> בוחרים קלף אחד ומעבירים אותו לשחקן שמשמאלם.',
    'מי שקיבל את הג׳וקר <b>חייב להחזיק אותו סיבוב אחד</b> לפני שיוכל להעביר אותו הלאה.',
    'אספתם ארבעה קלפים זהים? לחצו מהר על <b>רביעייה!</b> אי אפשר להכריז כשהג׳וקר ביד.',
    requests &&
      '<b>בקשת קלף:</b> פעם אחת בכל חלוקה אפשר לבקש דרגה מהשחקן שמעביר אליכם. אם יש לו, הוא <b>חייב</b> להעביר אותה. גם מכם יכולים לבקש.',
    'מי שמחזיק את הג׳וקר ברגע ההכרזה <b>מפסיד את הסיבוב</b> ומקבל אות.',
    `מי שהשלים את המילה <b class="ltr">${PENALTY_WORD.split('').join('-')}</b> יוצא מהמשחק. האחרון שנשאר מנצח.`,
  ];
  return h(
    'div',
    {},
    h('ol', { class: 'rules' }, ...rules.filter((r): r is string => !!r).map((html) => h('li', {}, h('span', { html })))),
    h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--gold btn--wide', type: 'button', onclick: onDone }, 'הבנתי')),
  );
}

// ---------- Ask a neighbour for a card ----------

export function requestBody(
  options: { rank: Rank; held: number }[],
  neighbour: string,
  onPick: (rank: Rank) => void,
): HTMLElement {
  return h(
    'div',
    {},
    h('p', { class: 'field__hint ask__lead' }, `אם ל${neighbour} יש קלף כזה, הוא יגיע אליכם בהעברה הקרובה. יש רק בקשה אחת בכל חלוקה.`),
    h(
      'div',
      { class: 'ask__grid' },
      ...options.map(({ rank, held }) =>
        h(
          'button',
          { class: `ask__option ${held >= 3 ? 'is-best' : ''}`, type: 'button', onclick: () => onPick(rank) },
          h('b', { class: 'ltr' }, rank),
          h('span', {}, held ? `יש לכם ${held}` : 'אין לכם'),
        ),
      ),
    ),
  );
}

// ---------- Pause menu ----------

export function pauseBody(
  sound: boolean,
  handlers: { onSound(on: boolean): void; onResume(): void; onRules(): void; onQuit(): void },
): HTMLElement {
  return h(
    'div',
    {},
    h('div', { class: 'sheet__body' }, switchRow('צלילים', sound, handlers.onSound)),
    h(
      'div',
      { class: 'sheet__actions' },
      h('button', { class: 'btn btn--gold btn--wide', type: 'button', onclick: handlers.onResume }, 'המשך לשחק'),
      h('button', { class: 'btn btn--ghost btn--wide', type: 'button', onclick: handlers.onRules }, h('span', { html: ICONS.help, style: 'display:grid' }), 'איך משחקים'),
      h('button', { class: 'btn btn--ghost btn--wide', type: 'button', onclick: handlers.onQuit }, h('span', { html: ICONS.home, style: 'display:grid' }), 'יציאה למסך הבית'),
    ),
  );
}

// ---------- Round end / game over ----------

function scoreList(match: MatchState, humanId: PlayerId, loser: PlayerId | null, caller: PlayerId | null): HTMLElement {
  return h(
    'ul',
    { class: 'scores' },
    ...match.players.map((p, i) => {
      const out = isEliminated(p);
      return h(
        'li',
        { class: `${p.id === loser ? 'is-loser' : ''} ${out && p.id !== loser ? 'is-out' : ''}`.trim() },
        avatarEl(p, p.id === humanId ? 3 : i),
        h('span', { class: 'scores__name' }, p.name),
        out
          ? h('span', { class: 'scores__tag scores__tag--out' }, 'בחוץ')
          : p.id === caller && h('span', { class: 'scores__tag' }, 'רביעייה'),
        lettersEl(p.letters, p.id === loser),
      );
    }),
  );
}

export function roundEndBody(match: MatchState, humanId: PlayerId, nextLabel: string, onNext: () => void): HTMLElement {
  const round = match.round!;
  const { caller, loser, rank } = round.result!;
  const name = (id: PlayerId) => match.players.find((p) => p.id === id)!.name;
  const iCalled = caller === humanId;
  const iLost = loser === humanId;
  const loserOut = isEliminated(match.players.find((p) => p.id === loser)!);

  const title = iLost ? 'נתקעתם עם הג׳וקר' : iCalled ? 'ניצחתם את הסיבוב!' : `רביעייה של ${name(caller)}`;
  const sub = iLost
    ? `רביעייה של ${name(caller)}. ${loserOut ? 'השלמתם את המילה.' : 'קיבלתם אות.'}`
    : `הג׳וקר נתקע אצל ${name(loser)}${loserOut ? ' — והמילה הושלמה!' : '.'}`;

  const four = sortHand(round.hands[caller]).filter((c) => c.kind === 'normal' && c.rank === rank);
  const cards = h(
    'div',
    { class: 'result__cards', 'aria-hidden': 'true' },
    h('div', { class: 'result__set' }, ...four.map((c) => cardFace(c))),
    h('span', { class: 'result__vs' }, '•'),
    cardFace({ id: 'joker', kind: 'joker' }),
  );
  cards.querySelectorAll<HTMLElement>('.card').forEach((el, i) => el.style.setProperty('--i', String(i)));

  return h(
    'div',
    { class: `result ${iLost ? 'result--lose' : iCalled ? 'result--win' : ''}` },
    h(
      'div',
      { class: 'result__hero' },
      h('span', { class: 'result__badge' }, `סיבוב ${match.roundNumber}`),
      h('h2', { class: 'result__title' }, title),
      h('p', { class: 'result__sub' }, sub),
      cards,
    ),
    scoreList(match, humanId, loser, caller),
    h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--gold btn--wide', type: 'button', onclick: onNext }, nextLabel)),
  );
}

export function gameOverBody(
  match: MatchState,
  humanId: PlayerId,
  won: boolean,
  handlers: { onAgain(): void; onHome(): void },
): HTMLElement {
  return h(
    'div',
    { class: `result ${won ? 'result--win' : 'result--lose'}` },
    h(
      'div',
      { class: 'result__hero' },
      won ? h('div', { class: 'result__trophy', html: ICONS.trophy }) : h('span', { class: 'result__badge' }, 'סוף המשחק'),
      h('h2', { class: 'result__title' }, won ? 'ניצחתם במשחק!' : 'יצאתם מהמשחק'),
      h('p', { class: 'result__sub', html: won ? `כולם השלימו את המילה חוץ מכם, אחרי ${match.roundNumber} סיבובים.` : 'השלמתם את המילה <span class="ltr">J-O-K-E-R</span>. אולי בפעם הבאה.' }),
    ),
    scoreList(match, humanId, null, null),
    h(
      'div',
      { class: 'sheet__actions' },
      h('button', { class: 'btn btn--gold btn--wide', type: 'button', onclick: handlers.onAgain }, 'משחק חדש'),
      h('button', { class: 'btn btn--ghost btn--wide', type: 'button', onclick: handlers.onHome }, h('span', { html: ICONS.home, style: 'display:grid' }), 'למסך הבית'),
    ),
  );
}
