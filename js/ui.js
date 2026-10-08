// @ts-check
// The only module that touches `document`. It draws the question, the number box with its unit dropdown,
// round results and final standings from a redacted view (viewFor, js/trivia.js). The solo client runs
// the match driver here. The multiplayer lobby (lobby/lobby.js) calls renderGame() with server views.
// Both get the same markup.

import { UNITS, ROUNDS, MAX_POINTS, RANK_POINTS, parseNumber, makeGuess, formatNumber, formatRounded, pickQuestions, seededRandom, dailyKey, dailyNumber, makeGame, submitGuess, viewFor } from './trivia.js';
import { QUESTIONS } from './questions.js';
import { playGame, ROUND_RESULT_MS } from './engine.js';

// Matches the server's GUESS_TIME_MS in server/game-rooms.js.
const GUESS_TIME_MS = 18_000;

// Length of the guess window, shown as the answer timer bar.
const GUESS_TOTAL_MS = 18_000;

// Names for the solo CPU opponents. Two are drawn at random for each match.
const CPU_NAMES = ['Ace', 'Blaze', 'Cobra', 'Dyna', 'Echo', 'Flint', 'Glacier', 'Haze', 'Ivy', 'Jett', 'Koda', 'Lynx', 'Maverick', 'Nova', 'Onyx', 'Piper', 'Quill', 'Raven', 'Sable', 'Tempo', 'Vex', 'Wren', 'Yara', 'Zephyr'];

// The number box and unit dropdown survive re-renders. Other players' answers re-render the whole
// screen, and without this a half-typed answer would vanish.
let draftText = '';
let draftUnit = '';
let lastRoundNum = null;
/** The round whose result pause is running, and when it started. Used to drain the results timer bar. */
let resultRound = null;
let resultStart = 0;
// Set to 'final' once the winner's confetti has fired for this match, so re-renders don't fire it again.
let confettiDone = null;

/** @type {ReturnType<typeof setInterval>|null} */
let timerFrame = /** @type {number|null} */ (null);
// The round whose result pause is running, and when it started. Used to drain the results timer bar.



// Escapes text for both element content and quoted attribute values.
/** @param {string} s */
export function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c] ?? c);
}

/** @param {string} key */
function unitLabel(key){
  return UNITS.find(u => u.key === key)?.label ?? '';
}

/** @param {string} selected */
function unitOptions(selected){
  return UNITS.map(u =>
    `<option value="${u.key}" ${u.key === selected ? 'selected' : ''}>${u.key ? escapeHtml(u.label) : '—'}</option>`
  ).join('');
}

// Live readout of what the typed number works out to, e.g. "3.5 million = 3,500,000". Empty until the
// input is a valid number.
function previewText(){
  const g = makeGuess(draftText, draftUnit);
  if(g.value === null) return draftText.trim() ? 'Enter a plain number' : ' ';
  return `= ${formatNumber(g.value)}`;
}

/**
 * The rating change shown on the final standings. Casual matches and solo games have no rating
 * change, so they show a dash.
 * @param {Record<string, number>|null|undefined} deltas
 * @param {number} id
 */
function eloCell(deltas, id){
  const d = deltas ? deltas[String(id)] : undefined;
  if(d === undefined) return '<span class="g-dist mono">\u2014</span>';
  const text = d > 0 ? `+${d}` : d < 0 ? `\u2212${Math.abs(d)}` : '0';
  const cls = d > 0 ? 'elo-up' : d < 0 ? 'elo-down' : '';
  return `<span class="g-dist mono ${cls}">${text}</span>`;
}

/**
 * A player's match total on the final standings, styled as a recessed pill (see .g-pts in
 * style.css) rather than plain text so it reads as a little carved-in readout next to the rank badge.
 * @param {number} totalPoints
 */
function pointsCell(totalPoints){
  return `<span class="g-pts mono">${totalPoints} pts</span>`;
}

/**
 * Which highlight a guess earns on the results list and the end-of-match review, or '' for no
 * highlight.
 *
 * Rank-scored rounds (ranked, practice — i.e. multiplayer and bot games) tier by place, matching the
 * medal colors used on the final standings: gold for 1st, silver for 2nd, bronze for 3rd, nothing for
 * 4th. Unlike the daily's tiers below, this isn't meant to fill in the row — see tierFillHtml.
 *
 * The daily tiers by points-fraction bands matching closenessEmoji's own cutoffs, so the row color and
 * the round emoji always agree with each other.
 * @param {import('./trivia.js').RoundEntry} e
 * @param {ReturnType<typeof viewFor>} view
 */
