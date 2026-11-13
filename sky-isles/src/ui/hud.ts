import { COSTS, LIMITS, RESOURCES, emptyRes, resTotal, type Action, type GameState, type PlayableCharter, type ResMap, type Resource } from '../../shared/types.ts';
import { canAfford, countPieces, legalBridges, legalOutposts, legalUpgrades, tradeRatio } from '../../shared/engine.ts';
import type { GameView, ViewPlayer } from '../../shared/view.ts';
import type { Conn } from '../conn.ts';
import type { World } from '../scene/world.ts';
import { CHARTERS, RES_ICON, RES_NAME, describe, esc, resList } from './text.ts';
import { music, sfx } from './sound.ts';

type BuildMode = 'bridge' | 'outpost' | 'citadel' | null;
type Modal = null | 'trade' | 'charters' | 'victim' | 'pick' | 'menu';

const DICE_PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function dieHtml(n: number) {
  return `<div class="die">${[...Array(9).keys()].map((i) => `<i class="${DICE_PIPS[n].includes(i) ? 'on' : ''}"></i>`).join('')}</div>`;
}
function costHtml(c: ResMap) {
  return RESOURCES.filter((r) => c[r]).map((r) => `<span>${c[r] > 1 ? c[r] : ''}${RES_ICON[r]}</span>`).join('');
}

export class Hud {
  private v: GameView | null = null;
  private lastSeq = -1;
  private mode: BuildMode = null;
  private modal: Modal = null;
  private pirateHex = -1;
  private pickCtx: { kind: 'plenty' | 'monopoly'; picked: Resource[] } | null = null;
  private offer = { give: emptyRes(), want: emptyRes() };
  private bankGive: Resource | null = null;
  private bankGet: Resource | null = null;
  private discard = emptyRes();
  private busy = false;
  private revealAt = 0;
  private overAt = 0;
  private modalKey = '';
  private prevHand: ResMap | null = null;
  private bumps = new Map<Resource, number>();
  private logOpen = innerWidth > 900;
  private els: Record<'top' | 'banner' | 'log' | 'bottom' | 'modal' | 'toast' | 'fx', HTMLElement>;

  constructor(private root: HTMLElement, private world: World, private conn: Conn, private onExit: (gameOver: boolean) => void) {
    root.innerHTML = `
      <div class="hud-top"></div>
      <div class="banner"></div>
      <div class="log"></div>
      <div class="hud-bottom"></div>
      <div class="modal-layer"></div>
      <div class="toasts"></div>
      <div class="fx"></div>`;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    this.els = { top: q('.hud-top'), banner: q('.banner'), log: q('.log'), bottom: q('.hud-bottom'), modal: q('.modal-layer'), toast: q('.toasts'), fx: q('.fx') };
    root.addEventListener('click', (e) => this.onClick(e));
    conn.onView = (v) => this.update(v);
    world.fx.onFirework = () => sfx.firework();
    music.start();
  }

  destroy() {
    music.stop();
    this.world.fx.onFirework = null;
    this.world.setTargets(null, [], '#fff', null);
    this.root.innerHTML = '';
  }

  private get me() { return this.v!.me; }
  private get myTurn() { return !!this.v && this.v.current === this.me && this.v.phase !== 'over'; }
  private get hand(): ResMap { return this.v!.players[this.me]?.hand ?? emptyRes(); }
  private asState() { return this.v as unknown as GameState; }
  private name(i: number) {
    const p = this.v!.players[i];
    return `<b style="color:${p.color}">${esc(p.name)}</b>`;
  }

  update(v: GameView) {
    const first = this.v === null;
    this.v = v;
    if (v.phase !== 'main' || !this.myTurn) this.mode = null;
    if (this.mode && !canAfford(this.hand, COSTS[this.mode])) this.mode = null;
    if (this.modal === 'trade' && (!this.myTurn || v.phase !== 'main')) this.modal = null;
    if (this.modal === 'victim' && v.phase !== 'pirate') this.modal = null;
    if (v.phase !== 'discard') this.discard = emptyRes();
    this.world.update(v);
    const hand = v.players[v.me]?.hand;
    if (hand && this.prevHand) for (const r of RESOURCES) if (hand[r] > this.prevHand[r]) this.bumps.set(r, hand[r] - this.prevHand[r]);
    this.prevHand = hand ? { ...hand } : null;
    if (first) this.lastSeq = v.log.length ? v.log[v.log.length - 1].seq : 0;
    else this.playEvents(v);
    this.render();
  }

