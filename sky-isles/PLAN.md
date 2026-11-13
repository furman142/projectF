# Sky Isles — Game Plan

A 3D online multiplayer strategy game for 2–4 players, built for the browser and phones.
Players settle floating islands, gather resources on dice rolls, trade, and build toward 10 Glory points.
It uses the hex-board, dice and trading mechanics of the genre, with its own theme, names, rules details and art.

## 1. Theme and names

| Concept | Sky Isles name | Notes |
|---|---|---|
| Board | The Archipelago: 19 hex islands floating in clouds | Ring of cloud-sea around it, with 9 sky-docks |
| Resources | Timber, Clay, Fiber (cloud-cotton), Grain, Crystal | Each island type makes one |
| Barren tile | Storm Isle | Produces nothing, where the pirate starts |
| Road | Bridge | Rope bridge along a hex edge |
| Settlement | Outpost | 1 Glory |
| City | Citadel | Upgrade of an Outpost, 2 Glory, produces 2 |
| Thief | Sky Pirate airship | Blocks an island, steals 1 card |
| Development cards | Charters | Drawn face down from a deck |
| Ports | Sky-docks | 3:1 generic or 2:1 for one resource |

## 2. Rules (v1)

- **Board:** 19 islands (4 Timber, 3 Clay, 4 Fiber, 4 Grain, 3 Crystal, 1 Storm). Number tokens 2–12 (no 7) are placed by a seeded shuffle, and two red numbers (6 and 8) may never be neighbours. Option for a fixed "beginner" layout.
- **Setup:** players place 1 Outpost + 1 Bridge each in snake order (1→4, then 4→1). The second Outpost pays out one of each adjacent resource.
- **Turn:** roll 2d6 → produce → trade → build/play one Charter → end turn.
- **Production:** every island whose number was rolled pays 1 per adjacent Outpost and 2 per Citadel, unless the Sky Pirate is on it. If the bank runs short of a resource, nobody gets that resource.
- **Rolling 7:** anyone holding more than 7 cards discards half (rounded down). The roller moves the Sky Pirate and steals 1 random card from a player on that island.
- **Building costs:**
  - Bridge: Timber + Clay
  - Outpost: Timber + Clay + Fiber + Grain
  - Citadel: 2 Grain + 3 Crystal
  - Charter: Fiber + Grain + Crystal
