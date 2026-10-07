// @ts-check
// Per-question statistics for the game's author, so you can see how players actually do on each
// question. Only human answers in multiplayer matches are recorded (bots are excluded), and each row holds
// just the question id, how far off the guess was, and when. There's no user id, so the rows can't be
// traced back to a player. The stats page and its data are shown only to the account named by
// ADMIN_USERNAME in server/.env. Everyone else gets a 404, so the page's existence isn't revealed.

import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { QUESTIONS } from '../js/questions.js';

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
