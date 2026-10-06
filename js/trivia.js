// @ts-check
// The trivia game's rules: numeric answers, unit parsing, round and match bookkeeping, standings,
// and ELO. Pure and DOM-free, with no module-level mutable state. The solo client (js/ui.js) and the
// multiplayer server (server/game-rooms.js) both drive this same code.
//
// Each round asks one numeric question. Every player types a number and picks a unit (hundred up to
// quadrillion). The guess closest to the true answer, as a percentage, wins the round, and ties all win.
// Points: a perfect guess earns MAX_POINTS. The total drops by 1 point for every 1% off, down to 0.

/**
 * A handcrafted question. `answer` is in base units (so "3.5 million" is stored as 3500000).
 * @typedef {Object} Question
 * @property {string} id
 * @property {string} text
 * @property {number} answer
 * @property {string} [label] Unit shown next to the answer, e.g. "miles". Optional.
 */

/**
 * One player's guess for a round. `value` is the parsed number in base units, or null if the
 * input wasn't a valid number (scores 0, same as no guess).
 * @typedef {{text: string, unit: string, value: number|null}} Guess
 */

/**
 * @typedef {Object} GuessPlayer
 * @property {number} id
 * @property {string} name
 * @property {number} wins Rounds won this match (ties count for everyone tied).
 * @property {number} totalPoints Sum of this player's round points. Ties on wins go to the higher total.
 */

/**
 * @typedef {Object} RoundEntry
 * @property {number} playerId
 * @property {string|null} guess What the player typed and picked, e.g. "3.5 million". Null for no guess.
 * @property {number|null} value Guess in base units, or null for no guess or invalid input.
 * @property {number|null} pctOff Absolute difference from the answer, as a fraction of the answer (0.05 = 5%).
 *   Null for no valid guess. Can exceed 1 for a wild guess.
 * @property {number} points 0 to MAX_POINTS.
 */

/**
 * @typedef {Object} RoundResult
 * @property {number} roundNum 1-based.
 * @property {Question} question
 * @property {RoundEntry[]} entries
 * @property {number[]} winners Player ids that won the round (empty if nobody guessed validly).
 */

/**
 * @typedef {Object} GameState
 * @property {GuessPlayer[]} players
 * @property {number} roundNum Current round, 1-based (0 before the first round starts).
 * @property {Question|null} question
 * @property {'waiting'|'question'|'guessing'|'round-result'|'game-over'} stage
 * @property {Object<number, Guess>} guesses This round's submitted guesses, keyed by player id.
 *   Present once a player has submitted, even when the input was invalid.
 * @property {RoundResult[]} history Completed rounds, oldest first.
 * @property {'rank'|'closeness'} scoring How round points are awarded: by place ('rank') or by closeness ('closeness', the daily).
 */

export const ROUNDS = 5;
export const MAX_POINTS = 50;
// Practice and multiplayer score by place each round: closest first. Ties share the places they cover.
// Every guess that gets placed earns points, however far off it is.
export const RANK_POINTS = [10, 6, 3, 1];
export const START_ELO = 1200;
export const K_FACTOR = 32;

/** Units the player can pick next to the number box. The factor turns the typed number into base units. */
export const UNITS = [
  {key: '', label: 'none', factor: 1},
  {key: 'hundred', label: 'hundred', factor: 1e2},
  {key: 'thousand', label: 'thousand', factor: 1e3},
  {key: 'million', label: 'million', factor: 1e6},
  {key: 'billion', label: 'billion', factor: 1e9},
  {key: 'trillion', label: 'trillion', factor: 1e12},
  {key: 'quadrillion', label: 'quadrillion', factor: 1e15},
];

/**
 * @param {string} key
 * @returns {number|null} The multiplier for a unit key, or null for an unknown key.
 */
export function unitFactor(key){
  return UNITS.find(u => u.key === key)?.factor ?? null;
}

/**
 * Turns typed text into a number. Commas and spaces are ignored, so "1,250,000" and "1 250 000" both
 * work. Decimals are allowed. Negatives, letters, and empty input return null.
 * @param {string} text
 * @returns {number|null}
 */
