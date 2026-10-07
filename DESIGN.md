# Quantrivia — Design

The visual and interaction rules the UI follows. The code lives in `css/style.css`, `social/chrome.js`, and `js/ui.js`. When a rule here and the code disagree, fix one of them so they match.

## Inspiration

- **Wordle:** one job per screen, a single large play area, and colour that carries meaning. Feedback is shown as colour fills, never as text alone. Chrome is minimal, and the share moment is a result you can read at a glance.
- **Chess.com:** dark charcoal panels with a bright green primary button, a clear tab bar for the main destinations, and "Play" as the one loud call to action on the home screen. Lists and lobbies use compact rows with an avatar, name, and rating on the same line.
- **High-energy trivia apps:** a dark canvas so the question pops, bright green for correct, red or coral for wrong, and yellow or orange for the countdown so it builds urgency without panic.

Take the feel from these, not the look. We keep our own violet canvas and arcade type.

## Look

Bold arcade, kept calm. One bright accent per element, no tilted cards, no heavy drop shadows.

- **Background:** deep violet `--bg` (`#0f1237`), a dark canvas so text and the question stand out. Cards sit on `--card` (`#1e2470`), and nested rows on `--card-2` (`#262d8c`).
- **Accents:** yellow `--yellow` (`#fffa0b`) for the question card and the current item, teal `--accent` (`#7acaf6`) for the primary action, pink `--accent-2` (`#7c73c7`) for the winner tag.
- **Text:** white `--text` on dark surfaces, muted lavender `--muted` (`#a2a7e5`) for secondary text, dark ink `--ink` (`#0f1237`) for anything on a bright surface.
- **Fonts:** Chakra Petch bold (`--font-display`) for titles, buttons, and big numbers, always uppercase. Nunito Sans (`--font-body`) for everything else. Space Mono (`--font-mono`) for numbers in tables and small readouts.
- **Shape:** buttons and inputs are pills (`border-radius: 999px`). Cards use 16–22px radius.

## Feedback colours

Colour is the main signal for how a guess landed. Always pair it with a word or an icon too, so colour-blind players can read it.

- **Exact:** gold.
- **Within 3% of the answer:** bright green.
- **Within 10% of the answer:** yellow.
- **Countdown:** green, then yellow, then red as time runs down (see the Timer bar component).
- **Neutral / waiting:** muted lavender on `--card`. Never use a feedback colour for something that is only informational.

## Components

- **Buttons (`.btn`):** pill, Bungee label. `.primary` is teal, `.ghost` is text-only. Full-width on phones. Disabled at 35% opacity.
- **Question card (`.question-card`):** yellow, Bungee, the one thing on screen that matters.
- **Answer box (`.answer-row`):** a pill number input with a yellow unit dropdown to its right. The live readout under it uses the exact figure.
- **Timer bar (`.timer`):** a thin bar that drains left to right over the guess window (18s) and the result pause (4.5s). Green while more than half is left, yellow from half down to 20%, and red for the last 20%. The results bar stays yellow.
- **Result rows (`.closeness .row`):** ranked closest first, one row per player. Tiers: gold is exact, green is within 3%, yellow is within 10%. Other rows are plain.
- **Player strip:** names only, centred, sized to their text. No counters while a match is running.
- **Standings:** place badge first (medal for 1–3), then name, then the rating change in green (gain) or red (loss), or a dash for casual and solo games, and for bot seats.
- **Lists and lobbies:** compact rows, one per person or room. Name on the left, status or rating on the right. Rows are tappable across the full width.
- **Cards (`.start-card`, `.guess-card`, `.result-card`):** `--card` with 20px radius. No shadow.

- **Round results:** after each round the correct answer and every guess are shown, closest first, each with its round points (10, 6, 3, 1 by place; the daily shows a percentage). Practice and multiplayer then move on after a 4.5-second pause (`ROUND_RESULT_MS` in `js/engine.js`, shared by solo and the server). The daily has no countdown: a Next question button (See results after round 5) moves on. Full answers and guesses are also reviewed at game over: placings first, then a scrollable round-by-round review.
- **Daily score:** one large percentage with one decimal (points out of the most available), then a share text like "Quantrivia #1 — 50.4%", one line per round with its keycap number, a result emoji and the round percentage, and "quantrivia.com". Result emojis: 🏆 exact, 🟩 within 3%, 🟨 within 10%, ⬜ otherwise.

## Navigation

- **Top bar (every page except the landing page):** an optional back arrow on the left, the page title in the middle, and a "?" button on the right that opens "How to play".
- **Phone:** a fixed tab bar with Play, Profile, Friends, and Leaderboard. Pages add bottom padding so content isn't hidden behind it. The sidebar is never shown on phones.
- **Desktop:** the same four destinations in a collapsible sidebar. It starts open, and the choice is remembered once the player toggles it.
- **Home:** one loud primary button ("Play Ranked"), with the secondary options (friends, practice) set quieter below it, the way chess.com puts "Play" first.
- **Play the Daily:** a filled palette-green button above Play Ranked. It is a solo challenge with no CPU opponents: the same five questions for everyone on the day (UTC date), and the goal is to score as many points as possible. There is no time limit: each round waits until you lock in.
- **During a match:** the tab bar and sidebar are hidden (`body.in-game`). The top bar stays so help and back still work.
- **Landing:** signed-out visitors see the logo, the tagline "a numbers based trivia game", and two pill buttons: Log in and Sign up (playing needs an account, so there's no Play button here). Signed-in players land on the main menu: Play the Daily (solo, same questions for everyone), Play Ranked (ranked queue), Play with friends (lobby), Practice vs Bots (solo).
- **Back navigation:** inside the lobby, the room and ranked-queue screens each have their own back arrow. Room back means leave the room, and queue back means cancel the search.

## Motion

- **Answer reveal:** the correct answer scales up with a short overshoot (`answerPop`, 0.6s).
- **Win:** confetti falls once on the final standings for the match winner. It is not shown during play.
- **Reduced motion:** when `prefers-reduced-motion` is set, the answer pop and confetti are skipped.
- **Pacing:** practice and multiplayer pause 4.5 seconds between rounds. The daily waits for the Next question button.

## Numbers and names

- **Guessing page:** exact figures with thousands separators, for example `3,500,000`.
- **Results page:** rounded to three significant digits from 100,000 up, for example `121 thousand` or `6.55 million`. Figures under 100,000 stay exact.
- **Whole numbers:** values of 10 or more show no decimals. Smaller values keep up to two.
- **Bot guesses:** whole numbers unless the answer is under 10.
- **Names:** show the part of the username before the `@`. Don't add "(you)".

## Copy

- Short, plain sentences. Button labels are verbs ("Start game", "Lock in", "Leave room").
- No subtitles under page titles.
- No hint text on screens during play.
- Titles: "Quantrivia" on the menu and home, "Solo", "Play", "Profile", "Friends", "Leaderboard", "Sign in".

## Accessibility

- Every icon-only button has an `aria-label`.
- Focus rings use `--yellow`, 3px, with an offset.
- Dialogs use a native `<dialog>`, so Escape and focus behave.
- Keep text contrast readable on the dark surfaces. Use `--ink` on the bright chips, buttons, and result tiers.
- Never rely on colour alone for the closeness tiers or the countdown. Add a word, icon, or position.