function tierOf(e, view){
  if(view.scoring === 'rank'){
    if(e.points >= RANK_POINTS[0]) return 'gold';
    if(e.points >= RANK_POINTS[1]) return 'silver';
    if(e.points >= RANK_POINTS[2]) return 'bronze';
    return '';
  }
  const frac = fractionOf(e, view);
  if(frac >= 1) return 'gold';
  if(frac >= 0.9) return 'green';
  if(frac >= 0.5) return 'yellow';
  if(frac > 0) return 'orange';
  return '';
}

/**
 * Points as a fraction of that round's own max — RANK_POINTS[0] for rank-scored rounds, MAX_POINTS
 * for the daily — 0 to 1. Drives how far the sliding highlight bar on a result row fills.
 * @param {import('./trivia.js').RoundEntry} e
 * @param {ReturnType<typeof viewFor>} view
 */
function fractionOf(e, view){
  const max = view.scoring === 'rank' ? RANK_POINTS[0] : MAX_POINTS;
  return max > 0 ? Math.min(1, e.points / max) : 0;
}

/**
 * The highlight inserted as the first child of a scored result row. Rank-scored rounds (multiplayer
 * and bot games) just get a thin gold/silver/bronze edge mark for 1st/2nd/3rd place — not a fill, since
 * place isn't a share of anything. The daily keeps the sliding fill bar, started at --fill:0 (so
 * there's something to animate from) with the real target stashed in data-fill; wireTierFills() flips
 * it a frame after insertion so the CSS transition actually plays instead of snapping straight to its
 * end state.
 */
function tierFillHtml(e, view){
  if(view.scoring === 'rank') return `<span class="tier-edge"></span>`;
  return `<span class="tier-fill" style="--fill:0" data-fill="${fractionOf(e, view)}"></span>`;
}

/**
 * Triggers every unanimated .tier-fill bar under `root` to slide in. Called once after each render
 * that might contain result rows — a no-op if there are none. Needs a frame to pass between setting
 * --fill:0 (above) and this, or the browser coalesces both into one style recalc and the transition
 * never visibly runs; requestAnimationFrame is enough of a gap for that.
 * @param {ParentNode} root
 */
function wireTierFills(root){
  const bars = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('.tier-fill[data-fill]')]);
  if(bars.length === 0) return;
  requestAnimationFrame(() => {
    for(const bar of bars) bar.style.setProperty('--fill', bar.dataset.fill ?? '0');
  });
}

/**
 * How a round's points read on the results: always the raw point value, for every scoring mode.
 * @param {number} points
 */
function scoreLabel(points){
  return `${points} pts`;
}

/**
 * Every answer ranked by closeness to the true number, closest first. Players with no valid answer
 * sit at the bottom.
 * @param {import('./trivia.js').RoundResult} r
 * @param {ReturnType<typeof viewFor>} view
 */
function closenessList(r, view){
  const nameOf = (/** @type {number} */ id) => view.players.find(p => p.id === id)?.name ?? '?';
  const ordered = r.entries.slice().sort((x, y) => {
    const ax = x.pctOff ?? Infinity;
    const ay = y.pctOff ?? Infinity;
    return (ax - ay) || nameOf(x.playerId).localeCompare(nameOf(y.playerId));
  });
  const rows = ordered.map(e => {
    const tier = tierOf(e, view);
    const detail = e.pctOff === null
      ? (e.guess === null ? 'no answer' : 'not a number')
      : `${escapeHtml(e.value !== null ? formatRounded(e.value) : (e.guess ?? ''))}`;
    return `<li class="row ${tier}">
      ${tierFillHtml(e, view)}
      <span class="who">
        <span class="who-name">${escapeHtml(nameOf(e.playerId))}</span>
        <span class="who-guess">${detail}</span>
      </span>
      <span class="dist mono">${scoreLabel(e.points)}</span>
    </li>`;
  }).join('');
  return `<ol class="closeness">${rows}</ol>`;
}

/**
 * The true answer, large, shown where the player strip sits during a round result.
 * @param {import('./trivia.js').RoundResult} r
 */