export function parseNumber(text){
  const cleaned = String(text ?? '').replace(/[,\s]/g, '');
  if(!/^\d*\.?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * Builds a Guess from the number box and the unit dropdown.
 * @param {string} text
 * @param {string} unitKey
 * @returns {Guess}
 */
export function makeGuess(text, unitKey){
  const n = parseNumber(text);
  const factor = unitFactor(unitKey);
  const value = n !== null && factor !== null ? n * factor : null;
  // Shown text is standardized, so '3.5 million' and '3500000' both read '3.5 million'.
  const display = value === null ? null : formatNumber(value);
  return {text: display ?? String(text ?? '').trim(), unit: unitKey, value};
}

/**
 * Points from a fractional error. Perfect is MAX_POINTS. Each 1% off costs 1 point, floored at 0.
 * @param {number|null} pctOff
 * @returns {number}
 */
export function pointsFor(pctOff){
  if(pctOff === null) return 0;
  return Math.max(0, Math.round(MAX_POINTS - pctOff * 100));
}

/**
 * Fraction off from the answer. The answer is never 0 in the bank, so this divides safely.
 * @param {number} value
 * @param {number} answer
 * @returns {number}
 */
export function fractionOff(value, answer){
  return Math.abs(value - answer) / Math.abs(answer);
}

/**
 * Creates a fresh match for the given seats. Every seat starts at zero wins and zero points.
 * @param {{id:number, name:string}[]} seats
 * @param {'rank'|'closeness'} [scoring] How round points are awarded. Defaults to place scoring.
 * @returns {GameState}
 */
export function makeGame(seats, scoring = 'rank'){
  return {
    scoring,
    players: seats.map(s => ({id: s.id, name: s.name, wins: 0, totalPoints: 0})),
    roundNum: 0,
    question: null,
    stage: 'waiting',
    guesses: {},
    history: []
  };
}

/**
 * Picks `count` distinct questions at random. Used once per match so no question repeats.
 * @template T
 * @param {T[]} bank
 * @param {number} count
 * @param {() => number} [random]
 * @returns {T[]}
 */
/**
 * A repeatable random source from a text seed, so the same seed always gives the same sequence. The
 * daily game uses today's date as the seed, so every player gets the same questions.
 * @param {string} seed
 * @returns {() => number}
 */
export function seededRandom(seed){
  let h = 2166136261;
  for(let i = 0; i < seed.length; i++){ h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's date in UTC, e.g. "2026-10-06", so everyone on the same day gets the same daily game. */
export function dailyKey(now = new Date()){
  return now.toISOString().slice(0, 10);
}

/** The daily's number, counting from the first daily (#1 on 2026-10-06 UTC). */
export function dailyNumber(now = new Date()){
  const first = Date.UTC(2026, 9, 6);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - first) / 86400000) + 1;
}

export function pickQuestions(bank, count, random = Math.random){
  const pool = bank.slice();
  for(let i = pool.length - 1; i > 0; i--){
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * Starts the next round with a question. Guesses are open straight away.
 * @param {GameState} G
 * @param {Question} question
 */
export function beginRound(G, question){
  G.roundNum += 1;
  G.question = question;
  G.guesses = {};
  G.stage = 'question';
}

/**
 * Opens the guessing window.
 * @param {GameState} G
 */
export function openGuessing(G){
  G.stage = 'guessing';
}

/**
 * Records a player's guess. Each player submits once per round, and a second submission is ignored.
 * Returns false if guessing is closed, the player already submitted, or the player isn't in the match.
 * @param {GameState} G
 * @param {number} playerId
 * @param {Guess} guess
 * @returns {boolean}
 */
export function submitGuess(G, playerId, guess){
  if(G.stage !== 'guessing') return false;
  if(!G.players.some(p => p.id === playerId)) return false;
  if(G.guesses[playerId] !== undefined) return false;
  G.guesses[playerId] = guess;
  return true;
}

/**
 * @param {GameState} G
 * @param {number[]} playerIds
 * @returns {boolean} True once every listed player has submitted.
 */
export function allGuessed(G, playerIds){
  return playerIds.every(id => G.guesses[id] !== undefined);
}

/**
 * Round points by place. The closest guess gets RANK_POINTS[0], the next closest RANK_POINTS[1], and so on.
 * Tied guesses share the places they cover, rounded down, so a tie never gives out more than the table.
 * Missing guesses earn nothing.
 * @param {Array<{playerId: number, pctOff: number|null}>} entries
 * @returns {Map<number, number>}
 */
export function rankPoints(entries){
  const eligible = entries
    .filter(e => e.pctOff !== null)
    .sort((a, b) => /** @type {number} */ (a.pctOff) - /** @type {number} */ (b.pctOff));
  /** @type {Map<number, number>} */
  const points = new Map();
  for(let i = 0; i < eligible.length;){
    let j = i;
    while(j < eligible.length && eligible[j].pctOff === eligible[i].pctOff) j++;
    let pool = 0;
    for(let k = i; k < j; k++) pool += RANK_POINTS[k] ?? 0;
    const each = Math.floor(pool / (j - i));
    for(let k = i; k < j; k++) points.set(eligible[k].playerId, each);
    i = j;
  }
  return points;
}

/**
 * Closes the round. Each guess is scored: by place for practice and multiplayer (see rankPoints), or by
 * closeness for the daily. The closest valid guess wins (ties all win), and nobody wins a round with no
 * valid guess. Totals are updated and the round goes into history.
 * @param {GameState} G
 * @returns {RoundResult}
 */
export function finishRound(G){
  const question = /** @type {Question} */ (G.question);
  /** @type {Array<Omit<RoundEntry, 'points'>>} */
  const measured = G.players.map(p => {
    const g = G.guesses[p.id];
    const value = g?.value ?? null;
    return {
      playerId: p.id,
      guess: g && value !== null ? g.text : null,
      value,
      pctOff: value === null ? null : fractionOff(value, question.answer)
    };
  });
  const byPlace = G.scoring === 'rank' ? rankPoints(measured) : null;
  /** @type {RoundEntry[]} */
  const entries = measured.map(e => ({
    ...e,
    points: byPlace ? (byPlace.get(e.playerId) ?? 0) : pointsFor(e.pctOff)
  }));

  const scored = entries.filter(e => e.pctOff !== null);
  const best = scored.length ? Math.min(...scored.map(e => /** @type {number} */ (e.pctOff))) : null;
  const winners = best === null ? [] : scored.filter(e => e.pctOff === best).map(e => e.playerId);

  for(const e of entries){
    const p = /** @type {GuessPlayer} */ (G.players.find(x => x.id === e.playerId));
    p.totalPoints += e.points;
    if(winners.includes(p.id)) p.wins += 1;
  }

  /** @type {RoundResult} */
  const result = {roundNum: G.roundNum, question, entries, winners};
  G.history.push(result);
  G.stage = 'round-result';
  return result;
}

/**
 * Ends the match after the final round's result has been shown. Kept separate from finishRound so the
 * last round still gets its result screen and pause before the standings appear.
 * @param {GameState} G
 */
export function endGame(G){
  G.stage = 'game-over';
}

/**
 * True once all ROUNDS have been played.
 * @param {GameState} G
 * @returns {boolean}
 */
export function isOver(G){
  return G.history.length >= ROUNDS;
}

/**
 * Final ordering: most round wins first, then the most total points. Players tied on both share a place.
 * @param {GameState} G
 * @returns {Array<GuessPlayer & {place:number}>}
 */
export function standings(G){
  const sorted = G.players.slice().sort((a, b) =>
    (b.wins - a.wins) || (b.totalPoints - a.totalPoints) || (a.id - b.id));
  /** @type {Array<GuessPlayer & {place:number}>} */
  const out = [];
  sorted.forEach((p, i) => {
    const prev = out[i - 1];
    const sameAsPrev = prev && prev.wins === p.wins && prev.totalPoints === p.totalPoints;
    out.push({...p, place: sameAsPrev ? prev.place : i + 1});
  });
  return out;
}

/**
 * The state a given seat is allowed to see. Other players' guesses stay hidden until the round closes,
 * so nobody can copy a rival's answer mid-round.
 * @param {GameState} G
 * @param {number} viewerId
 */
export function viewFor(G, viewerId){
  const closed = G.stage === 'round-result' || G.stage === 'game-over';
  return {
    you: viewerId,
    scoring: G.scoring,
    roundNum: G.roundNum,
    stage: G.stage,
    question: G.question && G.stage !== 'waiting' ? {id: G.question.id, text: G.question.text, label: G.question.label ?? ''} : null,
    players: G.players.map(p => ({
      id: p.id,
      name: p.name,
      wins: p.wins,
      totalPoints: p.totalPoints,
      submitted: G.guesses[p.id] !== undefined
    })),
    yourGuess: G.guesses[viewerId]?.text ?? null,
    yourUnit: G.guesses[viewerId]?.unit ?? '',
    lastResult: G.history[G.history.length - 1] ?? null,
    // Only the closed round's guesses are shown. The open round's stay hidden.
    history: closed ? G.history : G.history.slice(0, -1),
    standings: G.stage === 'game-over' ? standings(G) : null
  };
}

/**
 * ELO change for every seat in a finished match, computed as a pairwise average (see the earlier
 * design notes). The winner gains most and last place loses most.
 * @param {{id:number, elo:number, place:number}[]} seats
 * @returns {Map<number, number>} Rating change per seat id, rounded to a whole number.
 */
export function eloChanges(seats){
  /** @type {Map<number, number>} */
  const deltas = new Map();
  const n = seats.length;
  if(n < 2) return deltas;
  for(const a of seats){
    let sum = 0;
    for(const b of seats){
      if(a.id === b.id) continue;
      const expected = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
      const actual = a.place < b.place ? 1 : a.place === b.place ? 0.5 : 0;
      sum += actual - expected;
    }
    deltas.set(a.id, Math.round(K_FACTOR * sum / (n - 1)));
  }
  return deltas;
}

/**
 * Bot guess: by default within about 30% of the answer. The bots can't see the answer, so they just
 * land in a plausible range. Ranked bots pass their own spread, so stronger bots guess closer.
 * @param {Question} question
 * @param {() => number} [random]
 * @param {number} [spread] How far the guess can land from the answer, as a fraction.
 * @returns {Guess}
 */
export function botGuess(question, random = Math.random, spread = 0.3){
  const factor = 1 + (random() * 2 - 1) * spread;
  const raw = question.answer * factor;
  // Whole-number guesses unless the answer is small enough that a decimal is part of it.
  const value = question.answer >= 10 ? Math.round(raw) : Math.round(raw * 100) / 100;
  return {text: String(value), unit: '', value};
}

/** Largest scale first, so the biggest unit that fits is used. */
const SCALES = [
  {size: 1e15, name: 'quadrillion'},
  {size: 1e12, name: 'trillion'},
  {size: 1e9, name: 'billion'},
  {size: 1e6, name: 'million'},
  {size: 1e3, name: 'thousand'},
];

/**
 * Rounds to 3 significant digits, with thousands separators where needed.
 * @param {number} x
 * @returns {string}
 */
function roundSig(x){
  return Number(x.toPrecision(3)).toLocaleString('en-US', {maximumFractionDigits: 10});
}

/**
 * The name shown for a player. Usernames are often emails, so only the part before the @ is shown.
 * @param {string} username
 * @returns {string}
 */
export function displayName(username){
  return String(username).split('@')[0];
}

/**
 * Exact figure with thousands separators, for the guessing page: 3500000 → "3,500,000".
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n){
  return plainNumber(n);
}

/**
 * Whole numbers unless a decimal matters. Values of 10 or more show no decimals, and smaller values keep up to two.
 * @param {number} n
 * @returns {string}
 */
function plainNumber(n){
  const digits = Math.abs(n) >= 10 ? 0 : 2;
  return n.toLocaleString('en-US', {maximumFractionDigits: digits});
}

/**
 * Results-page format. Numbers from 100 thousand up to 3 significant digits, using the largest unit that fits:
 * 120567 → "121 thousand", 6547655 → "6.55 million", 8849 → "8,849".
 * @param {number} n
 * @returns {string}
 */
export function formatRounded(n){
  // Under 100 thousand, show the exact figure with commas. Rounding only kicks in from 100 thousand up.
  if(Math.abs(n) < 1e5) return plainNumber(n);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const i = SCALES.findIndex(sc => abs >= sc.size);
  if(i === -1){
    // Under a thousand, but rounding can still reach 1000 (e.g. 999.6), so hand that over to the next unit.
    const plain = roundSig(abs);
    if(Number(abs.toPrecision(3)) < 1000) return sign + plain;
    return sign + roundSig(abs / 1e3) + ' thousand';
  }
  let scale = SCALES[i];
  let x = roundSig(abs / scale.size);
  // Rounding can push the number to 1000 of one unit (999,999 → 1000 thousand). Use the next unit up.
  if(Number((abs / scale.size).toPrecision(3)) >= 1000 && i > 0){
    scale = SCALES[i - 1];
    x = roundSig(abs / scale.size);
  }
  return sign + x + ' ' + scale.name;
}
