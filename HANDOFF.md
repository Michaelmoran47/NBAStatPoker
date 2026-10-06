# Handoff — Quantrivia

Read this first, then `DESIGN.md` (look and navigation rules) and `CLAUDE.md` (code conventions, partly out of date, see below).

## What the game is now

A numeric trivia game, formerly NBA Stat Poker, then NBA Stat Guess. Each match is five questions. Each player types a number and picks a unit (none, hundred, thousand, million, billion, trillion, quadrillion). The guess closest to the answer, as a percent, wins the round, and ties all win. Points are 50 minus 1 per 1% off, never below 0. The match goes to the most round wins, then the most points. Questions come from `js/questions.js`.

Modes:
- **Start game:** ranked matchmaking (rating window ±100, widening 50 every 10s, starts at 6 players or after 45s with at least 2).
- **Play with friends:** the lobby. Create or join a room, ready up, host starts (min 2, max 6).
- **Practice vs CPUs:** solo against two CPU opponents with random names.

ELO (start 1200, K 32) changes only in ranked matches. Lobby matches are casual and show a dash on the standings.

Social: profiles, friends (request, accept, decline, remove), a friends leaderboard, all under `/social/social.html`, built by a subagent and then replaced in the nav by `social/chrome.js`.

## Current state (as of this handoff)

Working and checked:
- Solo play end to end in the browser: question, answer box, unit dropdown, live preview, timer bar, results, final round before standings.
- Ranked match end to end over real sockets, using a scripted client with two test accounts. It passed after a server restart (the earlier failure was a stale server process).
- Engine rules: `node` tests in the scratchpad, see below.
- Client and server type checks pass.

Built but not verified on screen:
- Final standings showing rating changes per player (server sends `eloDeltas` after the match is recorded).
- Signed-in menu flow: `/` routes to sign-in when signed out, and to `js/home.js` menu when signed in. Sign-in redirects to `/`.
- The new top bar, phone tab bar, desktop sidebar, and "How to play" dialog across pages, on a real phone.
- Confetti on the match winner's final standings only.
- Social pages (profile, friends, leaderboard) after the chrome change.

Known issues or gaps:
- **Phone layout is the main unknown.** The sidebar and tab bar were changed several times. Check them on a phone before changing anything else.
- **Question answers are unverified.** `js/questions.js` is from memory of widely cited figures. Some are approximate (Earth-Sun distance, Pacific area, Earth's age). Check every one before release.
- **Recent matches on profiles are friend-only** by design (`canSeeMatches` in `server/social.js`).
- **Leftovers to delete or confirm:** `js/season-rankings.json` and `server/build-season-rankings.py` (NBA data, unused), `mockups/visual-options.html` (design options, superseded by the arcade look).
- **Test accounts in `server/data/app.db`:** `mptest_alpha`, `mptest_bravo`, `social_a`, `social_b`, `social_c`. Remove before release.
- **`CLAUDE.md` is stale.** It still describes the poker game, betting, `js/state.js`, `js/betting.js`, `js/scoring.js`, `js/data.js`, and the old sidebar. Update it.

## Operational notes

- **Restart the server after any change under `server/`.** It doesn't hot-reload. Static files under `js/`, `css/`, `lobby/`, `social/`, `auth/` are read from disk on each request, so those don't need a restart. This caused two false bugs already: a stale round-timing pause and a missing `queue-join` handler.
- Restart on Windows: stop the process listening on 5500, then `Start-Process node -ArgumentList 'server/server.js' -WindowStyle Hidden`.
- The browser pane often can't screenshot after navigation. Use `find` or `read_page` instead.
- Sign-in page can come up empty in the browser pane. Reload before reading it.

## Timing and rule constants (keep client and server matched)

- Guess window: `GUESS_TIME_MS = 18_000` in `server/game-rooms.js`, and `GUESS_TOTAL_MS = 18_000` in `js/ui.js`.
- Round result pause: `ROUND_RESULT_MS = 4500` in `js/engine.js`, and the client timer reads the same constant.
- Pause before a question: `QUESTION_PAUSE_MS = 0` in `js/engine.js`.
- Rounds per match: `ROUNDS = 5` in `js/trivia.js`. Points: `MAX_POINTS = 50`.
- Reconnect grace: 60s (`RECONNECT_GRACE_MS`), overridable with `TEST_GRACE_MS` for local tests.
- Matchmaking: `MAX_PLAYERS 6`, `MIN_PLAYERS 2`, `MAX_WAIT_MS 45000`, window `BASE 100`, widen `+50 per 10s`, in `server/matchmaking.js`.

## Formatting rules (see DESIGN.md)

- Guessing page: exact figures with commas.
- Results page: three significant digits from 100,000 up, exact below.
- Values of 10 or more show no decimals. Bots guess whole numbers unless the answer is under 10.
- Names show only the part before the `@` (`displayName` in `js/trivia.js`).

## Tests

Scratch scripts, not in the repo, under the session scratchpad:
- `tt/trivia-test.mjs`: trivia rules, parsing, units, points, ties, redaction, ELO, question bank, full bot match. Run with a copy of `js/` next to it.
- `mp-test/run.mjs`: two accounts play a full ranked match over real sockets. Takes about 2 minutes. Needs the server running.
- `mm/t.mjs`: matchmaking windows and wait limit with fake players. About 50 seconds.

There's no test suite in the repo itself.

## Key files

- Engine (pure): `js/trivia.js`, `js/engine.js` (match driver), `js/questions.js`.
- Client UI: `js/ui.js` (the only DOM module for the game), `js/home.js` (menu), `lobby/lobby.js`, `social/social.js`, `social/chrome.js` (top bar, tab bar, sidebar, help dialog), `auth/login.js`.
- Server: `server/game-rooms.js` (live matches), `server/ws.js` (websocket handler), `server/rooms.js`, `server/matchmaking.js`, `server/matches.js` (results and ELO), `server/social.js`, `server/auth.js`, `server/db.js`, `server/server.js`.
- Styles: `css/style.css`. Later rules override earlier ones.

## Suggested next steps

1. Check the menu, lobby, and standings on a real phone, starting signed out.
2. Run one full ranked match with two real accounts and check the rating changes on the standings.
3. Verify the question answers in `js/questions.js`.
4. Update `CLAUDE.md`, delete the leftover NBA files, and remove test accounts before any release.
5. Decide whether recent matches on profiles should be public.
