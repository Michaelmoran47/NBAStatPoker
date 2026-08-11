# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NBA Stat Poker: a poker-style betting game where each player's "hole cards" are two NBA
legends' career stat lines. Each round reveals one community stat category; players bet,
then whoever has the higher combined stat wins that round's pot. The goal is to make as much money as possible before the 5 rounds are up.

If after a round any player's bank equals zero, that player's cards should be removed and they become a spectator.  
If only one player's bank is greater than zero the game is over and that player wins.

Opponents cards should not be revealed until the end of all 5 rounds.

Ships as a solo vs.-CPU game and, as of the most
recent commits, a real-time multiplayer mode (accounts, lobby, live server-authoritative
matches) built on top of the exact same game engine.

## Commands

Run everything from the repo root unless noted.

```bash
# Install server deps (only needed once, or after server/package.json changes)
cd server && npm install

# Run the server (serves the static site AND the /api + WebSocket layer) at :5500
node server/server.js
# or, from inside server/:
npm start
```

There is no build step for the client — `js/`, `auth/`, `lobby/` are plain ES modules
loaded directly via `<script type="module">`; just open a page through the server (not
`file://`, since `/api` calls need a real origin) or reload the page. `index.html` is
now a plain mode-select landing page (Play Bots / Play Online); the solo game itself
lives at `solo.html`, and multiplayer at `lobby/lobby.html` (which redirects to
`auth/login.html` if you're not signed in).

Type-checking (JSDoc + `checkJs`, no TypeScript compilation actually happens):
```bash
npx --yes --package=typescript -- tsc -p jsconfig.json          # client (js/, auth/, lobby/)
npx --yes --package=typescript -- tsc -p server/jsconfig.json   # server
```

There is no test suite and no linter configured in this repo.

Server config is via `server/.env` (copy from `server/.env.example`): `SESSION_SECRET`
and optional `GOOGLE_CLIENT_ID` for "Sign in with Google". Without `SESSION_SECRET` set,
the server generates a random one at boot and everyone gets logged out on restart —
fine for local dev, not for a real deployment. SQLite data lives at `server/data/app.db`
(gitignored, created automatically on first run).

## Architecture

### The core rule: one game engine, two front ends

`js/state.js`, `js/betting.js`, `js/engine.js`, and `js/scoring.js` contain the entire
game engine and are **DOM-free and hold no module-level mutable state** — every function
takes the `GameState` it operates on explicitly. This is what lets the exact same
functions run:
- a **local single-player game** (`js/ui.js` owns one `GameState`, drives it with button
  clicks), and
- a **multiplayer server room** (`server/game-rooms.js` owns one `GameState` per room,
  drives it with WebSocket messages)

without forking the logic. When changing game rules or betting behavior, edit these
four files only — never add DOM access or a module-level singleton to them, and never
duplicate logic into `server/game-rooms.js` instead of importing from `js/`.

The two integration points every driver (solo client or server room) must supply:
- **`render(actingId?, lastAction?)`** — called after every state change so the driver
  can display it (DOM re-render for solo, `broadcastState` over WebSocket for
  multiplayer). `lastAction` carries a one-shot description (`{playerId, action}`) for
  animations; the engine never touches presentation itself.
- **`requestAction(seatId)`** — a `Promise<BettingAction>` the engine awaits when a
  non-AI seat needs to act. Solo: resolved by a button's `onclick`. Multiplayer: resolved
  when the right authenticated socket sends a `game-action` message (or the reconnect
  grace timer expires and auto-folds them).

`js/state.js`'s `viewFor(G, seatId)` is the one place hidden information (opponents'
hole cards) gets redacted before a `GameState` leaves the process that's authoritative
for it. The solo client never needs it (nothing to hide from yourself); the server must
call it before sending state to any socket, always — see `broadcastState` in
`server/game-rooms.js`.

### Client structure

- `js/data.js` — static reference data (NBA player stat pool, categories). No
  dependencies, safe to import anywhere.
- `js/utils.js` — `shuffle`, `sleep`, `percentile`.
- `js/state.js` — `GameState`/`GamePlayer` shape, `makeGame`/`makeGameFromPlayers`,
  round setup (`startNewGame`, `startRound`), `viewFor`.
- `js/betting.js` — betting-round rules (`applyFold`/`applyCall`/`applyRaise`), the CPU
  decision policy (`aiDecide`), and `bettingRound` (the seat-by-seat action loop).
- `js/scoring.js` — pure hand-scoring (no DOM, no game state, no randomness) — the
  authoritative judge of who wins a category.
