import { chooseBotPass, chooseBotRequest, createBotMemory, observePass, type BotMemory } from '../game/bot';
import { countRanks, fourOfAKindRank } from '../game/deck';
import { reduce } from '../game/engine';
import { canCall, canRequest, forcedRank, hasJoker, isJokerLocked, leftOf, legalPasses, playersWhoCanCall, ranksInPlay, rightOf } from '../game/rules';
import { createMatch, isEliminated, matchWinner } from '../game/score';
import type { Card, MatchState, PlayerId, Rank, RoundState } from '../game/types';
import { wait } from './dom';
import { confetti, shake } from './fx';
import { gameOverBody, homeScreen, openSheet, pauseBody, requestBody, roundEndBody, rulesBody, settingsBody, type Sheet } from './screens';
import { setSoundEnabled, sfx, vibrate } from './sound';
import { loadSettings, saveSettings, type Settings } from './storage';
import { TableView } from './table';

const HUMAN: PlayerId = 'you';
const BOT_NAMES = ['נועה', 'איתי', 'מאיה', 'עומר', 'תמר'];
const rng = Math.random;
const between = (min: number, max: number) => min + rng() * (max - min);

type Phase = 'idle' | 'dealing' | 'choosing' | 'passing' | 'over';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

/** Wires the pure game engine to the views: timing, bots, sounds, screens. */
export class App {
  private settings: Settings = loadSettings();
  private match: MatchState | null = null;
  private memory: Record<PlayerId, BotMemory> = {};
  private view: TableView | null = null;
  private phase: Phase = 'idle';
  private selected: string | null = null;
  private timers = new Set<number>();
  private pendingCallers = new Set<PlayerId>();
  private paused = false;
  private wasLocked = false;
  private deferred: (() => void)[] = [];
  private installPrompt: InstallPromptEvent | null = null;