function answerBlock(r){
  const unit = r.question.label ? ' ' + escapeHtml(r.question.label) : '';
  return `<div class="answer-block"><span class="answer-label">The answer</span><span class="answer-big">${formatRounded(r.question.answer)}${unit}</span></div>`;
}

/**
 * The end-of-match review: every question in order, with its correct answer and each player's guess.
 * Within a round, players are listed closest first, and players with no valid answer sit at the bottom.
 * @param {ReturnType<typeof viewFor>} view
 */
function reviewHtml(view){
  const nameOf = (/** @type {number} */ id) => view.players.find(p => p.id === id)?.name ?? '?';
  const rounds = view.history.map(r => {
    const ordered = r.entries.slice().sort((x, y) => {
      const ax = x.pctOff ?? Infinity;
      const ay = y.pctOff ?? Infinity;
      return (ax - ay) || nameOf(x.playerId).localeCompare(nameOf(y.playerId));
    });
    const unit = r.question.label ? ' ' + escapeHtml(r.question.label) : '';
    const guesses = ordered.map(e => {
      const guessText = e.pctOff === null
        ? (e.guess === null ? 'no answer' : 'not a number')
        : escapeHtml(e.value !== null ? formatRounded(e.value) : (e.guess ?? ''));
      return `<li class="review-guess ${tierOf(e, view)}">
        ${tierFillHtml(e, view)}
        <span class="review-name">${escapeHtml(nameOf(e.playerId))}</span>
        <span class="review-value mono">${guessText}</span>
        <span class="review-pts g-pts mono">${scoreLabel(e.points)}</span>
      </li>`;
    }).join('');
    return `
      <article class="review-round">
        <p class="review-question">${r.roundNum}. ${escapeHtml(r.question.text)}</p>
        <p class="review-answer">Answer <b class="mono">${formatRounded(r.question.answer)}${unit}</b></p>
        <ul class="review-guesses">${guesses}</ul>
      </article>`;
  }).join('');
  return `
    <section class="review">
      <h2 class="review-title">Round by round</h2>
      ${rounds}
    </section>`;
}

/**
 * Emoji for how a round scored, as a fraction of MAX_POINTS rather than raw percent-off — the
 * cutoffs line up with where pointsFor's own curve bends (90% is roughly 5% off; 50% is the exact
 * seam where the flat near-miss rule hands off to the log-scale tail), so these don't drift out of
 * sync with the formula the way a second, hand-picked set of percent-off cutoffs would. A trophy
 * for exact, green for a strong guess, yellow for a solid one, orange for "wrong but in the right
 * ballpark" (the whole point of the log tail — an order-of-magnitude estimate that still earned
 * something), and white for no credit or no answer.
 * @param {number} points
 */
function closenessEmoji(points){
  const frac = points / MAX_POINTS;
  if(frac >= 1) return '🏆';
  if(frac >= 0.9) return '🟩';
  if(frac >= 0.5) return '🟨';
  if(frac > 0) return '🟧';
  return '⬜';
}

/**
 * The daily score for the viewer: the total points scored out of the most available, the round
 * emojis, and the text used for sharing. Points, not a percentage — a percentage reads as "how well
 * did I do out of 100" and invites comparing days with very different average difficulty, where the
 * raw point total (same MAX_POINTS scale every day) is the more honest number.
 *
 * The share text is the minimal Wordle-style grid: the score line, then just the row of emoji
 * squares with no per-round numbers — short enough to read at a glance in a group chat, which is
 * what actually gets a result shared instead of typed out and skipped.
 * @param {ReturnType<typeof viewFor>} view
 */
export function dailyResult(view){
  const mine = view.history.map(r => r.entries.find(e => e.playerId === view.you));
  const points = mine.reduce((sum, e) => sum + (e?.points ?? 0), 0);
  const maxPoints = ROUNDS * MAX_POINTS;
  const emojis = mine.map(e => closenessEmoji(e?.points ?? 0)).join('');
  const text = [
    `Quantrivia #${dailyNumber()} — ${points}/${maxPoints} pts`,
    emojis,
    '',
    'quantrivia.com'
  ].join('\n');
  return { points, maxPoints, emojis, text };
}