  // ---------- events → effects ----------

  private playEvents(v: GameView) {
    const fresh = v.log.filter((e) => e.seq > this.lastSeq);
    if (!fresh.length) return;
    this.lastSeq = fresh[fresh.length - 1].seq;
    const color = (p: number) => v.players[p]?.color ?? '#fff';
    // Effects that depend on the dice wait until the 3D dice have landed.
    let diceDelay = 0;
    for (const { ev } of fresh) {
      switch (ev.type) {
        case 'roll': {
          sfx.roll();
          this.world.fx.rollDice(ev.dice);
          this.rollDice();
          diceDelay = 950;
          if (ev.dice[0] + ev.dice[1] === 7) {
            setTimeout(() => { sfx.seven(); this.world.fx.shake(500, 0.16); this.flash('seven'); }, diceDelay);
          }
          break;
        }
        case 'produce': {
          const total = v.dice ? v.dice[0] + v.dice[1] : 0;
          setTimeout(() => {
            this.world.bounceTokens(total);
            this.world.flashHexes(ev.gains.map((g) => g.hex));
            ev.gains.forEach((g, i) => {
              this.world.fx.resource(this.world.hexPos(g.hex), RES_ICON[g.res], i * 90);
              this.fly(g.hex, g.player, `${g.n > 1 ? g.n : ''}${RES_ICON[g.res]}`, 350 + i * 90);
            });
            const mine = [...new Set(ev.gains.filter((g) => g.player === this.me).map((g) => g.res))];
            mine.forEach((r, i) => sfx.resource(r, 0.35 + i * 0.12));
            if (!mine.length && ev.gains.length) sfx.resource(ev.gains[0].res, 0.35);
          }, diceDelay);
          break;
        }
        case 'setupGain':
          if (ev.player === this.me) ev.res.forEach((r, i) => sfx.resource(r, 0.4 + i * 0.12));
          break;
        case 'build': {
          sfx.build(ev.piece);
          const pos = ev.piece === 'bridge' ? this.world.edgePos(ev.at) : this.world.vertexPos(ev.at);
          setTimeout(() => this.world.fx.build(pos, color(ev.player), ev.piece), 380);
          break;
        }
        case 'pirate':
          sfx.pirate();
          setTimeout(() => this.world.fx.smoke(this.world.hexPos(ev.hex)), 700);
          break;
        case 'steal':
          setTimeout(() => sfx.steal(), 700);
          if (ev.victim === this.me) this.toast(`☠️ ${this.name(ev.thief)} stole ${ev.res ? RES_ICON[ev.res] : 'a card'} from you`, 'bad');
          if (ev.thief === this.me) this.toast(`☠️ You stole ${ev.res ? RES_ICON[ev.res] : 'a card'}`, 'good');
          break;
        case 'discard': if (ev.player === this.me) sfx.discard(); break;
        case 'turn':
          if (ev.player === this.me) { sfx.turn(); this.toast('Your turn!', 'good'); this.flash('turn'); }
          break;
        case 'buyCharter':
          if (ev.player === this.me) {
            sfx.charterBuy();
            if (ev.kind) this.toast(`📜 New charter: ${CHARTERS[ev.kind].icon} ${CHARTERS[ev.kind].name}`, 'good');
          } else sfx.click();
          break;
        case 'playCharter':
          sfx.charterPlay(ev.kind);
          if (ev.player !== this.me) this.toast(describe(ev, (i) => this.name(i), this.me)!, 'info');
          if (ev.kind === 'monopoly' && ev.player !== this.me && ev.res) this.flash('bad');
          break;
        case 'award':
          if (ev.player !== null) {
            sfx.award();
            this.bigBanner(`${ev.kind === 'longest' ? '🌉 Longest Sky-Bridge' : '⚔️ Largest Fleet'}`, ev.player === this.me ? 'You get +2 Glory' : `${esc(v.players[ev.player].name)} gets +2 Glory`, color(ev.player));
          }
          break;
        case 'trade': case 'bank': sfx.trade(); break;
        case 'offer': if (ev.player !== this.me) sfx.offer(); break;
        case 'win':
          if (ev.player === this.me) sfx.win(); else sfx.lose();
          this.world.fx.fireworks(ev.player === this.me ? 6 : 3);
          this.bigBanner(ev.player === this.me ? '🏆 Victory!' : `🏆 ${esc(v.players[ev.player].name)} wins`, '', color(ev.player));
          if (ev.player === this.me) this.confetti();
          // Let the banner and fireworks play before the results window covers the board.
          this.overAt = performance.now() + 2600;
          setTimeout(() => this.render(), 2650);
          break;
        default: break;
      }
    }
  }

