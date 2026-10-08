// @ts-check
// Persists match outcomes and ELO. A forfeit (reconnect grace period expiring) is recorded the instant
// it happens. The locked policy is "not reconnecting counts as a loss regardless of how the match
// eventually turns out". So recordMatchResults(), run at the natural end of a match, skips anyone
// already recorded that way rather than double-counting them. ELO still applies to a forfeiting seat,
// since they finish the match in last place.
//
// Only ranked matches change ELO. Lobby (casual) matches still record a win or loss, but leave
// ratings alone.

import { db } from './db.js';
import { eloChanges, START_ELO } from '../js/trivia.js';

const insertResult = db.prepare(
  'INSERT INTO match_results (user_id, room_id, result, elo_delta) VALUES (?, ?, ?, ?)'
);
const setForfeitDelta = db.prepare(
  'UPDATE match_results SET elo_delta = ? WHERE user_id = ? AND room_id = ? AND elo_delta IS NULL'
);
const getElo = db.prepare('SELECT elo FROM users WHERE id = ?');
const setElo = db.prepare('UPDATE users SET elo = ? WHERE id = ?');

/**
 * Current rating for a user, or the starting rating if the row isn't found.
 * @param {number} userId
 * @returns {number}
 */
export function getRating(userId){
  return /** @type {{elo:number}|undefined} */ (getElo.get(userId))?.elo ?? START_ELO;
}

/**
 * @param {string} roomId
 * @param {number} userId
 */
export function recordForfeit(roomId, userId){
  insertResult.run(userId, roomId, 'loss', null);
}

/**
 * Writes each seat's result row, and applies ELO when the match is ranked.
 * @param {string} roomId
 * @param {{userId:number, seatId:number}[]} seats Every seat that played this match.
 * @param {Map<number, number>} placeBySeat Final place per seat id (1 = match winner; ties share a place).
 * @param {Set<number>} alreadyForfeitedSeatIds Seat ids already recorded via recordForfeit.
 * @param {boolean} ranked Whether this match changes ratings.
 * @returns {Map<number, number>} Rating change per seat id. Empty for a casual match.
 */
export function recordMatchResults(roomId, seats, placeBySeat, alreadyForfeitedSeatIds, ranked){
  const rated = seats.map(seat => ({
    id: seat.seatId,
    userId: seat.userId,
    elo: getRating(seat.userId),
    place: placeBySeat.get(seat.seatId) ?? seats.length
  }));
  const deltas = ranked ? eloChanges(rated) : new Map();

  for(const r of rated){
    const delta = ranked ? (deltas.get(r.id) ?? 0) : null;
    if(ranked) setElo.run(Math.max(0, r.elo + (delta ?? 0)), r.userId);
    // A forfeit row was written when the player left, before the rating was known. Fill in its change now.
    if(alreadyForfeitedSeatIds.has(r.id)){
      if(ranked) setForfeitDelta.run(delta, r.userId, roomId);
      continue;
    }
    insertResult.run(r.userId, roomId, r.place === 1 ? 'win' : 'loss', delta);
  }
  return deltas;
}