/** @param {ReturnType<typeof viewFor>} view */
function dailySummaryHtml(view){
  const { points, maxPoints, emojis } = dailyResult(view);
  return `
    <div class="result-card daily-score">
      <p class="daily-label">Daily score</p>
      <p class="daily-pct mono">${points} <span class="daily-max">/ ${maxPoints}</span></p>
      <p class="daily-emojis" aria-label="Round results">${emojis}</p>
      <div class="daily-actions">
        <button class="btn" id="copyDailyBtn">Copy to clipboard</button>
        <button class="btn primary" id="shareDailyBtn">Share with friends</button>
      </div>
    </div>`;
}

/**
 * Place badge for the final standings. Places 1 to 3 get a gold, silver, or bronze medal with a blue
 * ribbon, drawn to match the medal icon the game uses. Anything lower shows as a plain number.
 * @param {number} place
 */
function placeBadge(place){
  const tones = {
    1: ['#f7c948', '#d9a21b'],
    2: ['#d7dee6', '#9aa6b4'],
    3: ['#d9965a', '#a8642e'],
  };
  const tone = tones[/** @type {1|2|3} */ (place)];
  if(!tone) return `<span class="place-num">#${place}</span>`;
  const [fill, edge] = tone;
  return `<svg class="medal" viewBox="0 0 40 52" role="img" aria-label="${place} place">
    <polygon points="8,0 17,0 24,20 15,20" fill="#3d8be8"/>
    <polygon points="23,0 32,0 25,20 16,20" fill="#2a64c9"/>
    <circle cx="20" cy="34" r="16" fill="${fill}" stroke="${edge}" stroke-width="2.5"/>
    <circle cx="20" cy="34" r="11" fill="none" stroke="${edge}" stroke-width="1.5"/>
    <text x="20" y="40" text-anchor="middle" font-family="Chakra Petch, Arial Black, sans-serif" font-size="14" fill="${edge}">${place}</text>
  </svg>`;
}

/**
 * @param {ReturnType<typeof viewFor>} view
 * @param {{mode:'solo'|'multiplayer', deadline?: number|null, eloDeltas?: Record<string, number>|null, daily?: boolean}} opts
 */
function playingCard(view, opts){
  const you = view.players.find(p => p.id === view.you);

  if(view.stage === 'waiting' || !view.question){
    return `<p class="status">Get ready…</p>`;
  }

  if(view.stage === 'question'){
    return `<p class="status">Read the question…</p>`;
  }

  if(view.stage === 'guessing'){
    const submittedCount = view.players.filter(p => p.submitted).length;
    const canLock = parseNumber(draftText) !== null;
    return `
      <div class="guess-card">
        ${timerBar()}
        <div class="guess-head">
          <span class="guess-prompt">Your answer</span>
        </div>
        ${you?.submitted
          ? `<p class="locked">Locked in: <b>${escapeHtml(view.yourGuess ?? 'no answer')}</b></p>`
          : `<div class="answer-row">
               <input id="numInput" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
                 placeholder="Type a number" value="${escapeHtml(draftText)}">
               <select id="unitSelect" aria-label="Unit">${unitOptions(draftUnit)}</select>
             </div>
             <div class="preview mono" id="preview">${escapeHtml(previewText())}</div>
             <button class="btn primary" id="lockBtn" ${canLock ? '' : 'disabled'}>Lock in</button>`}
        <div class="table-status mono">${submittedCount}/${view.players.length} locked in</div>
      </div>`;
  }

  // After each round, the answer and every guess are shown. The daily has no countdown: it waits for the
  // Next question button instead, which paintSolo adds.
  if(view.stage === 'round-result' && view.lastResult){
    return `
      <div class="result-card">
        ${opts.daily ? '' : timerBar()}
        ${closenessList(view.lastResult, view)}
      </div>`;
  }

  if(view.stage === 'game-over' && opts.daily){
    return dailySummaryHtml(view);
  }

  if(view.stage === 'game-over' && view.standings){
    return `
      <div class="result-card">
        <h2 class="final-title">Final Results</h2>
        <ul class="guess-list standings">
          ${view.standings.map(s => `
            <li class="${s.place === 1 ? 'win' : ''}">
              <span class="g-rank">${placeBadge(s.place)}</span>
              <span class="g-name">${escapeHtml(s.name)}</span>
              ${eloCell(opts.eloDeltas, s.id)}
              ${pointsCell(s.totalPoints)}
            </li>`).join('')}
        </ul>
      </div>`;
  }

  return '';
}

