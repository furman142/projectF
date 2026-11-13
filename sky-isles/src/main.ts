import './style.css';
import { World } from './scene/world.ts';
import { Hud } from './ui/hud.ts';
import { LocalConn, NetConn, loadSeat, type Conn } from './conn.ts';
import { generateBoard } from '../shared/board.ts';
import { PLAYER_COLORS, type Options } from '../shared/types.ts';
import type { LobbyInfo } from '../shared/protocol.ts';
import { esc } from './ui/text.ts';
import { sfx } from './ui/sound.ts';

const world = new World(document.getElementById('scene') as HTMLCanvasElement);
const hudEl = document.getElementById('hud')!;
const overlay = document.getElementById('overlay')!;

let conn: Conn | null = null;
let hud: Hud | null = null;

const BOT_NAMES = ['Captain Gale', 'Admiral Nimbus', 'Skipper Zephyr'];

function store(key: string, value?: string): string {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key) ?? '';
  } catch {
    return value ?? '';
  }
}

function showOverlay(html: string) {
  overlay.innerHTML = `<div class="screen">${html}</div>`;
  overlay.classList.add('show');
}
function hideOverlay() {
  overlay.classList.remove('show');
  overlay.innerHTML = '';
}

function backdrop() {
  world.setBoard(generateBoard({ rng: (Math.random() * 1e9) | 0 }));
  world.controls.autoRotate = true;
  world.controls.autoRotateSpeed = 0.6;
}

function title(message = '') {
  hud?.destroy();
  hud = null;
  conn?.close();
  conn = null;
  backdrop();
  const name = store('sky-name') || 'Player';
  const room = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  showOverlay(`
    <div class="logo"><span>Sky</span> Isles</div>
    <p class="tagline">Settle floating islands. Gather, trade and build your way to glory.</p>
    ${message ? `<p class="notice">${esc(message)}</p>` : ''}
    <label class="field">Your name<input id="name" maxlength="16" value="${esc(name)}" autocomplete="nickname"></label>
    <div class="panel">
      <h3>Play vs bots</h3>
      <div class="opts">
        <label>Players <select id="count"><option value="2">2</option><option value="3">3</option><option value="4" selected>4</option></select></label>
        <label>Glory to win <select id="target"><option>8</option><option selected>10</option><option>12</option></select></label>
        <label class="check"><input type="checkbox" id="friendly"> Friendly pirate</label>
      </div>
      <button class="btn primary big wide" id="local">▶ Play now</button>
    </div>
    <div class="panel">
      <h3>Play online with friends</h3>
      <button class="btn primary wide" id="create">Create a room</button>
      <div class="join">
        <input id="code" maxlength="4" placeholder="CODE" value="${esc(room)}" autocapitalize="characters">
        <button class="btn" id="join">Join</button>
      </div>
    </div>
    <p class="fine">Tip: drag to rotate the islands, pinch or scroll to zoom.</p>`);

  const val = (id: string) => (overlay.querySelector(`#${id}`) as HTMLInputElement).value;
  const getName = () => store('sky-name', val('name').trim().slice(0, 16) || 'Player');
  overlay.querySelector('#local')!.addEventListener('click', () => {
    sfx.click();
    const n = Number(val('count'));
    const players = [{ name: getName(), color: PLAYER_COLORS[0], bot: false }];
    for (let i = 1; i < n; i++) players.push({ name: BOT_NAMES[i - 1], color: PLAYER_COLORS[i], bot: true });
    const options: Partial<Options> = { target: Number(val('target')), friendlyPirate: (overlay.querySelector('#friendly') as HTMLInputElement).checked };
    const local = new LocalConn(players, options);
    startGame(local);
    local.start();
  });
  overlay.querySelector('#create')!.addEventListener('click', () => { sfx.click(); online(new NetConn({ t: 'create', name: getName() })); });
  const join = () => {
    const code = val('code').trim().toUpperCase();
    if (code.length !== 4) return;
    sfx.click();
    const saved = loadSeat(code);
    online(new NetConn({ t: 'join', code, name: getName(), token: saved?.token }));
  };
  overlay.querySelector('#join')!.addEventListener('click', join);
  overlay.querySelector('#code')!.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && join());
}

