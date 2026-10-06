// @ts-check
// The bot roster for ranked matchmaking. When a player has waited long enough without a human partner,
// matchmaking fills the seats with bots so a match can always start, even if nobody else is online.
//
// Bots have no account, so nothing about them is stored: their rating is fixed here, they never change
// rating, and their results are never written to match_results. Each bot's rating also sets how precise
// its guesses are. Stronger bots land closer to the answer, so a match against them feels like a match
// against real players at that level.

/**
 * @typedef {Object} BotProfile
 * @property {string} username Shown on the scoreboard, like a real player's name.
 * @property {number} elo Fixed rating, used for matchmaking and the ELO maths of the match.
 * @property {number} spread How far a guess can land from the answer, as a fraction (0.1 = within 10%).
 */

const BOT_NAMES = [
  'Ace_Hoops', 'Bench_Warmer', 'Buzzer_Beat', 'Cold_Brew', 'Dunk_Tank', 'Fast_Break', 'Give_And_Go',
  'Hook_Shot', 'Iron_Man', 'Jump_Ball', 'Key_Stat', 'Lay_Up', 'Mid_Range', 'Net_Cutter', 'Off_Ball',
  'Pick_Roll', 'Quick_Hands', 'Rim_Rattler', 'Screen_Time', 'Triple_Threat', 'Ankle_Breaker', 'Bank_Shot',
  'Clutch_City', 'Double_Team', 'Fadeaway', 'Glass_Cleaner', 'High_Post', 'Isolation', 'Just_Trey', 'Knee_Pads',
];

const LOWEST_ELO = 900;
const ELO_STEP = 20;

/**
 * 30 bots spread evenly from 900 up to 1480, so every rating band has a bot close to it.
 * The 0.32 → 0.10 spread means the weakest bot guesses within 32% and the strongest within 10%.
 * @type {BotProfile[]}
 */
export const BOT_ROSTER = BOT_NAMES.map((username, i) => {
  const elo = LOWEST_ELO + i * ELO_STEP;
  const spread = 0.32 - ((elo - LOWEST_ELO) / (BOT_NAMES.length * ELO_STEP)) * 0.22;
  return {username, elo, spread: Math.round(spread * 1000) / 1000};
});

/**
 * Picks the bots closest in rating to the target. A little randomness keeps the same bots from
 * showing up in every match.
 * @param {number} targetElo Average rating of the human players in the match.
 * @param {number} count How many bots to pick. Zero returns an empty list.
 * @param {() => number} [random]
 * @returns {BotProfile[]}
 */
export function pickBots(targetElo, count, random = Math.random){
  if(count <= 0) return [];
  return BOT_ROSTER
    .map(bot => ({bot, score: Math.abs(bot.elo - targetElo) + random() * 120}))
    .sort((a, b) => a.score - b.score)
    .slice(0, count)
    .map(x => x.bot);
}
