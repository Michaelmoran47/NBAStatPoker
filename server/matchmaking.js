// @ts-check
// Ranked queue. Players wait here until enough players with similar ratings are available. The rating
// window starts narrow and widens the longer someone waits, so a player is never stuck forever. A match
// starts at MAX_PLAYERS, or once a player has waited BOT_FILL_AFTER_MS: then any open seats up to
// BOT_MATCH_SIZE are filled with bots (see bots.js), so a lone player still gets a match. The queue holds
// no game state. Once a group is picked, ws.js turns it into an ordinary room and starts it as a ranked match.
import { pickBots } from './bots.js';

/**
 * @typedef {Object} QueueEntry
 * @property {number} userId
 * @property {string} username
 * @property {number} elo Rating when the player joined the queue.
 * @property {number} joinedAt Epoch ms.
 * @property {any} conn The player's websocket, so ws.js can attach them to the new room.
 */

export const MAX_PLAYERS = 6;
export const MAX_WAIT_MS = 45_000;
// How long a player waits for a human partner before bots fill the match.
export const BOT_FILL_AFTER_MS = 12_000;
// Every ranked match has at least this many seats, human or bot.
export const BOT_MATCH_SIZE = 3;
const BASE_WINDOW = 100;
const WIDEN_EVERY_MS = 10_000;
const WIDEN_STEP = 50;
const TICK_MS = 2_000;

/** @type {QueueEntry[]} */
const queue = [];

/**
 * @param {Omit<QueueEntry, 'joinedAt'>} entry
 * @returns {boolean} False if this user is already queued.
 */
export function enqueue(entry){
  if(queue.some(q => q.userId === entry.userId)) return false;
  queue.push({...entry, joinedAt: Date.now()});
  return true;
}

/** @param {number} userId */
export function dequeue(userId){
  const i = queue.findIndex(q => q.userId === userId);
  if(i !== -1) queue.splice(i, 1);
}

/** @param {number} userId */
export function isQueued(userId){
  return queue.some(q => q.userId === userId);
}

/**
 * How far from a player's rating a partner may be. It widens with wait time.
 * @param {QueueEntry} entry
 * @param {number} now
 */
function windowFor(entry, now){
  return BASE_WINDOW + Math.floor((now - entry.joinedAt) / WIDEN_EVERY_MS) * WIDEN_STEP;
}

/**
 * Picks a group for the longest-waiting player and removes it from the queue. Two players are only
 * compatible if each is inside the other's window, so a player with a wide window can't pull in
 * someone who's still too far apart.
 * @param {(group: QueueEntry[], bots: import('./bots.js').BotProfile[]) => void} onMatch
 * @param {number} now
 */
function tick(onMatch, now){
  for(const seed of queue.slice()){
    if(!queue.includes(seed)) continue;
    // After the wait limit, rating stops mattering. Otherwise a player at one end of the rating spread
    // could wait forever, since the window never reaches the other end.
    const waitedLongEnough = now - seed.joinedAt >= MAX_WAIT_MS;
    const botFill = now - seed.joinedAt >= BOT_FILL_AFTER_MS;
    const others = queue
      .filter(q => q !== seed && (waitedLongEnough || Math.abs(q.elo - seed.elo) <= Math.max(windowFor(seed, now), windowFor(q, now))))
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const group = [seed, ...others].slice(0, MAX_PLAYERS);
    if(group.length >= MAX_PLAYERS || botFill){
      // Bots are only added once the seed has waited, and only to fill seats the humans left open.
      const averageElo = group.reduce((sum, p) => sum + p.elo, 0) / group.length;
      const bots = pickBots(averageElo, BOT_MATCH_SIZE - group.length);
      for(const p of group) queue.splice(queue.indexOf(p), 1);
      onMatch(group, bots);
    }
  }
}

/** @param {(group: QueueEntry[], bots: import('./bots.js').BotProfile[]) => void} onMatch Called with each group that's ready to play, and the bots filling its open seats. */
export function startMatchmaking(onMatch){
  setInterval(() => tick(onMatch, Date.now()), TICK_MS);
}