  constructor(private readonly root: HTMLElement) {
    setSoundEnabled(this.settings.sound);
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e as InstallPromptEvent;
      if (this.phase === 'idle' && !this.root.querySelector('.backdrop')) this.showHome();
    });
    // Every plain button gets a click; game actions play their own sounds.
    root.addEventListener('pointerdown', (e) => {
      const target = (e.target as HTMLElement).closest('.btn, .icon-btn, .segmented button, .switch-row');
      if (target && !target.matches(':disabled, .btn--pass, .btn--call')) sfx.click();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) sfx.heartbeat(false);
      else this.syncHeartbeat();
    });
    this.showHome();
  }

  /** The heartbeat plays only while you are choosing with the Joker in hand. */
  private syncHeartbeat(): void {
    const tense = this.phase === 'choosing' && !this.paused && !!this.match?.round && hasJoker(this.round.hands[HUMAN]);
    sfx.heartbeat(tense);
  }

  // ---------- Screens ----------

  private setScreen(el: HTMLElement): void {
    this.root.replaceChildren(el);
  }

  private showHome(): void {
    this.clearTimers();
    this.phase = 'idle';
    this.match = null;
    this.view = null;
    this.syncHeartbeat();
    this.setScreen(
      homeScreen(this.settings, {
        onPlay: () => {
          sfx.tap();
          this.startMatch();
        },
        onSettings: () => this.showSettings(),
        onRules: () => this.showRules(),
        onInstall: this.installPrompt
          ? () => {
              void this.installPrompt?.prompt();
              this.installPrompt = null;
              this.showHome();
            }
          : null,
      }),
    );
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    setSoundEnabled(this.settings.sound);
    this.view?.setSound(this.settings.sound);
    this.syncHeartbeat();
  }

  private showSettings(): void {
    sfx.sheet();
    const done = () => void sheet.close().then(() => this.showHome());
    const sheet: Sheet = openSheet(this.root, {
      title: 'הגדרות',
      body: settingsBody(this.settings, (patch) => this.updateSettings(patch), done),
      onDismiss: () => this.showHome(),
    });
  }

  private showRules(after?: () => void): void {
    sfx.sheet();
    const sheet: Sheet = openSheet(this.root, {
      title: 'איך משחקים',
      body: rulesBody(() => void sheet.close().then(after), this.settings.requests),
      onDismiss: () => after?.(),
    });
  }

  private showPause(): void {
    if (this.paused) return;
    this.paused = true;
    this.syncHeartbeat();
    sfx.sheet();
    const resume = () => {
      this.paused = false;
      for (const fn of this.deferred.splice(0)) fn();
      this.syncHeartbeat();
    };
    const sheet: Sheet = openSheet(this.root, {
      title: 'הפסקה',
      body: pauseBody(this.settings.sound, {
        onSound: (sound) => this.updateSettings({ sound }),
        onResume: () => void sheet.close().then(resume),
        onRules: () => void sheet.close().then(() => this.showRules(resume)),
        onQuit: () =>
          void sheet.close().then(() => {
            this.paused = false;
            this.deferred = [];
            this.showHome();
          }),
      }),
      onDismiss: resume,
    });
  }

  // ---------- Timers (paused while the menu is open) ----------

  private later(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (this.paused) this.deferred.push(fn);
      else fn();
    }, ms);
    this.timers.add(id);
  }

  private clearTimers(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.pendingCallers.clear();
    this.deferred = [];
  }

  // ---------- Match flow ----------

  private get round(): RoundState {
    return this.match!.round!;
  }

  private startMatch(): void {
    const bots = BOT_NAMES.slice(0, this.settings.players - 1);
    this.match = createMatch([
      { id: HUMAN, name: 'אתם', isHuman: true },
      ...bots.map((name, i) => ({ id: `bot${i + 1}`, name, isHuman: false })),
    ]);
    this.view = new TableView(HUMAN, {
      onCardTap: (id) => this.tapCard(id),
      onPass: () => void this.pass(),
      onCall: () => void this.call(HUMAN),
      onAsk: () => this.ask(),
      onMenu: () => this.showPause(),
      onToggleSound: () => this.updateSettings({ sound: !this.settings.sound }),
    });
    this.view.setSound(this.settings.sound);
    this.view.setAskEnabled(this.settings.requests);
    this.setScreen(this.view.el);
    this.startRound();
  }

  private startRound(): void {
    const view = this.view!;
    this.clearTimers();
    this.match = reduce(this.match!, { type: 'startRound' }, rng);
    this.memory = Object.fromEntries(this.round.order.filter((id) => id !== HUMAN).map((id) => [id, createBotMemory()]));
    this.phase = 'dealing';
    this.selected = null;
    view.setRound(this.match.roundNumber, this.round.order.length);
    view.renderSeats(this.match, true);
    view.renderHand(this.round, { dealing: true });
    view.setActions({ canPass: false, canCall: false });
    view.setStatus('מחלקים קלפים…');
    this.syncHeartbeat();
    sfx.shuffle();
    sfx.deal(this.round.hands[HUMAN].length);
    this.later(1100, () => {
      if (hasJoker(this.round.hands[HUMAN])) this.announceJoker();
      this.beginTurn();
    });
  }

  private announceJoker(): void {
    sfx.joker();
    vibrate([60, 40, 120]);
  }

  /** Everyone now picks a card. Bots that can call start their countdown. */
  private beginTurn(): void {
    const view = this.view!;
    const round = this.round;
    this.phase = 'choosing';
    this.selected = null;
    view.setSelection(null);
    view.clearReady();

    view.clearBubbles();
    view.setForced(null);

    // Bots decide up front whether to spend their request, so you can react.
    if (this.settings.requests) {
      for (const id of round.order) {
        if (id === HUMAN) continue;
        const rank = chooseBotRequest(this.round, id, this.settings.difficulty, rng);
        if (!rank) continue;
        this.match = reduce(this.match!, { type: 'request', player: id, rank }, rng);
        view.setBubble(id, rank, rightOf(this.round, id) === HUMAN ? 'hot' : 'wants');
      }
    }
    const round2 = this.round;
    const asker = leftOf(round2, HUMAN);
    const wanted = round2.requests[asker];
    const forced = forcedRank(round2, HUMAN);
    const askerName = this.match!.players.find((p) => p.id === asker)!.name;
    view.setForced(forced);

    const mine = round2.hands[HUMAN];
    const live = canCall(round2, HUMAN);
    this.refreshActions();
    if (live) {
      view.setStatus('יש לכם רביעייה! לחצו מהר');
      sfx.ready();
      vibrate(80);
    } else if (forced) {
      view.setStatus(`${askerName} רוצה ${forced} — חייבים להעביר`);
      sfx.demand();
      vibrate([30, 40, 30]);
    } else if (fourOfAKindRank(mine)) {
      view.setStatus('רביעייה ביד, אבל קודם צריך להיפטר מהג׳וקר');
    } else {
      view.setStatus('בחרו קלף להעברה');
      if (wanted) {
        view.toast(`${askerName} רוצה ${wanted}, אבל אין לכם`);
        sfx.ask();
      } else if (Object.keys(round2.requests).length) {
        sfx.ask();
      }
    }

    const fast = this.settings.difficulty === 'hard';
    for (const id of playersWhoCanCall(round2)) {
      if (id === HUMAN) continue;
      this.pendingCallers.add(id);
      this.later(fast ? between(500, 1300) : between(1100, 2000), () => void this.call(id));
    }
    for (const id of round.order) {
      if (id === HUMAN) continue;
      this.later(between(450, 1900), () => {
        if (this.phase !== 'choosing') return;
        view.setReady(id, true);
        sfx.botReady();
      });
    }
    // Tell the player the moment a held Joker becomes passable again.
    if (hasJoker(mine) && this.wasLocked && !isJokerLocked(round2, HUMAN)) sfx.unlock();
    this.wasLocked = isJokerLocked(round2, HUMAN);
    this.syncHeartbeat();
  }

  private tapCard(cardId: string): void {
    if (this.phase !== 'choosing') return;
    const view = this.view!;
    const card = this.round.hands[HUMAN].find((c) => c.id === cardId);
    if (!card) return;
    if (card.kind === 'joker' && isJokerLocked(this.round, HUMAN)) {
      view.shake(cardId);
      view.toast('הג׳וקר נעול: חייבים להחזיק אותו סיבוב אחד');
      sfx.error();
      vibrate(40);
      return;
    }
    const forced = forcedRank(this.round, HUMAN);
    if (forced && !legalPasses(this.round, HUMAN).some((c) => c.id === cardId)) {
      view.shake(cardId);
      view.toast(`ביקשו מכם ${forced}: חייבים להעביר אותו`);
      sfx.error();
      vibrate(40);
      return;
    }
    this.selected = this.selected === cardId ? null : cardId;
    if (this.selected) sfx.tap();
    else sfx.deselect();
    vibrate(10);
    view.setSelection(this.selected);
    this.refreshActions();
  }

  private refreshActions(): void {
    const choosing = this.phase === 'choosing';
    const open = choosing && this.settings.requests && canRequest(this.round, HUMAN);
    this.view!.setActions({
      canPass: choosing && this.selected !== null,
      canCall: choosing && canCall(this.round, HUMAN),
      canAsk: open,
      askUsed: this.settings.requests && !canRequest(this.round, HUMAN),
    });
  }

  /** Spend your one request: pick a rank to demand from the player on your right. */
  private ask(): void {
    if (this.phase !== 'choosing' || this.paused || !canRequest(this.round, HUMAN)) return;
    const view = this.view!;
    const target = rightOf(this.round, HUMAN);
    const targetName = this.match!.players.find((p) => p.id === target)!.name;
    const counts = countRanks(this.round.hands[HUMAN]);
    this.paused = true;
    this.syncHeartbeat();
    sfx.sheet();
    const resume = () => {
      this.paused = false;
      for (const fn of this.deferred.splice(0)) fn();
      this.syncHeartbeat();
    };
    const sheet: Sheet = openSheet(this.root, {
      title: `מה לבקש מ${targetName}?`,
      className: 'sheet--ask',
      body: requestBody(
        ranksInPlay(this.round).map((rank) => ({ rank, held: counts.get(rank) ?? 0 })),
        targetName,
        (rank: Rank) =>
          void sheet.close().then(() => {
            resume();
            if (this.phase !== 'choosing' || this.view !== view || !canRequest(this.round, HUMAN)) return;
            this.match = reduce(this.match!, { type: 'request', player: HUMAN, rank }, rng);
            view.setBubble(target, rank, 'asked');
            view.toast(`ביקשתם ${rank} מ${targetName}`);
            sfx.ask();
            vibrate(20);
            this.refreshActions();
          }),
      ),
      onDismiss: resume,
    });
  }

  private async pass(): Promise<void> {
    if (this.phase !== 'choosing' || !this.selected) return;
    // A bot that already has four of a kind gets its call in before the pass.
    const [waiting] = this.pendingCallers;
    if (waiting) return this.call(waiting);

    const view = this.view!;
    const prev = this.round;
    const picks: Record<PlayerId, Card> = {};
    for (const id of prev.order) {
      picks[id] =
        id === HUMAN
          ? prev.hands[HUMAN].find((c) => c.id === this.selected)!
          : chooseBotPass(prev, id, this.settings.difficulty, this.memory[id], rng);
    }

    this.phase = 'passing';
    this.syncHeartbeat();
    this.clearTimers();
    for (const id of prev.order) view.setReady(id, true);
    view.setActions({ canPass: false, canCall: false });
    view.setStatus('מעבירים שמאלה…');
    sfx.pass();

    this.match = reduce(this.match!, { type: 'pass', passes: Object.fromEntries(prev.order.map((id) => [id, picks[id].id])) }, rng);
    const next = this.round;
    for (const id of prev.order) {
      if (id === HUMAN) continue;
      this.memory[id] = observePass(this.memory[id], {
        turn: prev.turn,
        passed: picks[id],
        received: picks[rightOf(prev, id)],
        handAfter: next.hands[id],
      });
    }

    await view.animatePass(prev, next, picks);
    if (this.view !== view || this.phase !== 'passing') return; // left the game mid-animation

    const received = picks[rightOf(prev, HUMAN)];
    const asked = prev.requests[HUMAN];
    const giver = this.match!.players.find((p) => p.id === rightOf(prev, HUMAN))!.name;
    if (received.kind === 'joker') {
      this.announceJoker();
      view.toast('קיבלתם את הג׳וקר!');
    } else if (asked && received.rank === asked) {
      sfx.granted();
      view.toast(`הבקשה הצליחה: קיבלתם ${asked} מ${giver}`);
    } else if (asked) {
      sfx.denied();
      view.toast(`ל${giver} לא היה ${asked}`);
    } else {
      sfx.reveal();
    }
    this.beginTurn();
  }

  private async call(caller: PlayerId): Promise<void> {
    if (this.phase !== 'choosing' || !canCall(this.round, caller)) return;
    const view = this.view!;
    this.phase = 'over';
    this.clearTimers();
    this.match = reduce(this.match!, { type: 'call', player: caller }, rng);
    const match = this.match;
    const { loser } = this.round.result!;
    const name = (id: PlayerId) => match.players.find((p) => p.id === id)!.name;

    this.syncHeartbeat();
    view.setActions({ canPass: false, canCall: false });
    view.setSelection(null);
    view.markResult(this.round, caller, loser);
    view.setStatus(caller === HUMAN ? 'רביעייה שלכם!' : `רביעייה של ${name(caller)}!`);
    if (loser === HUMAN) {
      sfx.lose();
      vibrate([120, 60, 220]);
      shake(view.el);
    } else {
      sfx.call();
      vibrate(caller === HUMAN ? [40, 40, 40, 40, 160] : 60);
      confetti(view.el, { palette: 'gold', count: caller === HUMAN ? 90 : 40, origin: view.originOf(caller), power: caller === HUMAN ? 15 : 9 });
    }
    // Let the face-up cards on the table register before the big flash.
    await wait(750);
    if (this.view !== view) return;
    await view.burst(
      'רביעייה!',
      caller === HUMAN ? 'הכרזתם בזמן' : loser === HUMAN ? `${name(caller)} · והג׳וקר אצלכם` : name(caller),
      loser === HUMAN,
    );
    if (this.view !== view) return;
    await wait(100);
    this.showRoundEnd();
  }

  private showRoundEnd(): void {
    const match = this.match!;
    const me = match.players.find((p) => p.id === HUMAN)!;
    const finished = isEliminated(me) || matchWinner(match) !== null;
    const { caller, loser } = match.round!.result!;
    const loserOut = isEliminated(match.players.find((p) => p.id === loser)!);
    sfx.sheet();
    if (caller === HUMAN) {
      sfx.roundWin();
      confetti(this.root, { origin: { x: 0.5, y: 0.35 } });
    }
    // Timed to the letter popping onto the scoreboard.
    this.later(700, () => {
      sfx.stamp();
      vibrate(30);
      if (loserOut) this.later(350, () => sfx.eliminated());
    });
    const sheet: Sheet = openSheet(this.root, {
      body: roundEndBody(match, HUMAN, finished ? 'לתוצאות' : 'סיבוב הבא', () => {
        sfx.tap();
        void sheet.close().then(() => (finished ? this.showGameOver() : this.startRound()));
      }),
    });
  }

  private showGameOver(): void {
    const match = this.match!;
    const won = matchWinner(match)?.id === HUMAN;
    sfx.sheet();
    if (won) {
      sfx.win();
      confetti(this.root, { count: 160, origin: { x: 0.5, y: 0.3 }, power: 17 });
      this.later(700, () => confetti(this.root, { count: 120, origin: { x: 0.2, y: 0.4 } }));
      this.later(1300, () => confetti(this.root, { count: 120, origin: { x: 0.8, y: 0.4 } }));
      vibrate([60, 60, 60, 60, 200]);
    } else {
      sfx.gameOver();
    }
    const sheet: Sheet = openSheet(this.root, {
      body: gameOverBody(match, HUMAN, won, {
        onAgain: () => void sheet.close().then(() => this.startMatch()),
        onHome: () => void sheet.close().then(() => this.showHome()),
      }),
    });
  }
}
