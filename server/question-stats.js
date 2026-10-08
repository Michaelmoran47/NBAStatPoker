// @ts-check
// Per-question statistics for the game's author, so you can see how players actually do on each
// question. Every human answer — multiplayer matches (bots excluded) and now the daily too, via
// dailyRouter below — lands in the same question_answers table: just the question id, how far off the
// guess was, and when. There's no user id, so no row can be traced back to a player.
//
// adminRouter's stats page and its data are shown only to the account named by ADMIN_USERNAME in
// server/.env; everyone else gets a 404, so the page's existence isn't revealed. dailyRouter, by
// contrast, is reachable by any signed-in player — it's what lets the daily report its own guesses and
// read back a question's live-computed spread (computedSpread) before scoring.

import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { QUESTIONS } from '../js/questions.js';
import { NEAR_MISS_THRESHOLD } from '../js/trivia.js';
import { createLimiter, limitRoute, userOrIp } from './rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const insertAnswer = db.prepare(
  'INSERT INTO question_answers (question_id, pct_off, guess, question_text, answer) VALUES (?, ?, ?, ?, ?)'
);

// The text and correct answer for each question, as saved with its answers.
const questionMeta = db.prepare(`
  SELECT question_id, MAX(question_text) AS question_text, MAX(answer) AS answer
  FROM question_answers
  GROUP BY question_id
`);

const summaryRows = db.prepare(`
  SELECT question_id,
         COUNT(*) AS shown,
         SUM(pct_off IS NULL) AS no_guess,
         AVG(pct_off) AS avg_pct_off,
         SUM(pct_off = 0) AS exact,
         SUM(pct_off <= 0.03) AS within_3,
         SUM(pct_off <= 0.10) AS within_10
  FROM question_answers
  GROUP BY question_id
`);

// Every answer that has a guess, so the median can be worked out. The median is a better middle value
// than the mean, since one wildly wrong guess can't pull it far.
const guessedRows = db.prepare(`
  SELECT question_id, pct_off
  FROM question_answers
  WHERE pct_off IS NOT NULL
  ORDER BY question_id, pct_off
`);

// The literal guesses, for the magnitude figures. Older rows from before the guess column existed have none.
const literalGuessRows = db.prepare(`
  SELECT question_id, guess
  FROM question_answers
  WHERE guess IS NOT NULL
  ORDER BY question_id, guess
`);