  private rollDice() {
    // Hide the result in the corner until the 3D dice land.
    this.revealAt = performance.now() + 900;
    setTimeout(() => {
      if (this.v) this.renderTop(this.v);
      const el = this.els.top.querySelector('.dice');
      el?.classList.remove('rolling');
      void (el as HTMLElement | null)?.offsetWidth;
      el?.classList.add('rolling');
    }, 920);
  }

  private flash(kind: 'seven' | 'turn' | 'bad') {
    const f = document.createElement('div');
    f.className = `flash ${kind}`;
    this.els.fx.appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }

  private bigBanner(title: string, sub: string, color: string) {
    const b = document.createElement('div');
    b.className = 'big-banner';
    b.style.setProperty('--pc', color);
    b.innerHTML = `<div class="bb-title">${title}</div>${sub ? `<div class="bb-sub">${sub}</div>` : ''}`;
    this.els.fx.appendChild(b);
    setTimeout(() => b.remove(), 2600);
  }

  private fly(hex: number, player: number, label: string, delay: number) {
    const from = this.world.hexScreen(hex);
    const target = player === this.me
      ? this.els.bottom.querySelector('.hand')
      : this.els.top.querySelector(`[data-player="${player}"]`);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'fly';
    chip.textContent = label;
    chip.style.left = `${from.x}px`;
    chip.style.top = `${from.y}px`;
    this.els.fx.appendChild(chip);
    setTimeout(() => {
      chip.style.transform = `translate(${r.left + r.width / 2 - from.x}px, ${r.top + r.height / 2 - from.y}px) scale(.6)`;
      chip.style.opacity = '0.2';
    }, 30 + delay);
    setTimeout(() => chip.remove(), 1000 + delay);
  }