- `js/engine.js` — orchestrates a full game: deal → for each round, reveal card → bet →
  resolve winner(s) → repeat.
- `js/ui.js` — the **only** module that touches `document`. Renders everything via
  template-string `innerHTML` rebuilds (no framework), with inline `onclick="..."`
  handlers in the generated HTML. `renderGame(G, actingId, lastAction, mySeatId, mode)`
  is reused verbatim by the multiplayer lobby (`mode: 'solo'` vs `'multiplayer'`).
- `js/main.js` — entry point; bridges the functions `ui.js`'s inline `onclick` HTML
  calls (`startGame`, `humanAction`, etc.) onto `window`, since they need to exist as
  globals for that pattern to work.
- `auth/login.js` — signup/login/logout page (username+password and "Sign in with
  Google"), same template-string render pattern.
- `lobby/lobby.js` — real-time lobby (browse/create/join/ready/start rooms) and, once a
  room starts, the live multiplayer game itself, all over one WebSocket connection — no
  page navigation between lobby and game. Calls `js/ui.js`'s `renderGame()` directly for
  the game view; only where the `GameState` comes from differs from solo play.

### Server structure (`server/`)

Single Express process, one `node server.js`, serving the static site *and* the API/WS
layer from the same HTTP server (needed so the WebSocket upgrade shares the same
session cookie as regular requests — see `sessionMiddleware` reuse in `server.js`).

- `server/db.js` — opens/creates the SQLite DB (`better-sqlite3`) and its tables
  (`users`, `match_results`) as a side effect of import.
- `server/auth.js` — `/api/signup`, `/api/login`, `/api/logout`, `/api/me`,
  `/api/auth/google`. Passwords are bcrypt-hashed before storage; Google-only accounts
  have no `password_hash` and are matched by `google_id` instead. Login compares
  against a hash even for a nonexistent username, to avoid timing-based username
  enumeration.
- `server/rooms.js` — in-memory lobby room registry only (create/join/leave/ready/start
  a room). No game logic — that's `game-rooms.js`, attached once a room actually starts.
- `server/game-rooms.js` — owns the live `GameState` per in-progress room and drives it
  through `js/engine.js`'s `playGame`/`nextRound`, with a `requestAction` backed by
  pending-resolver promises (resolved by `submitAction`) instead of button clicks. Also
  owns the reconnect grace period (`RECONNECT_GRACE_MS`, default 60s): a disconnected
  seat isn't folded immediately, but if the grace timer expires before `markReconnected`
  is called, they're auto-folded for the rest of the match and recorded as a forfeit
  loss regardless of how the match eventually ends.
- `server/ws.js` — the real-time layer: authenticates each socket off the same session
  cookie the rest of the site uses (rejects the upgrade if unauthenticated), then
  dispatches lobby messages (`create-room`/`join-room`/`ready`/`start-room`/etc.) and
  in-game `game-action` messages. **The one trust boundary that matters**: every message
  only ever acts on behalf of `conn.userId`, set once from the authenticated session at
  connection time — never a client-supplied id. A fresh connection checks
  `findLiveRoomForUser` first, so refreshing mid-match resyncs into the game instead of
  dropping the player into the lobby.
- `server/matches.js` — persists match outcomes (`match_results` table) for the future
  leaderboard; `recordForfeit` fires the instant a grace timer expires, and
  `recordMatchResults` (run at the natural end of a match) skips anyone already recorded
  that way so a forfeited seat is never double-counted.
- `server/types.d.ts` — augments `express-session`'s `SessionData` with `userId`/`username`.

### Multiplayer trust model

The server is the sole authority on hidden state and turn order — `viewFor()` redacts
opponents' hole cards before any state reaches a socket, and `ws.js`'s
`parseGameAction` only validates a message is a *well-formed* `BettingAction`; legality
(whose turn it is, affordability) is enforced by the same engine code
(`applyRaise`'s `Math.min(need, chips)` clamp, the pending-resolver map) that governs
solo play — there is no separate "multiplayer rules" implementation to keep in sync.

## Conventions

- Every source file (client and server) starts with `// @ts-check` and is typed via
  JSDoc comments only — there is no `.ts` build step, `jsconfig.json` (root, for
  `js/`/`auth/`/`lobby/`) and `server/jsconfig.json` just drive editor/CI type-checking
  of the `.js` files as-is.
- Comments in this codebase tend to explain *why* a design choice was made (especially
  around what must stay engine-agnostic vs. DOM/network-specific) — match that density
  and intent rather than narrating *what* the next line does.
- No bundler, no framework, no CSS preprocessor — plain ES modules and one stylesheet
  (`css/style.css`).
