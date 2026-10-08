// @ts-check
// Owns the live GameState for each in-progress room and drives it through the same match driver the
// solo client uses (js/engine.js). The difference is in the inputs: answers arrive over the network,
// and each seat is sent its own redacted view (viewFor, js/trivia.js) instead of a DOM render.

import { makeGame, submitGuess, allGuessed, standings, viewFor, pickQuestions, livePool, dailyKey, displayName, ROUNDS } from '../js/trivia.js';
import { QUESTIONS } from '../js/questions.js';
import { playGame } from '../js/engine.js';
import { recordForfeit, recordMatchResults } from './matches.js';
import { recordQuestionAnswers } from './question-stats.js';

// Overridable only for local verification. Never set in a real deployment, since a short grace period
// defeats the point of having one.
const RECONNECT_GRACE_MS = process.env.TEST_GRACE_MS ? Number(process.env.TEST_GRACE_MS) : 60_000;
// How long every seat has to lock in an answer once the question is up. A seat that hasn't answered by
// then counts as no guess and scores 0.
export const GUESS_TIME_MS = 18_000;

/**
 * @typedef {Object} LiveGame
 * @property {string} roomId
 * @property {boolean} ranked Whether this match changes ratings.
 * @property {Map<number, number>|null} eloDeltas Rating change per seat, set once the match ends.
 * @property {import('../js/trivia.js').GameState} G
 * @property {{userId:number, seatId:number}[]} seats Frozen seat->account mapping for this match.
 * @property {Set<number>} disconnectedSeats Seats past their reconnect grace period. No longer waited for.
 * @property {Map<number, NodeJS.Timeout>} graceTimers Active grace-period timers, by seat id.
 * @property {Set<number>} forfeitedSeats Seats already recorded as a loss via the forfeit path.
 * @property {Set<number>} quitSeats Seats that left on purpose. They count as tied for last for ELO.
 * @property {number|null} guessDeadline Epoch ms when the current guess window closes, for the client countdown.
 * @property {(() => void)|null} onGuessChange Re-checks whether the round can close early.
 * @property {(seatId:number, payload:unknown)=>void} sendToSeat
 */

/** @type {Map<string, LiveGame>} */
const liveGames = new Map();

/** @param {string} roomId */
export function hasLiveGame(roomId){ return liveGames.has(roomId); }

// Called once, when a lobby room's host starts it. `seats` order is the seat id order, and that
// mapping is frozen for the rest of the match. Players can disconnect and reconnect, but the seat list
// never changes once a match is underway. Every seat here is a real player — bots only ever appear in
// solo practice (js/bots.js, driven locally by js/engine.js), never in a live server match.
/**
 * @param {string} roomId
 * @param {{userId:number, username:string}[]} seats
 * @param {(seatId:number, payload:unknown)=>void} sendToSeat
 * @param {boolean} [ranked] Whether this match changes ratings. Defaults to casual.
 */
export function startLiveGame(roomId, seats, sendToSeat, ranked = false){
  /** @type {LiveGame} */
  const game = {
    roomId,
    ranked,
    eloDeltas: null,
    G: makeGame(seats.map((s, i) => ({id: i, name: displayName(s.username)}))),
    seats: seats.map((s, i) => ({userId: s.userId, seatId: i})),
    disconnectedSeats: new Set(),
    graceTimers: new Map(),
    forfeitedSeats: new Set(),
    quitSeats: new Set(),
    guessDeadline: null,
    onGuessChange: null,
    sendToSeat
  };
  liveGames.set(roomId, game);
  runGame(game);
}

/**
 * Resolves once every seat that is still connected has answered, or once the guess clock runs out.
 * A seat past its reconnect grace period isn't waited for.
 * @param {LiveGame} game
 * @returns {Promise<void>}
 */
function awaitGuesses(game){
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      game.onGuessChange = null;
      game.guessDeadline = null;
      resolve();
    };
    const timer = setTimeout(finish, GUESS_TIME_MS);
    game.guessDeadline = Date.now() + GUESS_TIME_MS;
    game.onGuessChange = () => {
      const waitingOn = game.G.players.map(p => p.id).filter(id => !game.disconnectedSeats.has(id));
      if(allGuessed(game.G, waitingOn)) finish();
    };
    // The driver's own render() ran before the deadline existed, so re-send now that clients can count down.
    broadcastState(game);
    game.onGuessChange();
  });
}

/**
 * @param {LiveGame} game
 */
