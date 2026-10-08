// @ts-check
// Named CPU opponents for solo "Practice vs Bots" matches (see startSolo in js/ui.js). Grouped into
// three difficulty tiers — rather than one flat list all guessing within the same ~30% band — so a
// practice match can be anywhere from a breeze to genuinely sharp depending on who you're matched
// against.

/**
 * @typedef {Object} BotProfile
 * @property {string} name Shown on the scoreboard, like a real player's name.
 * @property {number} spread How far a guess can land from the answer, as a fraction (0.1 = within 10%).
 */

/**
 * Builds one difficulty tier: `names.length` bots stepping evenly from `spreadStart` down by
 * `spreadStep` per bot.
 * @param {string[]} names
 * @param {{spreadStart:number, spreadStep:number}} ramp
 * @returns {BotProfile[]}
 */
function tier(names, {spreadStart, spreadStep}){
  return names.map((name, i) => ({
    name,
    spread: Math.round((spreadStart - i * spreadStep) * 1000) / 1000,
  }));
}

// You face two bots at once in a practice match, and rounds score by whoever's *closest* — so what
// matters isn't one bot's average error, it's the better of the two. For a uniform spread s, the
// expected error of the closer of two bots is only s/3 (the min of two draws beats the average by a
// lot). An earlier pass at these numbers (DUMB topping out at 1.3, AVERAGE at 0.75) still let the
// better of two DUMB bots land within ~35% on average — still sharp enough to outguess an honest human
// on an obscure question often enough to feel unfair. DUMB and AVERAGE are both pushed wider again here.
const DUMB = tier(
  ['Gilbert', 'Paul', 'Lester', 'Clarissa', 'Doug'],
  {spreadStart: 2.0, spreadStep: 0.2}, // 2.0 → 1.2: frequently off by 100%+, easy wins
);
const AVERAGE = tier(
  ['Franklin', 'Charles', 'Victoria', 'Ramish', 'Edward'],
  {spreadStart: 1.1, spreadStep: 0.1}, // 1.1 → 0.7: beatable with a decent guess
);
const SMART = tier(
  // Named after historic scientists, since this tier is meant to be a genuine challenge.
  ['Newton', 'Darwin', 'Curie', 'Einstein', 'Copernicus'],
  {spreadStart: 0.22, spreadStep: 0.03}, // 0.22 → 0.10: sharp
);

/**
 * 15 bots across three named difficulty tiers (see the ramps above), picked from freely for every
 * practice match so the same two opponents don't show up every time.
 * @type {BotProfile[]}
 */
export const BOT_ROSTER = [...DUMB, ...AVERAGE, ...SMART];