function startGame(c: Conn) {
  hideOverlay();
  world.controls.autoRotate = false;
  conn = c;
  hud = new Hud(hudEl, world, c, (gameOver) => {
    // The online host takes everyone back to the lobby for a rematch.
    if (gameOver && c instanceof NetConn && c.lastLobby && c.lastLobby.host === c.lastLobby.you) {
      c.msg({ t: 'toLobby' });
      return;
    }
    title();
  });
}

function online(net: NetConn) {
  conn = net;
  showOverlay('<div class="logo small"><span>Sky</span> Isles</div><p class="tagline">Connecting…</p>');
  net.onError = (msg, fatal) => {
    if (fatal) title(msg);
    else if (!hud) overlay.querySelector('.notice')?.replaceChildren(msg);
  };
  net.onStatus = (ok) => document.body.classList.toggle('offline', !ok);
  // The first view of a game creates the HUD, which then takes over net.onView.
  const boot = (v: Parameters<NetConn['onView']>[0]) => {
    startGame(net);
    net.onView(v);
  };
  net.onLobby = (l) => {
    net.lastLobby = l;
    if (!l.started) {
      if (hud) { hud.destroy(); hud = null; }
      net.onView = boot;
      lobby(net, l);
    }
  };
  net.onView = boot;
}

function lobby(net: NetConn, l: LobbyInfo) {
  backdrop();
  const isHost = l.host === l.you;
  const link = `${location.origin}${location.pathname}?room=${l.code}`;
  showOverlay(`
    <div class="logo small"><span>Sky</span> Isles</div>
    <div class="panel">
      <h3>Room code</h3>
      <div class="code">${esc(l.code)}</div>
      <button class="btn wide" id="copy">🔗 Copy invite link</button>
    </div>
    <div class="panel">
      <h3>Players (${l.seats.length}/4)</h3>
      <div class="seats">${l.seats.map((s, i) => `
        <div class="seat" style="--pc:${s.color}">
          <i></i><span>${esc(s.name)}${s.bot ? ' 🤖' : ''}${i === l.host ? ' 👑' : ''}${i === l.you ? ' (you)' : ''}${s.connected ? '' : ' 💤'}</span>
          ${isHost && i !== l.you ? `<button class="icon-btn" data-kick="${i}" title="Remove">✕</button>` : ''}
        </div>`).join('')}</div>
      ${isHost && l.seats.length < 4 ? '<button class="btn wide" id="bot">+ Add bot</button>' : ''}
    </div>
    <div class="panel">
      <h3>Rules</h3>
      <div class="opts">
        <label>Glory to win <select id="target" ${isHost ? '' : 'disabled'}>${[8, 10, 12].map((n) => `<option ${n === l.options.target ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" id="friendly" ${l.options.friendlyPirate ? 'checked' : ''} ${isHost ? '' : 'disabled'}> Friendly pirate</label>
      </div>
    </div>
    <p class="notice"></p>
    ${isHost
      ? `<button class="btn primary big wide" id="start" ${l.seats.length >= 2 ? '' : 'disabled'}>▶ Start game</button>`
      : '<p class="tagline">Waiting for the host to start…</p>'}
    <button class="btn wide ghost" id="leave">Leave room</button>`);

  const q = (s: string) => overlay.querySelector(s);
  q('#copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); q('#copy')!.textContent = '✓ Link copied'; } catch { prompt('Share this link', link); }
  });
  q('#bot')?.addEventListener('click', () => net.msg({ t: 'addBot' }));
  q('#start')?.addEventListener('click', () => net.msg({ t: 'start' }));
  q('#leave')?.addEventListener('click', () => title());
  q('#target')?.addEventListener('change', (e) => net.msg({ t: 'options', options: { target: Number((e.target as HTMLSelectElement).value) } }));
  q('#friendly')?.addEventListener('change', (e) => net.msg({ t: 'options', options: { friendlyPirate: (e.target as HTMLInputElement).checked } }));
  overlay.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) => b.addEventListener('click', () => net.msg({ t: 'kick', seat: Number(b.dataset.kick) })));
}

const room = new URLSearchParams(location.search).get('room');
const saved = room ? loadSeat(room.toUpperCase()) : null;
if (room && saved) online(new NetConn({ t: 'join', code: room.toUpperCase(), name: saved.name, token: saved.token }));
else title();

// Test hook: ?debug exposes internals for automated browser checks.
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { sky: { world, get hud() { return hud; } } });