  private toast(html: string, kind: 'good' | 'bad' | 'gold' | 'info' = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = html;
    this.els.toast.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  private confetti() {
    const colors = ['#f2b630', '#e4573d', '#3f7fe0', '#8e5bd8', '#5ed38a', '#fff'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = `${Math.random() * 100}vw`;
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${Math.random() * 0.8}s`;
      c.style.animationDuration = `${2 + Math.random() * 2}s`;
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      this.els.fx.appendChild(c);
      setTimeout(() => c.remove(), 5000);
    }
  }

  // ---------- actions ----------

  private async send(a: Action) {
    if (this.busy) return;
    this.busy = true;
    const err = await this.conn.send(a);
    this.busy = false;
    if (err) { sfx.error(); this.toast(esc(err), 'bad'); }
  }

  private onClick(e: Event) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const act = el.dataset.act!;
    const arg = el.dataset.arg ?? '';
    const v = this.v!;
    sfx.click();
    switch (act) {
      case 'roll': void this.send({ type: 'roll' }); break;
      case 'end': this.mode = null; void this.send({ type: 'endTurn' }); break;
      case 'build':
        this.mode = this.mode === arg ? null : (arg as BuildMode);
        break;
      case 'buyCharter': void this.send({ type: 'buyCharter' }); break;
      case 'modal':
        this.modal = this.modal === arg ? null : (arg as Modal);
        if (arg === 'trade') { this.offer = { give: emptyRes(), want: emptyRes() }; this.bankGive = this.bankGet = null; }
        break;
      case 'close': this.modal = null; this.pickCtx = null; break;
      case 'log': this.logOpen = !this.logOpen; break;
      case 'mute': sfx.toggle(); break;
      case 'music': music.toggle(); break;
      case 'exit': this.onExit(v.phase === 'over'); return;
      case 'play': {
        const kind = arg as PlayableCharter;
        if (kind === 'plenty' || kind === 'monopoly') { this.pickCtx = { kind, picked: [] }; this.modal = 'pick'; }
        else { this.modal = null; void this.send({ type: 'playCharter', kind }); }
        break;
      }
      case 'pickRes': {
        const ctx = this.pickCtx!;
        ctx.picked.push(arg as Resource);
        const need = ctx.kind === 'plenty' ? 2 : 1;
        if (ctx.picked.length >= need) {
          this.modal = null;
          this.pickCtx = null;
          void this.send({ type: 'playCharter', kind: ctx.kind, res: ctx.picked });
        }
        break;
      }
      case 'victim':
        this.modal = null;
        void this.send({ type: 'movePirate', hex: this.pirateHex, victim: Number(arg) });
        break;
      case 'disc': {
        const [r, d] = arg.split(':') as [Resource, string];
        const n = this.discard[r] + Number(d);
        if (n >= 0 && n <= this.hand[r]) this.discard[r] = n;
        break;
      }
      case 'discardGo': void this.send({ type: 'discard', cards: this.discard }); break;
      case 'bankGive': this.bankGive = arg as Resource; break;
      case 'bankGet': this.bankGet = arg as Resource; break;
      case 'bankGo':
        if (this.bankGive && this.bankGet) void this.send({ type: 'bankTrade', give: this.bankGive, get: this.bankGet });
        break;
      case 'off': {
        const [side, r, d] = arg.split(':') as ['give' | 'want', Resource, string];
        const n = this.offer[side][r] + Number(d);
        if (n < 0 || (side === 'give' && n > this.hand[r]) || n > 19) break;
        this.offer[side][r] = n;
        if (n > 0) this.offer[side === 'give' ? 'want' : 'give'][r] = 0;
        break;
      }
      case 'offerGo': void this.send({ type: 'offerTrade', give: this.offer.give, want: this.offer.want }); break;
      case 'offerCancel': void this.send({ type: 'cancelTrade' }); break;
      case 'confirm': void this.send({ type: 'confirmTrade', with: Number(arg) }); break;
      case 'respond': void this.send({ type: 'respondTrade', accept: arg === 'yes' }); break;
    }
    if (v === this.v) this.render();
  }

  private onPick(id: number) {
    const v = this.v!;
    if (v.phase === 'setup') {
      void this.send(v.lastOutpost === null ? { type: 'placeOutpost', vertex: id } : { type: 'placeBridge', edge: id });
    } else if (v.phase === 'pirate') {
      const victims = this.victims(id);
      this.pirateHex = id;
      if (victims.length > 1) { this.modal = 'victim'; this.render(); }
      else void this.send({ type: 'movePirate', hex: id, victim: victims[0] ?? null });
    } else if (v.phase === 'freeBridges') {
      void this.send({ type: 'placeBridge', edge: id });
    } else if (this.mode === 'bridge') void this.send({ type: 'placeBridge', edge: id });
    else if (this.mode === 'outpost') void this.send({ type: 'placeOutpost', vertex: id });
    else if (this.mode === 'citadel') void this.send({ type: 'upgrade', vertex: id });
  }

  private victims(hex: number): number[] {
    const v = this.v!;
    const out = new Set<number>();
    for (const vert of v.board.hexes[hex].vertices) {
      const b = v.buildings[vert];
      if (!b || b.owner === this.me || v.players[b.owner].cardCount === 0) continue;
      if (v.options.friendlyPirate && v.players[b.owner].glory <= 2) continue;
      out.add(b.owner);
    }
    return [...out];
  }

  // ---------- rendering ----------

  private render() {
    const v = this.v;
    if (!v) return;
    this.renderTop(v);
    this.renderBanner(v);
    this.renderLog(v);
    this.renderBottom(v);
    this.renderModal(v);
    this.updateTargets(v);
  }

  private updateTargets(v: GameView) {
    const s = this.asState();
    const color = v.players[this.me]?.color ?? '#fff';
    const pick = (id: number) => this.onPick(id);
    if (!this.myTurn || this.modal === 'victim') return this.world.setTargets(null, [], color, null);
    if (v.phase === 'setup') {
      return v.lastOutpost === null
        ? this.world.setTargets('vertex', legalOutposts(s, this.me), color, pick)
        : this.world.setTargets('edge', legalBridges(s, this.me), color, pick);
    }
    if (v.phase === 'pirate') return this.world.setTargets('hex', v.board.hexes.filter((h) => h.id !== v.pirate).map((h) => h.id), '#ff5a4f', pick);
    if (v.phase === 'freeBridges') return this.world.setTargets('edge', legalBridges(s, this.me), color, pick);
    if (v.phase === 'main' && this.mode) {
      if (this.mode === 'bridge') return this.world.setTargets('edge', legalBridges(s, this.me), color, pick);
      if (this.mode === 'outpost') return this.world.setTargets('vertex', legalOutposts(s, this.me), color, pick);
      return this.world.setTargets('vertex', legalUpgrades(s, this.me), '#ffe066', pick);
    }
    this.world.setTargets(null, [], color, null);
  }

  private renderTop(v: GameView) {
    const chip = (p: ViewPlayer, i: number) => `
      <div class="pchip ${i === v.current && v.phase !== 'over' ? 'active' : ''} ${i === this.me ? 'me' : ''}" data-player="${i}" style="--pc:${p.color}">
        <div class="pname">${esc(p.name)}${p.bot ? ' <small>🤖</small>' : ''}${p.connected ? '' : ' <small title="Away">💤</small>'}</div>
        <div class="pstats">
          <span title="Resource cards">🂠${p.cardCount}</span>
          <span title="Charters">📜${p.charterCount}</span>
          <span title="Knights played" class="${v.fleetHolder === i ? 'held' : ''}">⚔️${p.knights}</span>
          <span title="Longest bridge" class="${v.longestHolder === i ? 'held' : ''}">🌉${p.longest}</span>
        </div>
        <div class="glory" title="Glory">★${p.glory}</div>
      </div>`;
    const hidden = performance.now() < this.revealAt;
    const dice = v.dice ?? [0, 0];
    this.els.top.innerHTML = `
      <div class="players">${v.players.map(chip).join('')}</div>
      <div class="top-right">
        <div class="dice ${v.dice && !hidden ? '' : 'idle'}">${v.dice && !hidden ? dieHtml(dice[0]) + dieHtml(dice[1]) : dieHtml(6) + dieHtml(6)}</div>
        <button class="icon-btn" data-act="modal" data-arg="menu" title="Menu">☰</button>
      </div>`;
  }

  private renderBanner(v: GameView) {
    let text = '';
    const cur = v.players[v.current];
    if (v.phase === 'over') text = `🏆 ${v.winner === this.me ? 'You win!' : esc(v.players[v.winner!].name) + ' wins!'}`;
    else if (v.phase === 'discard') {
      text = v.discards[this.me] > 0 ? `A 7! Discard ${v.discards[this.me]} cards` : 'Waiting for players to discard…';
    } else if (!this.myTurn) {
      text = `${esc(cur.name)} ${v.phase === 'setup' ? 'is placing' : v.phase === 'pirate' ? 'is moving the pirate' : 'is playing'}…`;
    } else if (v.phase === 'setup') {
      text = v.lastOutpost === null ? `Place your ${v.setupStep >= v.players.length ? 'second' : 'first'} outpost` : 'Place a bridge next to it';
    } else if (v.phase === 'roll') text = 'Your turn — roll the dice';
    else if (v.phase === 'pirate') text = 'Move the sky pirate: tap an island';
    else if (v.phase === 'freeBridges') text = `Place ${v.freeBridges} free bridge${v.freeBridges > 1 ? 's' : ''}`;
    else if (this.mode) text = `Tap a glowing spot to build ${this.mode === 'outpost' ? 'an outpost' : this.mode === 'citadel' ? 'a citadel' : 'a bridge'}`;
    else text = 'Build, trade, or end your turn';
    this.els.banner.innerHTML = `<span>${text}</span>`;
    this.els.banner.classList.toggle('mine', this.myTurn);
  }

  private renderLog(v: GameView) {
    const lines = v.log
      .map((e) => describe(e.ev, (i) => this.name(i), this.me))
      .filter((l): l is string => !!l)
      .slice(-40);
    this.els.log.classList.toggle('open', this.logOpen);
    this.els.log.innerHTML = `
      <button class="log-toggle" data-act="log">${this.logOpen ? '✕' : '📜'} Log</button>
      <div class="log-lines">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
    const box = this.els.log.querySelector('.log-lines');
    if (box) box.scrollTop = box.scrollHeight;
  }

  private renderBottom(v: GameView) {
    const me = v.players[this.me];
    if (!me) { this.els.bottom.innerHTML = '<div class="actions"><span class="wait">Spectating</span></div>'; return; }
    const hand = this.hand;
    const s = this.asState();
    const cards = RESOURCES.map((r) => {
      const bump = this.bumps.get(r);
      return `
      <div class="card res-${r} ${hand[r] ? '' : 'zero'} ${bump ? 'bump' : ''}" title="${RES_NAME[r]}">
        <div class="ico">${RES_ICON[r]}</div><div class="n">${hand[r]}</div>${bump ? `<span class="plus">+${bump}</span>` : ''}
      </div>`;
    }).join('');
    this.bumps.clear();
    const charterN = (me.charters?.length ?? 0) + (me.newCharters?.length ?? 0);

    let actions = '';
    const incoming = v.trade && v.trade.from !== this.me && v.phase === 'main';
    if (incoming) {
      const t = v.trade!;
      const answered = t.responses[this.me];
      actions = `<div class="offer-in">
        <div>${this.name(t.from)} offers <b>${resList(t.give)}</b> for <b>${resList(t.want)}</b></div>
        ${answered === null
          ? `<button class="btn good" data-act="respond" data-arg="yes" ${canAfford(hand, t.want) ? '' : 'disabled'}>Accept</button>
             <button class="btn" data-act="respond" data-arg="no">Decline</button>`
          : `<span class="wait">${answered ? 'You accepted — waiting…' : 'You declined'}</span>`}
      </div>`;
    } else if (v.phase === 'over') {
      actions = `<button class="btn primary" data-act="exit">${this.conn.online ? 'Continue' : 'Main menu'}</button>`;
    } else if (this.myTurn && v.phase === 'roll') {
      actions = `<button class="btn primary big" data-act="roll">🎲 Roll</button>${charterN ? `<button class="btn" data-act="modal" data-arg="charters">📜 Charters</button>` : ''}`;
    } else if (this.myTurn && v.phase === 'main') {
      const c = countPieces(s, this.me);
      const b = (kind: 'bridge' | 'outpost' | 'citadel', icon: string, label: string, can: boolean) =>
        `<button class="btn build ${this.mode === kind ? 'on' : ''}" data-act="build" data-arg="${kind}" ${can ? '' : 'disabled'}>
          <span class="bi">${icon}</span><span class="bl">${label}</span><span class="cost">${costHtml(COSTS[kind])}</span></button>`;
      actions = `
        ${b('bridge', '🌉', 'Bridge', canAfford(hand, COSTS.bridge) && c.bridges < LIMITS.bridge && legalBridges(s, this.me).length > 0)}
        ${b('outpost', '🏠', 'Outpost', canAfford(hand, COSTS.outpost) && c.outposts < LIMITS.outpost && legalOutposts(s, this.me).length > 0)}
        ${b('citadel', '🏰', 'Citadel', canAfford(hand, COSTS.citadel) && c.citadels < LIMITS.citadel && c.outposts > 0)}
        <button class="btn build" data-act="buyCharter" ${canAfford(hand, COSTS.charter) && v.deckCount > 0 ? '' : 'disabled'}>
          <span class="bi">📜</span><span class="bl">Charter</span><span class="cost">${costHtml(COSTS.charter)}</span></button>
        <span class="sep"></span>
        <button class="btn" data-act="modal" data-arg="trade">🔁 Trade</button>
        <button class="btn" data-act="modal" data-arg="charters">📜 ${charterN}</button>
        <button class="btn end" data-act="end">End turn ⏭</button>`;
    } else if (this.myTurn) {
      actions = `<span class="wait">${v.phase === 'pirate' ? '☠️ Tap an island for the pirate' : v.phase === 'freeBridges' ? '🌉 Tap where to build' : v.phase === 'setup' ? 'Tap a glowing spot' : ''}</span>`;
    } else {
      actions = `<span class="wait">Waiting for ${esc(v.players[v.current].name)}…</span>${charterN ? `<button class="btn" data-act="modal" data-arg="charters">📜 ${charterN}</button>` : ''}`;
    }

    this.els.bottom.innerHTML = `<div class="hand">${cards}</div><div class="actions">${actions}</div>`;
  }

  private renderModal(v: GameView) {
    let html = '';
    const hand = this.hand;
    const me = v.players[this.me];
    const box = (title: string, body: string, closable = true) =>
      `<div class="modal"><div class="modal-head"><h3>${title}</h3>${closable ? '<button class="icon-btn" data-act="close">✕</button>' : ''}</div>${body}</div>`;

    if (v.phase === 'discard' && v.discards[this.me] > 0) {
      const need = v.discards[this.me];
      const n = resTotal(this.discard);
      html = box(`Discard ${need} cards`, `
        <p class="muted">The pirate rolled in. You hold more than 7 cards.</p>
        <div class="rows">${RESOURCES.map((r) => `
          <div class="row"><span class="ri">${RES_ICON[r]} ${RES_NAME[r]} <small>(${hand[r]})</small></span>
            <button class="step" data-act="disc" data-arg="${r}:-1">−</button><b>${this.discard[r]}</b>
            <button class="step" data-act="disc" data-arg="${r}:1">+</button></div>`).join('')}</div>
        <button class="btn primary wide" data-act="discardGo" ${n === need ? '' : 'disabled'}>Discard ${n}/${need}</button>`, false);
    } else if (this.modal === 'victim') {
      html = box('Steal from…', `<div class="choices">${this.victims(this.pirateHex).map((p) => `
        <button class="btn" data-act="victim" data-arg="${p}" style="--pc:${v.players[p].color}">${esc(v.players[p].name)} <small>🂠${v.players[p].cardCount}</small></button>`).join('')}</div>`, false);
    } else if (this.modal === 'pick' && this.pickCtx) {
      const ctx = this.pickCtx;
      const title = ctx.kind === 'plenty' ? `Pick resource ${ctx.picked.length + 1} of 2` : 'Take all of which resource?';
      html = box(title, `<div class="choices res">${RESOURCES.map((r) => `
        <button class="btn" data-act="pickRes" data-arg="${r}" ${ctx.kind === 'plenty' && v.bank[r] - ctx.picked.filter((x) => x === r).length <= 0 ? 'disabled' : ''}>${RES_ICON[r]}<small>${RES_NAME[r]}</small></button>`).join('')}</div>`);
    } else if (this.modal === 'charters' && me) {
      const canPlay = this.myTurn && (v.phase === 'roll' || v.phase === 'main') && !v.charterPlayed;
      const list = [
        ...(me.charters ?? []).map((k) => ({ k, fresh: false })),
        ...(me.newCharters ?? []).map((k) => ({ k, fresh: true })),
      ];
      html = box('Your charters', list.length ? `<div class="charters">${list.map(({ k, fresh }) => `
        <div class="charter"><div class="ci">${CHARTERS[k].icon}</div>
          <div><b>${CHARTERS[k].name}</b><p>${CHARTERS[k].text}</p></div>
          ${k === 'glory' ? '<span class="tag">Counts automatically</span>'
            : fresh ? '<span class="tag">Next turn</span>'
            : `<button class="btn primary" data-act="play" data-arg="${k}" ${canPlay ? '' : 'disabled'}>Play</button>`}
        </div>`).join('')}</div>${v.charterPlayed ? '<p class="muted">You already played a charter this turn.</p>' : ''}`
        : '<p class="muted">No charters yet. Buy one for 🌾 ☁️ 💎.</p>');
    } else if (this.modal === 'trade') {
      const s = this.asState();
      const t = v.trade?.from === this.me ? v.trade : null;
      const ratio = (r: Resource) => tradeRatio(s, this.me, r);
      const bank = `
        <h4>Bank</h4>
        <div class="bank">
          <div class="lbl">Give</div>
          <div class="choices res sm">${RESOURCES.map((r) => `<button class="btn ${this.bankGive === r ? 'on' : ''}" data-act="bankGive" data-arg="${r}" ${hand[r] >= ratio(r) ? '' : 'disabled'}>${ratio(r)}${RES_ICON[r]}</button>`).join('')}</div>
          <div class="lbl">Get</div>
          <div class="choices res sm">${RESOURCES.map((r) => `<button class="btn ${this.bankGet === r ? 'on' : ''}" data-act="bankGet" data-arg="${r}" ${v.bank[r] > 0 && r !== this.bankGive ? '' : 'disabled'}>1${RES_ICON[r]}</button>`).join('')}</div>
          <button class="btn primary wide" data-act="bankGo" ${this.bankGive && this.bankGet && this.bankGive !== this.bankGet && hand[this.bankGive] >= ratio(this.bankGive) ? '' : 'disabled'}>Trade with bank</button>
        </div>`;
      const players = t
        ? `<h4>Your offer: ${resList(t.give)} → ${resList(t.want)}</h4>
           <div class="responses">${v.players.map((p, i) => i === this.me ? '' : `
             <div class="resp"><span style="color:${p.color}">${esc(p.name)}</span>
               ${t.responses[i] === null ? '<span class="muted">thinking…</span>' : t.responses[i] ? `<button class="btn good" data-act="confirm" data-arg="${i}">Trade ✓</button>` : '<span class="muted">declined</span>'}
             </div>`).join('')}</div>
           <button class="btn wide" data-act="offerCancel">Cancel offer</button>`
        : `<h4>Players</h4>
           <div class="rows offer">${RESOURCES.map((r) => `
             <div class="row"><span class="ri">${RES_ICON[r]}</span>
               <span class="lbl">give</span><button class="step" data-act="off" data-arg="give:${r}:-1">−</button><b>${this.offer.give[r]}</b><button class="step" data-act="off" data-arg="give:${r}:1">+</button>
               <span class="lbl">get</span><button class="step" data-act="off" data-arg="want:${r}:-1">−</button><b>${this.offer.want[r]}</b><button class="step" data-act="off" data-arg="want:${r}:1">+</button>
             </div>`).join('')}</div>
           <button class="btn primary wide" data-act="offerGo" ${resTotal(this.offer.give) && resTotal(this.offer.want) ? '' : 'disabled'}>Offer to everyone</button>`;
      html = box('Trade', `<div class="trade">${bank}<div class="divider"></div>${players}</div>`);
    } else if (this.modal === 'menu') {
      html = box('Menu', `
        <div class="choices col">
          <button class="btn" data-act="mute">${sfx.muted ? '🔇 Sound effects: off' : '🔊 Sound effects: on'}</button>
          <button class="btn" data-act="music">${music.on ? '🎵 Music: on' : '🎵 Music: off'}</button>
          <button class="btn" data-act="close">▶ Back to game</button>
          <button class="btn bad" data-act="exit">Leave game</button>
        </div>
        <details class="rules"><summary>Quick rules</summary>
          <p>Roll each turn: islands with that number pay their resource to every outpost (1) and citadel (2) on their corners.</p>
          <p>🌉 Bridge ${costHtml(COSTS.bridge)} · 🏠 Outpost ${costHtml(COSTS.outpost)} · 🏰 Citadel ${costHtml(COSTS.citadel)} · 📜 Charter ${costHtml(COSTS.charter)}</p>
          <p>Outposts need a gap of one corner from any other building and must touch your bridge. A 7 brings the sky pirate: anyone with 8+ cards discards half, and the roller blocks an island and steals a card.</p>
          <p>Trade 4:1 with the bank, 3:1 or 2:1 at a dock you have built on. Longest Sky-Bridge (5+) and Largest Fleet (3+ knights) are worth 2 Glory each. First to ${v.options.target} Glory wins.</p>
        </details>`);
    } else if (v.phase === 'over' && performance.now() >= this.overAt) {
      const order = v.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.glory - a.p.glory);
      const maxRoll = Math.max(1, ...v.rolls);
      html = box(v.winner === this.me ? '🏆 Victory!' : `🏆 ${esc(v.players[v.winner!].name)} wins`, `
        <div class="results">${order.map(({ p, i }) => `
          <div class="res-row ${i === v.winner ? 'win' : ''}"><span style="color:${p.color}">${esc(p.name)}</span><b>★${p.glory}</b></div>`).join('')}</div>
        <h4>Dice rolls</h4>
        <div class="hist">${v.rolls.slice(2).map((n, i) => `<div><i style="height:${(n / maxRoll) * 100}%"></i><span>${i + 2}</span></div>`).join('')}</div>
        <button class="btn primary wide" data-act="exit">${this.conn.online ? 'Back to lobby' : 'Main menu'}</button>`, false);
    }
    // Only animate a window when it first opens; redrawing the same window must not replay the pop.
    const key = html ? (html.match(/<h3>(.*?)<\/h3>/)?.[1] ?? 'modal') : '';
    this.els.modal.innerHTML = html;
    if (html && key === this.modalKey) this.els.modal.querySelector('.modal')?.classList.add('still');
    this.modalKey = key;
    this.els.modal.classList.toggle('show', !!html);
  }
}