- **Placement:** Outposts must be at least 2 edges from any other Outpost (distance rule) and, after setup, touch your own Bridge.
- **Trade:** offer to players (counter-offers, accept/decline), bank 4:1, docks 3:1 / 2:1.
- **Charters (25):** 14 Sky Knight (move the pirate, counts toward Largest Fleet), 5 Glory (+1 hidden point), 2 Bridge Builders (2 free bridges), 2 Bountiful Winds (take any 2 resources), 2 Monopoly (everyone gives you all of one resource). You can't play a Charter on the turn you bought it.
- **Bonuses:** Longest Sky-Bridge (5+ connected bridges) +2, Largest Fleet (3+ Knights played) +2.
- **Win:** reach 10 Glory on your own turn.
- **Room options:** victory points (8/10/12), friendly pirate (can't target players with ≤2 Glory), turn timer (off/60s/90s), bots fill empty seats.

## 3. Architecture

```
sky-isles/
  shared/          Pure TypeScript rules engine, no DOM or Node. Used by the server and the client.
    types.ts       GameState, Action, PlayerView
    board.ts       Hex grid (axial coords), vertices/edges, board generation
    rules.ts       Legality checks: placement, costs, trades
    engine.ts      reduce(state, action) → state | error, seeded RNG (mulberry32)
    longest.ts     Longest bridge path (DFS), with opponent outposts blocking the path
    view.ts        Hides other players' private info (hand contents, Charters)
    bot.ts         Simple AI: weighted placement and greedy builds
  server/          Node + ws. Authoritative: clients send intents, the server validates them with shared/engine
    index.ts       HTTP (serves dist/ in prod) + WebSocket at /ws
    rooms.ts       Room codes (5 letters), seats, host, options, lobby → game lifecycle
    protocol.ts    Message types (zod-free, hand-written guards)
  src/             Vite + three.js client
    net.ts         WebSocket client with auto-reconnect and a session token in localStorage
    scene/         three.js: islands, clouds, pieces, picking, camera, animations
    ui/            DOM HUD: hand, build bar, trade dialog, log, lobby screens
  tests/           Vitest: engine, board generation, longest path, protocol round-trip
```

**Online model**
- The server holds the only true `GameState`. The client sends `{type:'action', action}`. The server runs `reduce`, and on success broadcasts each player a filtered `PlayerView` plus an event list (for animations).
- Reconnect: on join, the server issues a `seatToken`. The client stores it, and on reconnect it gets its seat and the latest view back. A seat with nobody connected for 60s during a game is played by a bot until the player returns.
- Dice and shuffles use a seeded RNG on the server only, so clients can't predict them.
- Rooms live in memory (v1). Idle rooms are removed after 30 min.

## 4. 3D look (three.js, original art, no textures needed)

- Each island is a low-poly hex prism with a rocky underside (an extruded cone with jittered vertices) floating in a sky gradient with drifting cloud sprites. Islands bob slightly.
- Tile decorations built from primitives: Timber = cone trees, Clay = terracotta mounds, Fiber = puffy cloud-cotton bushes, Grain = golden striped fields, Crystal = glowing octahedrons, Storm = dark island with flickering lightning.
- Number tokens are discs that float above each island and always face the camera. 6 and 8 in red.
- Pieces: Bridge = plank strip with posts, Outpost = little house with a flag, Citadel = tower with a dome. Each is tinted in the player's colour.
- Sky Pirate: a small balloon airship that flies between islands.
- Interaction: OrbitControls (limited tilt, pinch zoom on mobile). Legal spots glow as ghost pieces when you pick a build. Raycast to place.
- Effects: 3D dice tumble on roll, resource cards fly from the island to the hand, a confetti burst on win.
- Performance target: 60fps on a mid-range phone. Use instanced meshes for trees/props, one directional light + hemisphere light, soft shadows only on desktop.

## 5. Milestones

Each milestone ends with `npm test` and `npm run build` passing, then a commit.

1. **Engine core** — hex grid, board generation with the 6/8 rule, setup phase, rolling, production, building with costs and distance rule, end turn. Tests for each.
2. **Engine complete** — 7s (discard, pirate, steal), bank/dock trade, player trade offers, Charters, Longest Bridge, Largest Fleet, win check, `view.ts` filtering. Tests, including a full random bot-vs-bot game that must always end.
3. **Hot-seat 3D client** — three.js scene, board render, picking, build bar, hand, log. Plays fully offline against bots (no server) to validate the look and feel early.
4. **Server + lobby** — rooms, join by code or link, seat colours/names, host options, start game, broadcast views. Reconnect with seat tokens.
5. **Online play** — client switches to server mode. Trade dialog across players, turn timer, bot takeover for disconnected seats.
6. **Polish** — dice animation, card fly animation, sounds (WebAudio synth, like the Joker game), mobile layout, end screen with stats (most-rolled numbers, resources gathered).
7. **Deploy** — the server serves `dist/` + `/ws` from one process. Deploy to Render/Fly/Railway (free tier). README with play instructions.

## 6. Current status

- Done: `sky-isles/` folder with package.json (three, ws, tsx, vite, vitest), tsconfig, vite config (proxies `/ws` to the server on port 8787), index.html shell, favicon.
- Next: milestone 1 — write `shared/types.ts`, `shared/board.ts`, `shared/engine.ts` and their tests.

## 7. Commands

```bash
cd sky-isles
npm install
npm run dev      # server (8787) + vite client together
npm test
npm run build
npm start        # production: one process serves the client and WebSocket
```
