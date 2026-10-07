// Fills the LOCAL question_answers table with made-up answers, so the admin stats page has something to
// show. The numbers are random and mean nothing.
//
// Usage (from the repo root):
//   node tools/seed-mock-stats.mjs           adds mock answers to the local app.db
//   node tools/seed-mock-stats.mjs --clear   deletes every row in question_answers, mock or real
//
// Never run this against the VPS database. It writes to whichever server/data/app.db it finds.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await import(pathToFileURL(path.join(here, '..', 'server', 'db.js')).href);
const { QUESTIONS } = await import(pathToFileURL(path.join(here, '..', 'js', 'questions.js')).href);

if (process.argv.includes('--clear')) {
  const { changes } = db.prepare('DELETE FROM question_answers').run();
  console.log(`Deleted ${changes} rows from question_answers.`);
  process.exit(0);
}

const insert = db.prepare(
  `INSERT INTO question_answers (question_id, pct_off, guess, question_text, answer, created_at)
   VALUES (?, ?, ?, ?, ?, datetime('now', ?))`
);

// Box-Muller: a normal random number, so most guesses land near the middle of the spread.
function gaussian() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Spread the rows over the last ten days so the daily history has several points.
function daysAgo() {
  return `-${Math.floor(Math.random() * 10)} days`;
}

/** Ordinary questions: guesses scatter around the answer, with a different typical miss for each. */
function seedBankQuestion(q) {
  let total = 0;
  const typicalMiss = 0.02 + Math.random() * 0.6;
  const answers = 40 + Math.floor(Math.random() * 160);
  for (let i = 0; i < answers; i++) {
    const noGuess = Math.random() < 0.05;
    const pctOff = noGuess ? null : Math.abs(Math.exp(gaussian() * 0.8)) * typicalMiss * 0.5;
    // A guess is the answer moved up or down by the miss. Clamped at zero, since a guess can't be negative.
    const guess = noGuess ? null : Math.max(0, q.answer * (1 + (Math.random() < 0.5 ? -1 : 1) * pctOff));
    insert.run(q.id, pctOff, guess, q.text, q.answer, daysAgo());
    total++;
  }
  return total;
}

// A "wrong magnitude" scenario: players think in the hundreds of thousands, but the true answer is far larger.
// Guesses are spread on a log scale centred on 100,000, so the log view shows one tight group far below the
// green line. The percentage-off figures are huge, which is the case the new magnitude figures are for.
const OCEAN_SCENARIO = {
  id: 'mock-ocean-gallons',
  text: 'MOCK: How many gallons of water would fit in the ocean?',
  answer: 3.5e20,
  label: 'gal'
};

function seedOceanScenario() {
  let total = 0;
  const answers = 120;
  for (let i = 0; i < answers; i++) {
    const noGuess = Math.random() < 0.05;
    // log10 of the guess is normal around 5 (100,000), with a spread of about a third of a decade either way.
    const guess = noGuess ? null : Math.pow(10, 5 + gaussian() * 0.35);
    const pctOff = noGuess ? null : Math.abs(guess - OCEAN_SCENARIO.answer) / OCEAN_SCENARIO.answer;
    insert.run(OCEAN_SCENARIO.id, pctOff, guess, OCEAN_SCENARIO.text, OCEAN_SCENARIO.answer, daysAgo());
    total++;
  }
  return total;
}

const seed = db.transaction(() => {
  let total = 0;
  for (const q of QUESTIONS) total += seedBankQuestion(q);
  total += seedOceanScenario();
  return total;
});

console.log(`Added ${seed()} mock answers across ${QUESTIONS.length + 1} questions (including the ocean scenario).`);
