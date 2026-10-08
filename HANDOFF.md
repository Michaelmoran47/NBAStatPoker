# Handoff — Quantrivia

Read this first, then `DESIGN.md` (look and navigation rules) and `CLAUDE.md` (code conventions — **stale**, see below).

## What the game is now

A numeric trivia game, formerly NBA Stat Poker, then NBA Stat Guess. Each match is five questions. Each player types a number and picks a unit (none, hundred, thousand, million, billion, trillion, quadrillion). Questions come from `js/questions.js`.

**Scoring is not one rule — it depends on the mode** (this line used to say "50 minus 1 per 1% off" as if that were universal; it never was, and matters less now):
- **Ranked and Practice vs Bots** score by place each round (`RANK_POINTS = [10, 6, 3, 1]` in `js/trivia.js`): closest guess wins, ties share the places they cover. How close doesn't matter beyond rank.
- **The Daily** scores by closeness (`pointsFor` in `js/trivia.js`, see "Daily scoring formula" below) — this is the only mode where the shape of the points-vs-error curve matters at all.

The match goes to the most round wins, then the most points.

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
- `RESEND_API_KEY` is now in `server/.env` and confirmed working (test emails sent successfully). Password reset is built (see below). The player-reporting feature is **still not built** — same Resend plumbing (`server/email.js`) can be reused for it.

## Password reset (built this session)

- `server/email.js` — a thin wrapper around Resend's HTTP API using Node's built-in `fetch` (no new npm dependency). Reads `RESEND_API_KEY` and `FROM_EMAIL` from env; if the key is missing it just logs instead of sending, so local dev without a key doesn't crash.
- `server/password-reset.js` — `POST /api/forgot-password` and `POST /api/reset-password`, mounted in `server/server.js`. Tokens are 32 random bytes, stored only as a SHA-256 hash in the new `password_resets` table (`server/db.js`) — same reasoning as bcrypt-hashing passwords, a DB leak alone shouldn't hand out usable reset links. Tokens expire after 30 minutes and are single-use; a new request invalidates any earlier unused token for that account. The forgot-password response is deliberately identical whether or not the email matches an account, to avoid leaking which emails are registered.
- Signup (`server/auth.js`) now requires and stores an email — there was previously no email column populated for password accounts (only Google accounts had one), and reset needs somewhere to send to. Email must be unique **among password accounts** (checked at signup); Google accounts aren't included in that check.
- New pages: `auth/forgot.html`/`forgot.js` (request a link) and `auth/reset.html`/`reset.js` (set a new password from the token in the emailed link). Both are served automatically since `/auth` is already a mounted static dir — no allowlist change needed. Login page got a "Forgot password?" link.
- **`BASE_URL` matters and is easy to get wrong.** It's used to build the link inside the reset email. Locally it must be `http://localhost:5500`; **on the real VPS deploy, it must be changed to `https://playquantrivia.com` in that server's own `.env`** — mixing these up sends an email with a link to a server that doesn't exist yet (this happened once already this session: `server/.env` had the production URL while testing locally, producing a reset email pointing at the live domain with nothing deployed there, which looked like "the server is down"). Check this value specifically whenever debugging a reset link that doesn't load.
- `jsconfig.json` gained `"moduleDetection": "force"` — needed once more than one script-style (no import/export) file existed under `auth/`, otherwise tsc treated them as sharing one global scope and falsely flagged `app`/`error` redeclaration errors across `login.js`, `forgot.js`, `reset.js`. It also gained `social/**/*.js` in `include` — that whole directory had never actually been type-checked before (nothing in the checked dirs imports it), which is how `social/social.js` existed for a while with zero type-check coverage. Worth remembering if another top-level client dir (e.g. a future one) gets added — it needs adding to `include` explicitly, tsc won't pick it up on its own.
- **Verified end-to-end this session**, including a real email delivered to the operator's own Gmail (not just a local mock) and the "wrong `BASE_URL`" failure mode above, which actually happened and was fixed live.

## Daily scoring formula (changed this session)