async function runGame(game){
  const { roomId } = game;
  const questions = pickQuestions(livePool(QUESTIONS, dailyKey()), ROUNDS);
  await playGame(game.G, {
    questions,
    render: () => broadcastState(game),
    awaitGuesses: () => awaitGuesses(game),
    isAlive: () => liveGames.get(roomId) === game
  });

  if(liveGames.get(roomId) !== game) return; // room was torn down mid-match
  recordQuestionAnswers(game.G.history, new Set(game.seats.map(s => s.seatId)));
  const placeBySeat = new Map(standings(game.G).map(p => [p.id, p.place]));
  // A player who quit is ranked tied for last, whatever their score was, so quitting always costs rating.
  const stayedPlaces = [...placeBySeat].filter(([id]) => !game.quitSeats.has(id)).map(([, place]) => place);
  const lastPlace = stayedPlaces.length ? Math.max(...stayedPlaces) : 1;
  for(const id of game.quitSeats) placeBySeat.set(id, lastPlace);
  game.eloDeltas = recordMatchResults(roomId, game.seats, placeBySeat, game.forfeitedSeats, game.ranked);
  // The driver already sent the game-over state, before ratings were known. Send it again with each
  // seat's rating change. Then tear the room down.
  broadcastState(game);
  liveGames.delete(roomId);
}

/**
 * Sends every seat its own redacted view of the match.
 * @param {LiveGame} game
 */
function broadcastState(game){
  for(const p of game.G.players){
    game.sendToSeat(p.id, {
      type: 'game-state',
      state: viewFor(game.G, p.id),
      deadline: game.guessDeadline,
      eloDeltas: game.eloDeltas ? Object.fromEntries(game.eloDeltas) : null
    });
  }
}

// Called by the WS layer when an authenticated seat's socket sends a 'submit-guess' message. Returns
// false if the room has no live game, guessing is closed, or the seat already answered this round.
/**
 * @param {string} roomId
 * @param {number} seatId
 * @param {import('../js/trivia.js').Guess} guess
 * @returns {boolean}
 */
export function submitPlayerGuess(roomId, seatId, guess){
  const game = liveGames.get(roomId);
  if(!game || !submitGuess(game.G, seatId, guess)) return false;
  broadcastState(game);
  game.onGuessChange?.();
  return true;
}

// The player chose to leave a match in progress. Their seat stops being waited for at once (no grace
// period, since leaving is deliberate), they score 0 each round from now on, and the loss is recorded
// straight away. Returns false if the player isn't in a live match.
/**
 * @param {string} roomId
 * @param {number} userId
 * @returns {boolean}
 */
export function quitSeat(roomId, userId){
  const game = liveGames.get(roomId);
  const seat = game?.seats.find(s => s.userId === userId);
  if(!game || !seat || game.forfeitedSeats.has(seat.seatId)) return false;

  const grace = game.graceTimers.get(seat.seatId);
  if(grace){ clearTimeout(grace); game.graceTimers.delete(seat.seatId); }
  game.disconnectedSeats.add(seat.seatId);
  game.forfeitedSeats.add(seat.seatId);
  game.quitSeats.add(seat.seatId);
  recordForfeit(roomId, userId);
  game.onGuessChange?.();
  broadcastState(game);
  return true;
}

// Starts this seat's reconnect grace period. This doesn't count them out immediately, since a network
// hiccup shouldn't cost a ranked loss. But once the window expires without a markReconnected() call,
// they stop being waited for, score 0 each round, and are recorded as a forfeit loss.
/**
 * @param {string} roomId
 * @param {number} seatId
 */
export function markDisconnected(roomId, seatId){
  const game = liveGames.get(roomId);
  if(!game || game.disconnectedSeats.has(seatId) || game.graceTimers.has(seatId)) return;

  const timer = setTimeout(() => {
    game.graceTimers.delete(seatId);
    game.disconnectedSeats.add(seatId);
    game.forfeitedSeats.add(seatId);

    const userId = game.seats.find(s => s.seatId === seatId)?.userId;
    if(userId !== undefined) recordForfeit(roomId, userId);
    game.onGuessChange?.();
    broadcastState(game);
  }, RECONNECT_GRACE_MS);

  game.graceTimers.set(seatId, timer);
}

// Cancels a pending grace-period timer (if any) and returns a fresh redacted view so the reconnecting
// client can resync. The client needs no special "I just reconnected" path.
/**
 * @param {string} roomId
 * @param {number} seatId
 * @returns {{state: ReturnType<typeof viewFor>, deadline: number|null}|null}
 */
export function markReconnected(roomId, seatId){
  const game = liveGames.get(roomId);
  if(!game) return null;
  const timer = game.graceTimers.get(seatId);
  if(timer){ clearTimeout(timer); game.graceTimers.delete(seatId); }
  return {state: viewFor(game.G, seatId), deadline: game.guessDeadline};
}

// Which room (if any) a given user is currently a live seat in. Used on a fresh connection to tell a
// reconnect apart from a new join.
/** @param {number} userId */
export function findLiveRoomForUser(userId){
  for(const [roomId, game] of liveGames){
    const seat = game.seats.find(s => s.userId === userId);
    if(seat) return {roomId, seatId: seat.seatId};
  }
  return null;
}