/**
 * Renders the whole game screen from a redacted view.
 * @param {ReturnType<typeof viewFor>} view
 * @param {{mode:'solo'|'multiplayer', deadline?: number|null, onGuess: (guess: import('./trivia.js').Guess) => void, extra?: string, eloDeltas?: Record<string, number>|null, daily?: boolean}} opts
 */
export function renderGame(view, opts){
  // The tab bar and sidebar stay out of the way while a match is being played.
  document.body.classList.toggle('in-game', view.stage !== 'waiting' && view.stage !== 'game-over');
  // A new round starts with an empty input, so last round's number can't be submitted by accident.
  // The question card drops in only when a new round arrives, not on every redraw within a round.
  const newRound = view.roundNum !== lastRoundNum;
  if(newRound){
    lastRoundNum = view.roundNum;
    resetDraft();
  }
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));
  app.innerHTML = `
    <div class="table-top">
      ${roundPips(view)}
      <span class="round-label mono">Round ${Math.max(view.roundNum, 1)} / ${ROUNDS}</span>
    </div>
    ${view.question && view.stage !== 'game-over' ? `<div class="question-card${newRound ? ' drop-in' : ''}"><p class="question">${escapeHtml(view.question.text)}</p></div>` : ''}
    ${view.stage === 'round-result' && view.lastResult ? answerBlock(view.lastResult) : ''}
    ${playingCard(view, opts)}
    ${view.stage === 'game-over' ? reviewHtml(view) : ''}
    ${opts.extra ?? ''}`;
  wireTierFills(app);

  if(view.stage === 'guessing' && !view.players.find(p => p.id === view.you)?.submitted){
    wireAnswer(opts);
  }
  // Confetti only for the match winner, once, on the final standings.
  if(view.stage === 'game-over' && confettiDone !== 'final'){
    confettiDone = 'final';
    if(view.standings?.find(s => s.id === view.you)?.place === 1) burstConfetti();
  }
  if(view.stage === 'guessing'){
    startTimer(opts.deadline ?? null, GUESS_TOTAL_MS);
  } else if(view.stage === 'round-result' && !opts.daily){
    // The server doesn't send a result deadline, so start the pause clock the first time this round's
    // result is shown. The pause length is the same constant the match driver uses.
    if(resultRound !== view.roundNum){
      resultRound = view.roundNum;
      resultStart = Date.now();
    }
    startTimer(resultStart + ROUND_RESULT_MS, ROUND_RESULT_MS);
  } else {
    if(timerFrame) cancelAnimationFrame(timerFrame);
    timerFrame = null;
  }
}

/** @param {ReturnType<typeof viewFor>} view */
function roundPips(view){
  const done = view.history.length;
  // Yellow only once the round's guess window is open. Before that (waiting, question) and after it closes
  // (round-result, game-over) there's no yellow pip: a finished round is blue, and the next one stays dim.
  const now = view.stage === 'guessing' ? done : -1;
  return `<div class="pips">${Array.from({length: ROUNDS}, (_, i) => {
    const cls = i < done ? 'done' : i === now ? 'now' : '';
    return `<span class="pip ${cls}"></span>`;
  }).join('')}</div>`;
}

/**
 * Wires the number box, unit dropdown, and lock button. Typing updates the draft and the preview in
 * place, so the input keeps focus.
 * @param {{onGuess: (guess: import('./trivia.js').Guess) => void}} opts
 */
function wireAnswer(opts){
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('numInput'));
  const unit = /** @type {HTMLSelectElement|null} */ (document.getElementById('unitSelect'));
  const lock = /** @type {HTMLButtonElement|null} */ (document.getElementById('lockBtn'));
  const preview = document.getElementById('preview');
  if(!input || !unit || !lock) return;

  const sync = () => {
    lock.disabled = parseNumber(draftText) === null;
    if(preview) preview.textContent = previewText();
  };
  const submit = () => {
    if(parseNumber(draftText) === null) return;
    opts.onGuess(makeGuess(draftText, draftUnit));
  };

  input.addEventListener('input', () => { draftText = input.value; sync(); });
  input.addEventListener('keydown', e => { if(e.key === 'Enter') submit(); });
  unit.addEventListener('change', () => { draftUnit = unit.value; sync(); });
  lock.addEventListener('click', submit);
}