/** @param {number[]} sorted Values already in ascending order. */
function median(sorted){
  if(sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Once a question has this many real guesses on record, its spread is computed from the data instead
// of the hand-tagged guess in js/questions.js — real results beat an educated guess. Below this, the
// sample's too small to trust (a couple of wildly-off guesses on a question's first day could swing it
// wildly); the hand-tagged value carries it until then.
const MIN_SAMPLES_FOR_COMPUTED_SPREAD = 10;
// Keeps one freak early session (or a flood of joke guesses) from sending a question's curve somewhere
// pointsFor was never designed to handle well, even past MIN_SAMPLES_FOR_COMPUTED_SPREAD.
const COMPUTED_SPREAD_BOUNDS = {min: 0.3, max: 2.5};

const pctOffForQuestion = db.prepare(`
  SELECT pct_off FROM question_answers WHERE question_id = ? AND pct_off IS NOT NULL ORDER BY pct_off
`);

/**
 * A question's difficulty multiplier (Question.spread), computed from real played results — ranked,
 * practice, and the daily all feed the same question_answers table — instead of the hand-tagged guess
 * in js/questions.js, once there's enough data to trust it. Solves for the spread that puts the
 * *median* real guess right at the near-miss threshold: a question people routinely guess within 15%
 * of computes to a tight spread; one where the median guess is 90% off computes to a loose one.
 * @param {string} questionId
 * @returns {number|null} Null below MIN_SAMPLES_FOR_COMPUTED_SPREAD — caller falls back to the
 *   question's own hand-tagged spread (or the default of 1).
 */
export function computedSpread(questionId){
  const rows = /** @type {{pct_off:number}[]} */ (pctOffForQuestion.all(questionId));
  if(rows.length < MIN_SAMPLES_FOR_COMPUTED_SPREAD) return null;
  const m = /** @type {number} */ (median(rows.map(r => r.pct_off)));
  return Math.min(COMPUTED_SPREAD_BOUNDS.max, Math.max(COMPUTED_SPREAD_BOUNDS.min, m / NEAR_MISS_THRESHOLD));
}

const dailyRows = db.prepare(`
  SELECT date(created_at) AS day,
         COUNT(*) AS shown,
         AVG(pct_off) AS avg_pct_off
  FROM question_answers
  WHERE question_id = ?
  GROUP BY day
  ORDER BY day
`);

/**
 * Saves every human answer from a finished multiplayer match. Bots' seats are left out.
 * @param {import('../js/trivia.js').RoundResult[]} history Each round's result, from GameState.history.
 * @param {Set<number>} humanSeatIds Seat ids that belong to real players.
 */
export function recordQuestionAnswers(history, humanSeatIds){
  const save = db.transaction(() => {
    for(const round of history){
      for(const entry of round.entries){
        if(!humanSeatIds.has(entry.playerId)) continue;
        insertAnswer.run(round.question.id, entry.pctOff, entry.value, round.question.text, round.question.answer);
      }
    }
  });
  save();
}

/** @param {import('express').Request} req @param {import('express').Response} res @param {import('express').NextFunction} next */
function requireAdmin(req, res, next){
  const admin = process.env.ADMIN_USERNAME;
  if(!admin || req.session?.username !== admin) return res.status(404).json({error: 'Not found.'});
  next();
}

/** Text and answer for a question: the saved copy if there is one, otherwise the current bank. */
function metaFor(id, saved){
  const bank = QUESTIONS.find(q => q.id === id);
  return {
    text: saved?.question_text ?? bank?.text ?? '(question no longer in the bank)',
    answer: saved?.answer ?? bank?.answer ?? null,
    label: bank?.label ?? ''
  };
}

export const adminRouter = Router();

adminRouter.get('/api/admin/question-stats', requireAdmin, (req, res) => {
  const rows = /** @type {any[]} */ (summaryRows.all());
  /** @type {Map<string, number[]>} */
  const guessesByQuestion = new Map();
  for (const r of /** @type {{question_id:string, pct_off:number}[]} */ (guessedRows.all())) {
    const list = guessesByQuestion.get(r.question_id) ?? [];
    list.push(r.pct_off);
    guessesByQuestion.set(r.question_id, list);
  }
  /** @type {Map<string, {question_text:string|null, answer:number|null}>} */
  const savedMeta = new Map(questionMeta.all().map(m => [m.question_id, m]));
  /** @type {Map<string, number[]>} */
  const literalByQuestion = new Map();
  for (const r of /** @type {{question_id:string, guess:number}[]} */ (literalGuessRows.all())) {
    const list = literalByQuestion.get(r.question_id) ?? [];
    list.push(r.guess);
    literalByQuestion.set(r.question_id, list);
  }
  res.json({
    questions: rows.map(r => {
      const meta = metaFor(r.question_id, savedMeta.get(r.question_id));
      const answer = meta.answer;
      const guesses = literalByQuestion.get(r.question_id) ?? [];
      const medianGuess = median(guesses);
      // Share of literal guesses within a factor of ten of the answer. Under 10x means people are in a
      // different range entirely, not just a bit off. Zero or negative guesses can't be compared this way.
      const withinTen = answer && answer > 0
        ? guesses.filter(g => g > 0 && g <= answer * 10 && g >= answer / 10).length / guesses.length
        : null;
      return {
        id: r.question_id,
        text: meta.text,
        shown: r.shown,
        noGuess: r.no_guess,
        medianPctOff: median(guessesByQuestion.get(r.question_id) ?? []),
        medianRatio: answer && answer > 0 && medianGuess !== null ? medianGuess / answer : null,
        withinTenTimes: withinTen,
        exact: r.exact,
        within3: r.within_3,
        within10: r.within_10
      };
    })
  });
});

adminRouter.get('/api/admin/question-stats/:id/daily', requireAdmin, (req, res) => {
  const rows = /** @type {any[]} */ (dailyRows.all(req.params.id));
  res.json({
    days: rows.map(r => ({day: r.day, shown: r.shown, avgPctOff: r.avg_pct_off}))
  });
});

const guessesFor = db.prepare(`
  SELECT guess FROM question_answers
  WHERE question_id = ? AND guess IS NOT NULL
`);

// Every literal guess for one question, plus the correct answer, for drawing its distribution.
adminRouter.get('/api/admin/question-stats/:id/distribution', requireAdmin, (req, res) => {
  const rows = /** @type {{guess:number}[]} */ (guessesFor.all(req.params.id));
  const saved = /** @type {any} */ (questionMeta.all().find(m => m.question_id === req.params.id));
  const meta = metaFor(req.params.id, saved);
  res.json({ values: rows.map(r => r.guess), answer: meta.answer, label: meta.label });
});

adminRouter.get('/admin/stats', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'stats.html'));
});

// Everyday endpoints the daily client itself calls — unlike adminRouter above, these are reachable by
// any signed-in player, not just ADMIN_USERNAME.
export const dailyRouter = Router();

// GET /api/daily/spreads?ids=a,b,c — the live-computed spread (see computedSpread) for each id that
// has enough data to trust, omitting ids that don't. The daily fetches this once at the start of a
// match and merges it over the hand-tagged defaults baked into js/questions.js before scoring.
dailyRouter.get('/daily/spreads', (req, res) => {
  const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',').filter(Boolean) : [];
  /** @type {Record<string, number>} */
  const spreads = {};
  for(const id of ids){
    const s = computedSpread(id);
    if(s !== null) spreads[id] = s;
  }
  res.json({spreads});
});

// A handful of rounds a minute is plenty for one person playing through the one daily match that
// exists per day — this just guards against the endpoint being hammered, not normal play.
const dailyAnswerLimit = limitRoute(createLimiter({max: 30, windowMs: 60 * 1000}), userOrIp, 'Too many requests.');

// POST /api/daily/answer {questionId, guess, pctOff, questionText, answer} — one call per round the
// daily closes. Requires a session (the app already requires an account to play at all) but never
// records who, same as question_answers' existing no-user-id design for multiplayer answers — these
// rows exist purely to measure the question, not the player.
dailyRouter.post('/daily/answer', dailyAnswerLimit, (req, res) => {
  if(!req.session?.userId) return res.status(401).json({error: 'Not logged in.'});
  const {questionId, guess, pctOff, questionText, answer} = req.body ?? {};
  if(typeof questionId !== 'string' || !QUESTIONS.some(q => q.id === questionId)){
    return res.status(400).json({error: 'Unknown question.'});
  }
  if(guess !== null && typeof guess !== 'number') return res.status(400).json({error: 'Invalid guess.'});
  if(pctOff !== null && typeof pctOff !== 'number') return res.status(400).json({error: 'Invalid pctOff.'});
  if(typeof questionText !== 'string' || typeof answer !== 'number'){
    return res.status(400).json({error: 'Invalid question data.'});
  }
  insertAnswer.run(questionId, pctOff, guess, questionText, answer);
  res.status(201).json({ok: true});
});
