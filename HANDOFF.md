# Handoff — Quantrivia

Read this first, then `DESIGN.md` (look and navigation rules) and `CLAUDE.md` (code conventions — **stale**, see below).

## What the game is now

A numeric trivia game, formerly NBA Stat Poker, then NBA Stat Guess. Each match is five questions. Each player types a number and picks a unit (none, hundred, thousand, million, billion, trillion, quadrillion). The guess closest to the answer, as a percent, wins the round, and ties all win. Points are 50 minus 1 per 1% off, never below 0. The match goes to the most round wins, then the most points. Questions come from `js/questions.js`.

Modes:
- **Start game:** ranked matchmaking (rating window ±100, widening 50 every 10s, starts at 6 players or after 45s with at least 2).
- **Play with friends:** the lobby. Create or join a room, ready up, host starts (min 2, max 6).
- **Practice vs Bots:** solo against two CPU opponents with random names. (Renamed from "Practice vs CPUs" this session — check for the old label if adding new UI copy.)

ELO (start 1200, K 32) changes only in ranked matches. Lobby matches are casual and show a dash on the standings.

Social: profiles, friends (request, accept, decline, remove), a friends leaderboard, all under `/social/social.html`, built by a subagent and then replaced in the nav by `social/chrome.js`.

**Note:** `CLAUDE.md` in this repo describes an *older, different game concept* (a poker-style betting game using NBA legends' stat lines, `js/state.js`, `js/betting.js`, `js/scoring.js`, `js/data.js`). That game is gone — this is a numeric-trivia game instead. `CLAUDE.md` needs a full rewrite, not a touch-up. Don't trust it for current architecture; this file and `DESIGN.md` are more current.

## Domain, email, and DNS (set up this session)

- Domain: **`playquantrivia.com`**, bought on GoDaddy (`quantrivia.com` was taken/parked). Declined all GoDaddy upsells (Domain Privacy+Protection, Professional Email, SSL Xpress, Domain Expiration Protection) — none needed.
- DNS is on **Cloudflare** (nameservers switched over from the registrar). SSL/TLS is handled free via Cloudflare + Let's Encrypt/Traefio on the VPS side — no paid SSL product needed.
- **Cloudflare Email Routing** forwards `contact@playquantrivia.com` → the user's personal Gmail. This is forwarding-only (no outbound SMTP), and is intentionally left this way for now — the user plans to create a dedicated `quantrivia@gmail.com` later for manual replies and repoint the routing destination then. Not urgent, not done yet.
- **Resend** is set up for transactional/automated email (password reset, report notifications, etc.) — domain verified via Cloudflare's "Auto configure" (CNAME `send`/`rsend` → `*.forge.rmta.net`, plus a DKIM TXT record). **Resend confirmed fully verified as of this session.**
- **Still needed:** add `RESEND_API_KEY` to `server/.env` (user's action — check if done before building anything that sends mail). Password reset and the player-reporting feature are **not built yet**; they're blocked on this key existing in the server's env.

## Privacy, Terms, and reporting

- `privacy.html` and `terms.html` added at repo root, served via the static-file allowlist in `server/server.js` (add any new top-level page there or it 404s). Operator is named as Michael Moran (no registered business); contact is `contact@playquantrivia.com`. Privacy policy includes a bullet on the anonymous per-question answer stats collection (see below).
- Linked from `auth/login.html`'s new footer. **Not yet linked from other pages** (landing/menu) — worth doing before launch.
- Player reporting feature itself is not built — waiting on Resend key, same as password reset.

## `server/env.js` — a real bug, worth knowing about

`server/server.js` used to do `import 'dotenv/config'`, which loads `.env` relative to the **process's current working directory**, not the file's own directory. Starting the server from the repo root (`node server/server.js`) silently skipped `server/.env` entirely — including `ADMIN_USERNAME`, which made the admin stats page 404 for everyone with no visible error.

Fixed with a dedicated `server/env.js`:
```js
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '.env') });
```
`server/server.js` now does `import './env.js';` as its **very first import**, before anything else — ES module imports run in source order, so this guarantees env vars are set before any other module (e.g. `auth.js` reading `GOOGLE_CLIENT_ID` at module-load time) can read `process.env`. If a new server module needs an env var at import time, make sure `server.js` still imports `env.js` first — it's easy to accidentally reorder this during a merge.

## Question bank (`js/questions.js`)

Reorganized into `BY_CATEGORY` (Sports, Geography, Society, Population, Astronomy, Science, Culture, Everyday — "Population" currently empty, add to it as you write more), flattened into `QUESTIONS` with each question tagged `category`; `CATEGORIES` is exported too.

Rules applied when writing/reviewing questions:
- No "commonly known tight answers" (removed the Harry-Potter-book-count style question) — favor estimation-style questions (area, height, distance, population) where the number itself can be exact but isn't something people already have memorized.
- **Miles/imperial, not km/metric.** Converted `speed-of-light`, `earth-moon-distance`, `pacific-area` to miles, `everest-height` to feet.
- 61 questions total as of this session, ids unique, every answer > 0 (hand-verified by script, not by eye).
- **Question answers are still otherwise unverified for factual accuracy** — written from general knowledge, not checked against sources one by one. Do this before real launch.

### Reviewing/culling questions

`tools/build-review.mjs` is a standalone Node script (run with `node tools/build-review.mjs`) that imports `js/questions.js` and generates `tools/question-review.html` — a Keep/Drop review page, **not served by the game server**, just open the generated HTML file directly in a browser. Marks persist in that page's own localStorage; it has a "Copy drop list" button to pull out the ids to remove. User has not yet handed back a drop list from this — worth asking.

## Admin stats page (built this session)

A private, owner-only page showing how the public is doing on each question, so bad/ambiguous questions can be found. Nobody else can see it or know it exists.

**Access control:** set `ADMIN_USERNAME=<your username>` in `server/.env` (see `server/.env.example`). Visit `/admin/stats` signed in as that account. Any other account, or the var left blank, gets a generic `404 {"error":"Not found."}` from `requireAdmin` in `server/question-stats.js` — deliberately indistinguishable from the route not existing.

**Privacy of the data itself:** `question_answers` (table in `server/db.js`) has **no user_id column at all** — answers can't be traced back to a specific player, by design. Each row also stores its own `question_text` and `answer` snapshot (not just a foreign key into the question bank), so historical stats stay correct and readable even after a question is edited or removed from `js/questions.js` later.

**How data gets in:** `server/game-rooms.js`'s `runGame` calls `recordQuestionAnswers(game.G.history, humanSeatIds)` (from `server/question-stats.js`) right after a match finishes, before `recordMatchResults`. Only human seats are recorded — bot answers are excluded, since they're not interesting for this.

**What's on the page** (`server/admin/stats.html`), per question, sortable by column:
- Answers shown, no-guess count, **median guess ÷ answer** (ratio, not percent — easier to read "3x too high" than a percent), **within-10× rate**, median % off, exact rate, within-3% rate, within-10% rate, and a Review flag.
- Click any row to open a detail panel: a plain-language summary sentence (e.g. "The median guess is 3.1 times too high... Many players may be working in the wrong range," or "...in the right range (within two times the answer)"), a box-and-whisker strip chart on a **log10 scale** of the literal guess values (box = IQR, whiskers = 5th–95th percentile, green line = correct answer), and the existing day-by-day history table.

**Why log-scale box plot, not a bell curve:** two earlier designs were built and both discarded after user feedback ("i feel like neither of these graphs are particularly beneficial to me"):
1. First attempt: a bell curve of % off. Rejected — user wanted literal guess values, not % off, so wrong-magnitude guesses (e.g. guessing thousands when the answer is in the quintillions) wouldn't get crushed into one bucket at the edge of the chart.
2. Second attempt: a log-scale histogram of literal guesses. Still rejected as not useful enough on its own.
3. Final: the plain-language summary + log-scale box/strip chart + sortable median-ratio column, approved by the user.

**Flagging rules** (`RULES` object in `server/admin/stats.html`) — these are for *review only*, never automatic removal, per explicit user instruction:
```js
const RULES = {
  MIN_ANSWERS: 30,
  NO_GUESS_RATE: 0.25,
  MEDIAN_PCT_OFF: 3.0,          // 300%
  EXACT_RATE: 0.10,
  WITHIN_3_RATE: 0.10,
  WITHIN_TEN_TIMES_RATE: 0.5
};
```
Only evaluated once a question has at least `MIN_ANSWERS` answers.

**Important known subtlety — why `WITHIN_TEN_TIMES_RATE` exists:** `pctOff = |guess - answer| / answer` is mathematically asymmetric. If a guess is too *low*, `pctOff` tops out near 100% (it can never exceed it, since `guess ≥ 0`). If a guess is too *high*, `pctOff` is unbounded. That means the original `MEDIAN_PCT_OFF > 300%` rule can only ever catch "guessing way too high" — it structurally cannot flag "everyone's guessing in the wrong (lower) order of magnitude," which is exactly the case the user most cares about (e.g. people guessing in the thousands when the real answer is in the quintillions — that's only ~100% off by this formula, nowhere near 300%). Added a second, symmetric rule based on the literal guess values instead of pctOff: flag if under 50% of guesses land within a 10× band of the answer ("Under 50% within 10× the answer — wrong magnitude"). If you ever touch these rules again, keep both the high-side and the magnitude-side check — removing the `withinTenTimes` one silently reintroduces this blind spot.

**Mock/seed data for testing:** `tools/seed-mock-stats.mjs` (run `node tools/seed-mock-stats.mjs`, or `--clear` to wipe the table). Generates realistic-looking scattered answers for every bank question, **plus** a dedicated `mock-ocean-gallons` scenario (`OCEAN_SCENARIO` in that file) where guesses cluster log-normally around 100,000 but the true answer is `3.5e20` — built specifically to validate the wrong-magnitude flag. **Never run this against the VPS database** — it writes to whichever `server/data/app.db` it finds, and the script says so in its own header comment.

The fix for the ocean scenario not flagging (`WITHIN_TEN_TIMES_RATE`) was added and the server restarted, but **not yet re-confirmed by the user on the live page** — check that the ocean mock question now shows the "wrong magnitude" flag before considering this feature done.

## Other UI tweaks this session

- Menu/play screen buttons shrunk (`.menu .btn.big` padding/font-size in `css/style.css`), Quantrivia logo added above them (`.menu-logo`, reused the landing page's SVG mark) in `js/home.js`.
- "Practice vs CPUs" renamed to "Practice vs Bots" everywhere (button text, code comments, `DESIGN.md`).

## Current state (carried forward from before this session — still true/relevant)

Working and checked:
- Solo play end to end in the browser.
- Ranked match end to end over real sockets (scripted two-account test).
- Engine rules: `node` tests in the scratchpad (see Tests below).
- Client and server type checks pass.

Built but not verified on screen:
- Final standings rating changes per player (`eloDeltas`).
- Signed-in menu flow (`/` routing).
- Top bar / phone tab bar / desktop sidebar / "How to play" dialog **on a real phone**.
- Confetti on match winner's final standings.
- Social pages after the chrome change.

Known issues or gaps:
- **Phone layout is still the main unknown.** Check before changing anything else.
- **Question answers still factually unverified** (see Question bank section above) — more questions were added this session, so there are now more to check, not fewer.
- Recent matches on profiles are friend-only by design (`canSeeMatches` in `server/social.js`).
- Leftovers to delete or confirm: `js/season-rankings.json`, `server/build-season-rankings.py` (unused NBA data), `mockups/visual-options.html` (superseded design options).
- Test accounts in `server/data/app.db`: `mptest_alpha`, `mptest_bravo`, `social_a`, `social_b`, `social_c`. Remove before release.
- `CLAUDE.md` is stale — see the note under "What the game is now" above; it needs more than an update, it describes a different game.

## Operational notes

- **Restart the server after any change under `server/`.** It doesn't hot-reload. Static files under `js/`, `css/`, `lobby/`, `social/`, `auth/`, and root-level pages like `privacy.html`/`terms.html` are read from disk per request, so those don't need a restart.
- Restart on Windows: stop the process listening on 5500, then `Start-Process node -ArgumentList 'server/server.js' -WindowStyle Hidden`.
- The browser pane often can't screenshot after navigation. Use `find` or `read_page` instead.
- Sign-in page can come up empty in the browser pane. Reload before reading it.
- No test suite exists for the admin stats server code either — it was verified this session via `node --check` and by extracting the inline `<script>` with a `new Function(...)` trick, not by loading the page as the admin user. If you can log in as the admin account, do a real visual pass over `/admin/stats` before trusting it fully.

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

- Engine (pure): `js/trivia.js`, `js/engine.js` (match driver), `js/questions.js` (now category-organized, see above).
- Client UI: `js/ui.js` (the only DOM module for the game), `js/home.js` (menu, now with logo), `lobby/lobby.js`, `social/social.js`, `social/chrome.js` (top bar, tab bar, sidebar, help dialog), `auth/login.js`.
- Server: `server/game-rooms.js` (live matches, now also records answer stats), `server/ws.js` (websocket handler), `server/rooms.js`, `server/matchmaking.js`, `server/matches.js` (results and ELO), `server/social.js`, `server/auth.js`, `server/db.js`, `server/server.js`, `server/env.js` (dotenv loader, see above), `server/question-stats.js` (admin stats API + page).
- Admin stats page: `server/admin/stats.html`.
- Legal pages: `privacy.html`, `terms.html` (repo root).
- Review/seed tooling (not part of the served app): `tools/build-review.mjs` + generated `tools/question-review.html`, `tools/seed-mock-stats.mjs`.
- Styles: `css/style.css`. Later rules override earlier ones.

## Suggested next steps

1. Confirm `RESEND_API_KEY` is in `server/.env`, then build password reset and the player-reporting feature on top of Resend.
2. Set up a dedicated `quantrivia@gmail.com` and repoint Cloudflare's `contact@` routing to it (not urgent, deferred by the user).
3. Get the user's Keep/Drop list back from `tools/question-review.html` and remove dropped questions from `js/questions.js`.
4. Verify the `WITHIN_TEN_TIMES_RATE` fix actually shows the "wrong magnitude" flag on the mock ocean question in the live `/admin/stats` page.
5. Fact-check every answer in `js/questions.js`, old and new.
6. Check the menu, lobby, and standings on a real phone, starting signed out.
7. Run one full ranked match with two real accounts and check the rating changes on the standings.
8. Rewrite `CLAUDE.md` — it currently describes a different, older poker-style game. Delete leftover NBA files, and remove test accounts before any release.
9. Add Privacy/Terms footer links to the landing page and menu, not just `auth/login.html`.
10. Decide whether recent matches on profiles should be public.