// A short burst of paper confetti from the top of the screen. The pieces are removed after they fall.
function burstConfetti(){
  const colors = ['#fffa0b', '#7acaf6', '#7c73c7', '#65c853', '#ffffff'];
  const host = document.createElement('div');
  host.className = 'confetti';
  for(let i = 0; i < 60; i++){
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = Math.random() * 0.4 + 's';
    piece.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
    piece.style.setProperty('--drift', Math.random() * 200 - 100 + 'px');
    piece.style.setProperty('--spin', Math.random() * 720 - 360 + 'deg');
    host.appendChild(piece);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 3500);
}

/** @returns {string} The empty bar; startTimer() fills it in after the view is painted. */
function timerBar(){
  return '<div class="timer"><div class="timer-fill" id="timerFill"></div></div>';
}

// Drains the timer bar from full to empty between now and the deadline. The bar only reads time,
// so it can't drift from the server's clock by more than the network delay.
/**
 * @param {number|null} deadline Epoch ms when the window closes.
 * @param {number} total Length of the window in ms.
 */
function startTimer(deadline, total){
  if(timerFrame) cancelAnimationFrame(timerFrame);
  timerFrame = null;
  if(!deadline) return;
  // Runs once per screen frame rather than every 100ms, so the bar moves smoothly.
  const tick = () => {
    const fill = document.getElementById('timerFill');
    if(!fill) return;
    const left = Math.min(1, Math.max(0, (deadline - Date.now()) / total));
    fill.style.transform = `scaleX(${left})`;
    // Result-card bars keep their CSS colour; only the guessing bar changes colour as time runs out.
    if(!fill.closest('.result-card')){
      fill.style.background = left > 0.5 ? 'var(--green)' : left > 0.2 ? 'var(--yellow)' : 'var(--red)';
    }
    if(left > 0) timerFrame = requestAnimationFrame(tick);
    else timerFrame = null;
  };
  tick();
}

/** Clears the number box and unit dropdown. Called at the start of each round. */
export function resetDraft(){
  draftText = '';
  draftUnit = '';
}

// ---------- Solo: a local match against two CPU opponents ----------

/** Resolves the human's pending answer wait early once they lock in. */
/** @type {(() => void)|null} */
let soloWake = null;
/** Epoch ms when the current solo answer window closes, for the timer bar. */
let soloDeadline = /** @type {number|null} */ (null);
/** Resolves the daily's wait once the player presses Next question (or See results). */
let soloNext = /** @type {(() => void)|null} */ (null);

/**
 * Starts a solo match. The human (id 0) plays alone against two CPU seats (ids 1 and 2). The same
 * playGame() driver the server uses runs it here, with local timers and CPU answers.
 */
export async function startSolo(opts = {}){
  resetDraft();
  soloDaily = Boolean(opts.daily);
  // The daily is a solo challenge: no CPU opponents, just you trying to score as many points as possible.
  // It uses the same five questions for everyone on the same day.
  const cpuNames = soloDaily ? [] : pickQuestions(CPU_NAMES.map(name => ({name})), 2).map(c => c.name);
  const G = makeGame(
    [{id: 0, name: 'You'}, ...cpuNames.map((name, i) => ({id: i + 1, name}))],
    soloDaily ? 'closeness' : 'rank'
  );
  const questions = soloDaily
    ? pickQuestions(QUESTIONS, ROUNDS, seededRandom(dailyKey()))
    : pickQuestions(QUESTIONS, ROUNDS);
  await playGame(G, {
    questions,
    render: () => paintSolo(G),
    // The daily waits for the player after each round. Practice games use the timed pause instead.
    awaitNext: soloDaily ? () => new Promise(resolve => { soloNext = resolve; paintSolo(G); }) : undefined,
    botIds: cpuNames.map((_, i) => i + 1),
    awaitGuesses: () => new Promise(resolve => {
      // The daily has no clock: the round waits until you lock in. Practice games time out.
      soloDeadline = soloDaily ? null : Date.now() + GUESS_TIME_MS;
      const finish = () => {
        if(timer) clearTimeout(timer);
        soloWake = null;
        soloDeadline = null;
        resolve();
      };
      const timer = soloDaily ? null : setTimeout(finish, GUESS_TIME_MS);
      soloWake = () => { if(G.guesses[0] !== undefined) finish(); };
      paintSolo(G); // show the timer as soon as the window opens
    })
  });
  // Marks today's daily as played, so the menu button can stop highlighting it. There's no
  // server record of solo games at all (daily included) — this is the only record that exists.
  if(soloDaily){
    try{ localStorage.setItem(`dailyPlayed:${dailyKey()}`, '1'); } catch {
      // Private windows can refuse storage. Worst case the menu button stays highlighted.
    }
  }
  paintSolo(G); // the match is over. The results screen stays up for the player to act on.
}

