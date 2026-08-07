// @ts-check
// In-memory lobby room registry (phase 2). Rooms exist purely to get players seated
// and ready — no game logic here at all. That's phase 3, which will attach a real
// per-room GameState (see js/state.js) once a room actually starts.

import crypto from 'node:crypto';

/**
 * @typedef {Object} Seat
 * @property {number} userId
 * @property {string} username
 * @property {boolean} ready
 */

/**
 * @typedef {Object} Room
 * @property {string} id
 * @property {number} hostUserId
 * @property {number} maxSeats
 * @property {Seat[]} seats
 * @property {'waiting'|'started'} status
 * @property {number} createdAt
 */

/** @type {Map<string, Room>} */
export const rooms = new Map();

// Matches the single-player game's "you + up to 2 opponents" ceiling for now.
export const MAX_SEATS = 3;

/**
 * @param {number} hostUserId
 * @param {string} hostUsername
 * @returns {Room}
 */
export function createRoom(hostUserId, hostUsername){
  // A real UUID, not an incrementing counter — match_results.room_id has to stay
  // unique across server restarts (the counter resets to 1 every boot, but the
  // database doesn't), or an old match's rows and a new match's rows can collide
  // under the same id and get conflated in the (future) leaderboard.
  const id = crypto.randomUUID();
  /** @type {Room} */
  const room = {
    id,
    hostUserId,
    maxSeats: MAX_SEATS,
    seats: [{userId: hostUserId, username: hostUsername, ready: false}],
    status: 'waiting',
    createdAt: Date.now()
  };
  rooms.set(id, room);
  return room;
}

/** @returns {Room[]} Rooms still open to join. */
export function listOpenRooms(){
  return [...rooms.values()].filter(r => r.status === 'waiting' && r.seats.length < r.maxSeats);
}

/**
 * @param {string} roomId
 * @param {number} userId
 * @param {string} username
 * @returns {Room}
 */
export function joinRoom(roomId, userId, username){
  const room = rooms.get(roomId);
  if(!room) throw new Error('That room no longer exists.');
  if(room.status !== 'waiting') throw new Error('That game has already started.');
  if(room.seats.some(s => s.userId === userId)) return room; // already seated, no-op
  if(room.seats.length >= room.maxSeats) throw new Error('That room is full.');
  room.seats.push({userId, username, ready: false});
  return room;
}

// Removes a player from a room. If the host leaves, or the room becomes empty, the
// whole room is torn down rather than left to limp along without its host.
/**
 * @param {string} roomId
 * @param {number} userId
 * @returns {Room|null} The room if it still exists, null if it was just removed.
 */
export function leaveRoom(roomId, userId){
  const room = rooms.get(roomId);
  if(!room) return null;
  room.seats = room.seats.filter(s => s.userId !== userId);
  if(room.seats.length === 0 || room.hostUserId === userId){
    rooms.delete(roomId);
    return null;
  }
  return room;
}

/**
 * @param {string} roomId
 * @param {number} userId
 * @returns {Room}
 */
export function toggleReady(roomId, userId){
  const room = rooms.get(roomId);
  if(!room) throw new Error('That room no longer exists.');
  const seat = room.seats.find(s => s.userId === userId);
  if(!seat) throw new Error('You are not seated in that room.');
  seat.ready = !seat.ready;
  return room;
}

// Host-only. Requires at least 2 seated players (matches the single-player game's
// minimum of "you + 1 opponent") and everyone, including the host, ready.
/**
 * @param {string} roomId
 * @param {number} userId
 * @returns {Room}
 */
export function startRoom(roomId, userId){
  const room = rooms.get(roomId);
  if(!room) throw new Error('That room no longer exists.');
  if(room.hostUserId !== userId) throw new Error('Only the host can start the game.');
  if(room.seats.length < 2) throw new Error('Need at least 2 players to start.');
  if(!room.seats.every(s => s.ready)) throw new Error('Not everyone is ready yet.');
  room.status = 'started';
  return room;
}