The Daily's points-per-round (`pointsFor(value, answer)` in `js/trivia.js`) used to be pure "1 point per 1% off, floored at 0" (`50 - pctOff*100`). That's harsh on the estimation-style questions this bank is mostly made of (areas, populations, distances) — a guess only has to be ~50% off before it scores zero, and wildly wrong-order-of-magnitude guesses (which the question-writing guidance explicitly expects for things like ocean volume or Jupiter's diameter) always hit a hard 0, with no credit for "right ballpark, wrong decade."

**Current state: `MAX_POINTS = 100` (`js/trivia.js`), so a perfect daily run is `ROUNDS * MAX_POINTS` = 500.** The scale was changed three times in one session (200 → 1000 → 100, landing at 500 total) purely by moving this one constant — the curve-shape logic in `pointsFor` was never touched for any of those, because it was written to derive everything from `MAX_POINTS` rather than hardcoding point values:
- **Within `NEAR_MISS_THRESHOLD` (currently 50%) off:** points drop at a fixed *rate* (`POINTS_LOST_RATE = 1`, "1% of `MAX_POINTS` lost per 1% off") — `MAX_POINTS * (1 - POINTS_LOST_RATE * pctOff)`. This is the literal original, unmodified "1 point per 1% off, out of 50" rule, just rescaled to whatever `MAX_POINTS` is. An earlier pure log-ratio version (smooth curve, no threshold) was tried and rejected during design because it was more forgiving *everywhere*, including tiny errors on tight questions like "how many seasons does Family Guy have" — log compresses small errors even more than raw percent does, which would have inflated scores on precisely the questions that don't need any forgiveness.
- **Past the threshold:** switches to a tail based on `log10(guess/answer)`, continuing down smoothly from `NEAR_MISS_POINTS` (what the rule above gives right at the threshold — 50% of `MAX_POINTS` at the current 50% setting) to 0 at 100x off in either direction.
- The threshold sits at a different `log10` distance depending on direction (guessing high vs low), because percent-off itself is asymmetric that way (`pctOff = |guess-answer|/answer` can only reach 100% on the low side but is unbounded on the high side) — the tail picks up from wherever the threshold-off point actually falls in log space for that direction, so there's no visible jump at the seam.
- **If `MAX_POINTS` needs to change again, just change the constant** — `NEAR_MISS_POINTS` and the within-threshold formula both derive from it via `POINTS_LOST_RATE`, so the curve's proportions stay identical at any scale, and this has now been exercised three times without needing a second touch. Don't reintroduce a hardcoded point value anywhere in `pointsFor`.
- Only ranked and practice-vs-bots were never touched by any of this — they've always scored by place (`rankPoints`), not by closeness, so `pointsFor` was already daily-only.
- Four curve *shapes* were graphed and compared before deciding on this one (current/%, linear-in-log, Gaussian-in-log, piecewise-in-log like TimeGuessr's distance scoring) — the hybrid was the only one that didn't also soften scoring on tight questions. If revisiting the shape (not just the scale), the three alternates are worth remembering as "already tried, rejected for over-softening everywhere" rather than untested ideas.

**Threshold widened from 20% to 50% after a real clustering problem turned up in play-testing, worth understanding if this gets touched again.** The original 20%/rate-2 version shipped first and was individually verified at the time, but a live example exposed a flaw: guessing 8 against an answer of 6 (33% off — a genuinely good guess on a small-number question) scored only 59/100, barely more than guessing literally double the answer (53/100, 100% off). Root cause: in log-ratio terms (what the tail uses), "33% off" and "100% off" are nearly the same tiny distance — the tail is calibrated for *decades*-scale errors (10x, 100x off on huge estimation questions), so it's nearly flat right after the seam, and most normal "somewhat off" guesses on any question land in exactly that flat region, clustering in the 50s-60s regardless of how close they actually felt. Fix: widen `NEAR_MISS_THRESHOLD` to 0.5 and simplify `POINTS_LOST_RATE` back to 1 (undoing the 2x steepening that existed only to hit a matching value at the old, narrower 20% boundary) — this covers the "a bit off, not order-of-magnitude off" band with the one rule actually meant to carry it, and leaves the tail doing only what it's for. Verified live: 8 vs 6 moved from 59 → 67; 7 vs 6 (17% off) moved from 67 → 83; the extreme tail (10x/100x off) barely changed (31→27, 0→0). **The emoji/tier yellow cutoff in `js/ui.js` (`closenessEmoji`, `tierOf`) was updated from 0.6 to 0.5 to match** — those thresholds are meant to fall out of `pointsFor`'s own seam, not be a second hand-picked number that can silently drift out of sync with it; this is the second time that coupling mattered in practice, worth keeping in mind if `NEAR_MISS_THRESHOLD` moves again.

**Display also changed, same session: the daily's score shows raw points, not a percentage.** `scoreLabel` in `js/ui.js` used to show "X%" for closeness scoring and "X pts" for rank scoring — now it's always "X pts", everywhere (round results, the end-of-match review, the daily summary). `dailyResult()`'s return shape changed from `{pct, emojis, text}` to `{points, maxPoints, emojis, text}`; the share text changed from `"Quantrivia #N — 50.4%"` to `"Quantrivia #N — 500/500 pts"` style, and each round line in that text changed from `"1️⃣ 🟩32%"` to `"1️⃣ 🟩100 pts"`. Verified live at every scale tried (per-round max of 50, 200, 1000, and finally 100): each landed exactly on its expected total (250, 1000, 5000, 500) with no further code changes beyond the one constant.

**Closeness emoji tiers were redesigned too, same session, to match the new formula.** They used to be `🏆` exact / `🟩` within 3% / `🟨` within 10% / `⬜` anything else — raw-percent-off cutoffs that predate the log-tail formula and don't reflect it at all (an 11%-off guess and a 1,000,000x-off guess both showed the same white square, despite scoring very differently now). `closenessEmoji()` in `js/ui.js` now takes `points` instead of `pctOff` and buckets by **fraction of MAX_POINTS earned**: `🏆` 100% (exact), `🟩` ≥90%, `🟨` ≥60%, `🟧` **(new)** any credit from the log-scale tail (>0%), `⬜` zero or no answer. The 90%/60% cutoffs aren't arbitrary — they're where `pointsFor`'s own curve bends (90% ≈ 5% off; 60% is the exact seam where the flat near-miss rule hands off to the tail), so the emoji boundaries fall out of the formula itself instead of being a second set of numbers to keep in sync by hand. The new 🟧 tier is the one that matters: it's what makes "wrong but in the right order of magnitude" visually distinguishable from "no idea," which was invisible before this change even though the scores themselves already made that distinction. Verified live: a round scoring 31/100 (10x off) correctly showed 🟧, distinct from 96/100 (🟩) and 0/100 (⬜).

**Row highlighting (`tierOf` in `js/ui.js`) got the same orange tier, plus became mode-aware.** Before this, almost every guess on a wide-range question showed no highlight at all — the old cutoffs (exact / within 3% / within 10%) left most real guesses uncolored, so in practice players only ever saw gold or green. `tierOf(e, view)` now takes the full entry and view (not just `pctOff`) and branches on scoring mode:
- **Rank-scored rounds** (ranked, practice vs bots) tier by **place**, since that's what actually earned the points, not raw closeness: gold = 1st (`e.points >= RANK_POINTS[0]`), green = 2nd, yellow = 3rd, orange = 4th (any points > 0), no highlight = scored 0.
- **The daily** tiers by the same points-fraction bands `closenessEmoji` uses (100% / ≥90% / ≥60% / >0% / 0%), so the row color and the round's emoji always agree.
- New CSS: `.row.orange` / `.review-guess.orange` using the already-defined `--orange` (#ff9f5a) variable — no new color was invented, just a fourth highlight added to the existing three.
- Verified live in both modes: a 10x-off daily guess showed `row orange`; a 3-player practice match showed `row gold` / `row green` / `row yellow` for 1st/2nd/3rd respectively.

**Row highlighting became an animated, proportional fill bar, same session.** Previously a tiered row was just solid-colored, full width, with tier-specific dark text — once that became a partial-width highlight (see below), dark-ink-on-bright-color text would've turned unreadable over the uncolored remainder. Now:
- `tierFillHtml(e, view)` (`js/ui.js`) adds a `<span class="tier-fill">` as the first child of each `.row`/`.review-guess`, sized via `fractionOf(e, view)` — points as a fraction of that round's own max (`RANK_POINTS[0]` for rank-scored rounds, `MAX_POINTS` for the daily), 0 to 1.
- The bar is a translucent (`opacity:.85`, raised from an initial `.55` that read as too faded — user feedback, verified live) overlay using `var(--tier-color)` per tier, sliding in from the left via `transform:scaleX()`, clipped to the row's rounded corners (`overflow:hidden` on the row, `border-radius:inherit` on the bar).
- Row/review text no longer changes color per tier — it's always the page's normal light text color, now with a `text-shadow:0 1px 3px rgba(0,0,0,.5)` added so it stays legible whether it's sitting over the bright tier color or the plain dark row background.
- **A real CSS gotcha was hit and fixed along the way, worth remembering if this pattern is reused:** the first implementation used a CSS `@keyframes` animation with `to{ transform:scaleX(var(--fill)); }`, where `--fill` was set per-element via inline `style`. Confirmed live that this does **not** reliably resolve the custom property inside a keyframe, even though the exact same `transform:scaleX(var(--fill))` resolves correctly as a *static* (non-animated) value on the same element. Fixed by switching to an ordinary CSS `transition:transform` instead, with `wireTierFills()` (`js/ui.js`, called once per render from `renderGame`) flipping `--fill` from `0` to its real target a `requestAnimationFrame` after insertion — the same two-step "paint the start state, then change it" technique the existing countdown timer bar already uses in this codebase.
- **Verification note:** the animation couldn't be confirmed playing from inside the browser-automation tool used this session, because `requestAnimationFrame` doesn't fire on a hidden/backgrounded tab in any real browser, and the automation pane was hidden during testing — every other ingredient (tier colors, `--fill` wiring, the static `var()` resolution, the opacity) was individually verified correct via direct DOM/computed-style checks. The user has since confirmed live in a real, visible tab that the animation does play — the only issue reported was that it read too faded, which is the `.55 → .85` opacity change above.

**"Copy to clipboard" on the daily results was broken — two separate bugs, both fixed.** The old code was just `await navigator.clipboard.writeText(...)`, with a catch that gave up and showed "Could not copy" on any failure:
1. `navigator.clipboard` doesn't exist at all outside a **secure context** (HTTPS or `localhost`) — so testing from a phone over a bare LAN IP (`http://192.168.1.x`, the way phone testing has been done this session) had no clipboard API to call in the first place.
2. Even when `navigator.clipboard` *does* exist, `.writeText()` can still throw (confirmed live: a real `NotAllowedError: Write permission denied`) — the old code had no second attempt for this case either.

Fixed with a `copyText(text)` helper in `js/ui.js` that tries the modern API first and falls back to the older `document.execCommand('copy')` technique (a hidden, focused, selected `<textarea>`) whenever the modern path is unavailable *or* fails for any reason — not just when it's missing. **Could not get a clean end-to-end confirmation that the fallback actually places something on the clipboard**, because the browser-automation tool used for testing this session has clipboard access denied at the sandbox level (`navigator.permissions.query({name:'clipboard-write'})` returns `'denied'` there, and even `execCommand('copy')` returns `false` in that same sandbox) — that's a property of the testing tool, not a real user's browser, but it means this still wants a real-device check before fully trusting it.

**Share/copy text format redesigned too, same session: minimal Wordle-style grid instead of a line per round.** It used to be one line per round with a keycap, emoji, and point value (`1️⃣ 🟩96 pts`, etc.) — readable but long. Four format options were sketched (minimal grid; compact single-line detail; the old per-round-line format; either plus a "beat my score" call-to-action) and the minimal grid was picked. `dailyResult()` in `js/ui.js` now builds:
```
Quantrivia #N — X/Y pts
🏆🟩🟨🟧⬜

quantrivia.com
```
— score line, then just the row of emoji squares, no per-round numbers. `KEYCAPS` and the old `rounds` array were dead code after this and were removed. Verified live by capturing the real argument passed to `navigator.clipboard.writeText` (monkey-patching around the sandbox's clipboard denial): `"Quantrivia #3 — 231/500 pts\n🏆⬜🏆🟧⬜\n\nquantrivia.com"`, matching five real guesses (two exact, one 10x off, two hugely off). The compact detail, old per-round-line, and CTA-line options are still on the table if this one doesn't land well with real sharing — nothing about the current implementation forecloses them, `closenessEmoji`/`scoreLabel` are unchanged and still available to build any of the other three formats from.

## Account settings — add/change email (built this session)

- New page: `auth/settings.html`/`settings.js`. Linked from a player's own profile (the "This is you" view in `social/social.html` now shows "Account settings" instead of no action at all).
- `POST /api/account/email` in `server/auth.js` lets a signed-in player set or change their email. **Requires their current password to confirm the change** if the account has one (Google-only accounts skip this, since they have no password to check) — this wasn't explicitly asked for but is a deliberate security choice: without it, a stolen session cookie alone could silently redirect password-reset emails to an attacker's address. `GET /api/me` now also returns `email` and `hasPassword` so the settings page (and anything else) can tell what to show.
- This is what makes password reset actually usable by **anyone who signed up before this session** — those accounts have no email on file (see above) and were otherwise stuck.

## Privacy, Terms, and player reporting (built this session)

- `privacy.html` and `terms.html` added at repo root, served via the static-file allowlist in `server/server.js` (add any new top-level page there or it 404s). Operator is named as Michael Moran (no registered business); contact is `contact@playquantrivia.com`. Privacy policy includes a bullet on the anonymous per-question answer stats collection (see above, admin stats section).
- Linked from `auth/login.html`'s new footer. **Not yet linked from other pages** (landing/menu) — worth doing before launch.
- **Reporting is built.** A "Report" link on any other player's profile (`social/social.html`) opens a dialog (reason dropdown + optional free-text details) that posts to `POST /api/reports` (`server/reports.js`). Each report is both saved to a new `reports` table (`server/db.js` — reporter/reported ids *and* a username snapshot of each, so it still reads sensibly after a rename or account deletion) and emailed via `server/email.js` to `REPORT_EMAIL` (defaults to `contact@playquantrivia.com`, which is already forwarding to the operator's personal Gmail per the DNS/email setup above). Rate-limited to 10 reports/hour per account; you can't report yourself (enforced both server-side and by the UI, which shows "Account settings" instead of "Report" on your own profile).
- **There's no in-app admin view for reports** — the email is the only way they're surfaced today. The `reports` table exists mainly so a report isn't lost if the email bounces; querying it directly (`sqlite3`/a one-off script) is the only way to review history right now. Worth a glance from the admin stats page's author if report volume ever gets high enough to need triage.

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
- Rounds per match: `ROUNDS = 5` in `js/trivia.js`. Daily per-round max: `MAX_POINTS = 100` (daily-only — ranked/practice use `RANK_POINTS` instead, see "Daily scoring formula" above).
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
- Server: `server/game-rooms.js` (live matches, now also records answer stats), `server/ws.js` (websocket handler), `server/rooms.js`, `server/matchmaking.js`, `server/matches.js` (results and ELO), `server/social.js`, `server/auth.js` (accounts, login/signup, `/api/me`, email changes), `server/db.js`, `server/server.js`, `server/env.js` (dotenv loader, see above), `server/question-stats.js` (admin stats API + page), `server/email.js` (Resend wrapper), `server/password-reset.js`, `server/reports.js`.
- Admin stats page: `server/admin/stats.html`.
- Legal pages: `privacy.html`, `terms.html` (repo root).
- Account pages: `auth/login.js` (now with email field, forgot-password link), `auth/forgot.js`, `auth/reset.js`, `auth/settings.js`.
- Review/seed tooling (not part of the served app): `tools/build-review.mjs` + generated `tools/question-review.html`, `tools/seed-mock-stats.mjs`.
- Styles: `css/style.css`. Later rules override earlier ones.

## Suggested next steps

1. **Before deploying to the VPS, set `BASE_URL=https://playquantrivia.com` and double-check `FROM_EMAIL`/`RESEND_API_KEY`/`REPORT_EMAIL` in the VPS's own `server/.env`** — see the caveat under "Password reset" above. This is the one thing most likely to silently misbehave on first deploy.
2. Build an in-app admin view for the `reports` table if report volume ever picks up — right now the only way to review reports is the email or a raw DB query.
3. Set up a dedicated `quantrivia@gmail.com` and repoint Cloudflare's `contact@` routing to it (not urgent, deferred by the user).
4. Get the user's Keep/Drop list back from `tools/question-review.html` and remove dropped questions from `js/questions.js`.
5. Verify the `WITHIN_TEN_TIMES_RATE` fix actually shows the "wrong magnitude" flag on the mock ocean question in the live `/admin/stats` page.
6. Fact-check every answer in `js/questions.js`, old and new.
7. Check the menu, lobby, and standings on a real phone, starting signed out.
8. Run one full ranked match with two real accounts and check the rating changes on the standings.
9. Rewrite `CLAUDE.md` — it currently describes a different, older poker-style game. Delete leftover NBA files, and remove test accounts before any release (the `resettest1`/`resetemailcheck`/`featuretestA`/`featuretestB` accounts from this session's testing were already cleaned up).
10. Add Privacy/Terms footer links to the landing page and menu, not just `auth/login.html`.
11. Decide whether recent matches on profiles should be public.