/** True while the solo game on screen is the daily challenge. */
let soloDaily = false;

/** @param {import('./trivia.js').GameState} G */
function paintSolo(G){
  const over = G.stage === 'game-over';
  const view = viewFor(G, 0);
  renderGame(view, {
    mode: 'solo',
    daily: soloDaily,
    deadline: G.stage === 'guessing' ? soloDeadline : null,
    onGuess: (guess) => {
      if(!submitGuess(G, 0, guess)) return;
      resetDraft(); // the answer now lives in G, and the pane shows it as locked
      soloWake?.();
      paintSolo(G);
    },
    extra: over
      ? (soloDaily
        ? `<a class="btn primary" href="/">Back to menu</a>`
        : `<button class="btn primary" id="againBtn">Play again</button>`)
      : (soloDaily && G.stage === 'round-result'
        ? `<button class="btn primary" id="nextBtn">${G.roundNum === ROUNDS ? 'See results' : 'Next question'}</button>`
        : '')
  });
  document.getElementById('nextBtn')?.addEventListener('click', () => {
    const next = soloNext;
    soloNext = null;
    next?.();
  });
  if(over) document.getElementById('againBtn')?.addEventListener('click', () => { startSolo(); });
  if(over && soloDaily){
    document.getElementById('shareDailyBtn')?.addEventListener('click', () => { shareText(dailyResult(view).text); });
    document.getElementById('copyDailyBtn')?.addEventListener('click', async (e) => {
      const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
      btn.textContent = (await copyText(dailyResult(view).text)) ? 'Copied!' : 'Could not copy';
    });
  }
}

/** Pre-game screen for solo play. */
export function renderStart(){
  // "Play the Daily" on the menu opens this page with ?daily=1, so the daily game starts straight away.
  if(new URLSearchParams(location.search).has('daily')){
    startSolo({daily: true});
    return;
  }
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));
  app.innerHTML = `
    <div class="start-card">
      <p class="sub">Five trivia questions. Closest answer wins each round.</p>
      <button class="btn primary" id="soloBtn">Start match</button>
      <p class="hint">You against two CPUs. Type a number and pick a unit, from hundred up to quadrillion.</p>
    </div>`;
  document.getElementById('soloBtn')?.addEventListener('click', () => startSolo());
}

/**
 * Copies text to the clipboard, falling back to the older execCommand technique when the modern
 * Clipboard API isn't there at all — which happens on any page that isn't a secure context (HTTPS
 * or localhost). A bare LAN IP like http://192.168.1.x (how this gets tested from a phone during
 * local dev) is not secure, so `navigator.clipboard` is simply undefined there and the modern call
 * throws immediately. Also falls back whenever the modern call exists but still fails for any other
 * reason (e.g. a NotAllowedError from a clipboard-write permission the browser or page denied) —
 * not falling through there was the actual bug: a page that merely has `navigator.clipboard` but
 * can't use it looked identical to one that could, until it quietly failed with no second attempt.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyText(text){
  if(navigator.clipboard && window.isSecureContext){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the older technique below rather than giving up here.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try{
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

/**
 * Shares plain text, such as a daily result, with the same iPhone-first behaviour as shareLink.
 * @param {string} text
 */
export async function shareText(text){
  if(navigator.share){
    try{
      await navigator.share({title: 'Quantrivia', text});
    } catch {
      // The player closed the share sheet. Nothing to do.
    }
    return;
  }
  location.href = `sms:&body=${encodeURIComponent(text)}`;
}

/**
 * Shares a link. On iPhone the share sheet includes Messages, so that's the first choice. Where
 * sharing isn't available, open a Messages draft with the text and link already in it.
 * @param {string} text
 * @param {string} url
 */
export async function shareLink(text, url){
  if(navigator.share){
    try{
      await navigator.share({title: 'Quantrivia', text, url});
    } catch {
      // The player closed the share sheet. Nothing to do.
    }
    return;
  }
  location.href = `sms:&body=${encodeURIComponent(`${text}: ${url}`)}`;
}
