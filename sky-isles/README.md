# Sky Isles

A 3D online strategy game for 2–4 players in the browser (desktop and phone).
Settle floating islands, gather resources when the dice roll, trade, and build to 10 Glory first.

## Run it

```bash
cd sky-isles
npm install
npm run dev      # game server (port 8787) + Vite client with hot reload
```

Open the `Local` or `Network` address Vite prints. Phones on the same Wi-Fi can use the `Network` address.

```bash
npm test         # rules engine tests (includes full bot-vs-bot games)
npm run build    # type-check and build the client into dist/
npm start        # production: one process serves dist/ and the WebSocket on $PORT (default 8787)
```

## Playing

- **Play vs bots:** works fully offline in the browser. Pick 2–4 players.
- **Online:** "Create a room" gives a 4-letter code and an invite link. Friends join with the code, the host can add bots, then starts. If you reload or lose connection you get your seat back; while you're away a bot plays for you.

### Rules in short

| Piece | Cost | Glory |
|---|---|---|
| 🌉 Bridge | 🪵 🧱 | — |
| 🏠 Outpost | 🪵 🧱 ☁️ 🌾 | 1 |
| 🏰 Citadel (upgrade an outpost) | 🌾🌾 💎💎💎 | 2 |
| 📜 Charter | ☁️ 🌾 💎 | hidden card |

- Each turn: roll 2 dice. Every island with that number pays 1 resource to each outpost and 2 to each citadel on its corners.
- Rolling a 7: everyone holding 8+ cards discards half, then the roller moves the sky pirate (it blocks an island) and steals a card.
- Outposts need one empty corner between them and any other building, and (after setup) must touch your bridge.
- Trade with players, with the bank at 4:1, or at docks you've built on (3:1 or 2:1).
- Charters: Sky Knight ×14, Glory ×5, Bridge Builders ×2, Bountiful Winds ×2, Monopoly ×2. One per turn, not on the turn you buy it.
- Longest Sky-Bridge (5+ in a chain) and Largest Fleet (3+ knights) are worth 2 Glory each.

## Code layout

```
shared/   rules engine (pure TypeScript, used by browser and server), bots, per-player views, game host
server/   Node + ws: rooms, seats, reconnect tokens, static file serving
src/      three.js scene (src/scene) and DOM HUD (src/ui)
tests/    Vitest tests for the engine
```

The server is authoritative: clients send actions, the server checks them with the same engine and sends each player only what they may see (other hands, the charter deck and the RNG stay hidden).

## Deploy

Any Node host that supports WebSockets (Render, Fly.io, Railway): build command `npm install && npm run build`, start command `npm start`. Rooms live in memory, so a restart ends running games.
