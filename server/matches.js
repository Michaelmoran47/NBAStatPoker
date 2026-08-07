// @ts-check
// Persists match outcomes for the (future, phase 5) leaderboard. One row per player
// per completed match. A forfeit (reconnect grace period expiring) is recorded the
// instant it happens — the locked policy is "not reconnecting counts as a loss
// regardless of how the match eventually turns out" — so recordMatchResults(), run at
// the natural end of a match, skips anyone already recorded that way rather than
// double-counting them.

import { db } from './db.js';

const insertResult = db.prepare(
  'INSERT INTO match_results (user_id, room_id, result) VALUES (?, ?, ?)'
);

/**
 * @param {string} roomId
 * @param {number} userId
 */
export function recordForfeit(roomId, userId){
  insertResult.run(userId, roomId, 'loss');
}

/**
 * @param {string} roomId
 * @param {{userId:number, seatId:number}[]} seats Every seat that played this match.
 * @param {number[]} winnerSeatIds Seat ids from GameState.gameResult.winners.
 * @param {Set<number>} alreadyForfeitedSeatIds Seat ids already recorded via recordForfeit.
 */
export function recordMatchResults(roomId, seats, winnerSeatIds, alreadyForfeitedSeatIds){
  for(const seat of seats){
    if(alreadyForfeitedSeatIds.has(seat.seatId)) continue;
    const result = winnerSeatIds.includes(seat.seatId) ? 'win' : 'loss';
    insertResult.run(seat.userId, roomId, result);
  }
}
