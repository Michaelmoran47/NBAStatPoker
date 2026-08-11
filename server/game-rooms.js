// @ts-check
// Owns the live GameState for each in-progress room and drives it through the exact
// same engine functions (js/engine.js, js/betting.js) the local single-player client
// uses — just with a requestAction backed by network messages instead of button
// clicks, and a render that broadcasts a per-seat hidden-card-redacted view (viewFor,
// js/state.js) instead of touching a DOM. This is the payoff of keeping that engine
// DOM-free and state-explicit from the start.

import { makeGameFromPlayers, viewFor } from '../js/state.js';
import { playGame, nextRound } from '../js/engine.js';
import { ACTION_TIMEOUT_MS, timeoutAction } from '../js/betting.js';
import { recordForfeit, recordMatchResults } from './matches.js';

// Overridable only for local verification (see .claude/plans) — never set in a real
// deployment; a short grace period defeats the entire point of having one.
const RECONNECT_GRACE_MS = process.env.TEST_GRACE_MS ? Number(process.env.TEST_GRACE_MS) : 60_000;
const NEXT_ROUND_DELAY_MS = 4000;

/**
 * @typedef {Object} LiveGame
 * @property {import('../js/state.js').GameState} G
 * @property {{userId:number, seatId:number}[]} seats Frozen seat->account mapping for this match.
 * @property {Map<number, (action: import('../js/state.js').BettingAction) => void>} resolvers Pending action resolvers, by seat id.
 * @property {Set<number>} disconnectedSeats Seats past their reconnect grace period — auto-fold from here on.
 * @property {Map<number, NodeJS.Timeout>} graceTimers Active grace-period timers, by seat id.
 * @property {Set<number>} forfeitedSeats Seats already recorded as a loss via the forfeit path.
 * @property {(seatId:number, payload:unknown)=>void} sendToSeat
 */

/** @type {Map<string, LiveGame>} */
const liveGames = new Map();

/** @param {string} roomId */
export function hasLiveGame(roomId){ return liveGames.has(roomId); }

/** @param {string} roomId */
export function getLiveGame(roomId){ return liveGames.get(roomId) ?? null; }

// Called once, when a lobby room's host starts it. `seats` must be in the same order
// as the room's seat list — seat id i in the resulting GameState IS index i here, and
// that mapping is frozen for the rest of the match (players can disconnect and
// reconnect, but the seat list itself never changes once a match is underway).
/**
 * @param {string} roomId
 * @param {{userId:number, username:string}[]} seats
 * @param {(seatId:number, payload:unknown)=>void} sendToSeat
 */
export function startLiveGame(roomId, seats, sendToSeat){
  const G = makeGameFromPlayers(seats.map((s,i)=>({id:i, name:s.username, isAI:false})));
  /** @type {LiveGame} */
  const game = {
    G,
    seats: seats.map((s,i)=>({userId:s.userId, seatId:i})),
    resolvers: new Map(),
    disconnectedSeats: new Set(),
    graceTimers: new Map(),
    forfeitedSeats: new Set(),
    sendToSeat
  };
  liveGames.set(roomId, game);

  const render = (/** @type {number|undefined} */ actingId, /** @type {any} */ lastAction) =>
    broadcastState(roomId, actingId, lastAction);
  // Same ACTION_TIMEOUT_MS chess-clock as solo (js/ui.js's requestAction) — the
  // `game.resolvers.get(seatId) === res` check is this driver's equivalent of solo's
  // `state.resolveHuman === res` guard: it's what makes a `game-action` message that
  // arrives just after the clock ran out a harmless no-op (submitAction below finds no
  // matching resolver) instead of resolving whatever this seat's *next* turn is waiting
  // on. Independent of markDisconnected's much longer RECONNECT_GRACE_MS below — that's
  // about detecting a dropped socket, this is about pacing a turn regardless of
  // connection status.
  /** @type {import('../js/state.js').RequestActionFn} */
  const requestAction = (seatId) => {
    if(game.disconnectedSeats.has(seatId)) return Promise.resolve({action:'fold'});
    return new Promise(res => {
      game.resolvers.set(seatId, res);
      setTimeout(()=>{
        if(game.resolvers.get(seatId) === res){
          game.resolvers.delete(seatId);
          const p = /** @type {import('../js/state.js').GamePlayer} */ (game.G.players.find(x=>x.id===seatId));
          res(timeoutAction(game.G, p));
        }
      }, ACTION_TIMEOUT_MS);
    });
  };

  runGame(roomId, game, render, requestAction);
}

/**
 * @param {string} roomId
 * @param {LiveGame} game
 * @param {import('../js/state.js').RenderFn} render
 * @param {import('../js/state.js').RequestActionFn} requestAction
 */
async function runGame(roomId, game, render, requestAction){
  await playGame(game.G, render, requestAction);
  while(liveGames.has(roomId) && game.G.stage !== 'game-over'){
    await sleep(NEXT_ROUND_DELAY_MS);
    if(!liveGames.has(roomId)) return; // room was torn down while we waited
    await nextRound(game.G, render, requestAction);
  }
  if(liveGames.has(roomId)){
    const winners = game.G.gameResult?.winners ?? [];
    recordMatchResults(roomId, game.seats, winners, game.forfeitedSeats);
    // Let the final game-over state reach clients before tearing the room down.
    liveGames.delete(roomId);
  }
}

/** @param {number} ms */
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

/**
 * @param {string} roomId
 * @param {number} [actingId]
 * @param {import('../js/state.js').LastAction} [lastAction]
 */
function broadcastState(roomId, actingId, lastAction){
  const game = liveGames.get(roomId);
  if(!game) return;
  for(const p of game.G.players){
    game.sendToSeat(p.id, {type:'game-state', state: viewFor(game.G, p.id), actingId, lastAction});
  }
}

// Called by the WS layer when an authenticated seat's socket sends a game-action
// message. Returns false if there was no pending request for that seat — i.e. it
// wasn't actually their turn, or the room has no live game — so ws.js can reject the
// message instead of silently accepting an out-of-turn action.
/**
 * @param {string} roomId
 * @param {number} seatId
 * @param {import('../js/state.js').BettingAction} action
 * @returns {boolean}
 */
export function submitAction(roomId, seatId, action){
  const game = liveGames.get(roomId);
  const resolver = game?.resolvers.get(seatId);
  if(!game || !resolver) return false;
  game.resolvers.delete(seatId);
  resolver(action);
  return true;
}

// Starts this seat's reconnect grace period. Doesn't fold them immediately — a real
// network hiccup shouldn't cost a ranked loss — but if the window expires without a
// markReconnected() call, they're auto-folded for the rest of the match and recorded
// as a loss per the locked forfeit policy, independent of how the match ends up.
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

    const resolver = game.resolvers.get(seatId);
    if(resolver){
      game.resolvers.delete(seatId);
      resolver({action:'fold'});
    }

    const userId = game.seats.find(s=>s.seatId===seatId)?.userId;
    if(userId!==undefined) recordForfeit(roomId, userId);
  }, RECONNECT_GRACE_MS);

  game.graceTimers.set(seatId, timer);
}

// Cancels a pending grace-period timer (if any) and returns a fresh sanitized view to
// resync the reconnecting client with — the same shape every other render() call
// sends, so the client needs no special "I just reconnected" handling at all — except
// that if it's genuinely this seat's turn (their action was still pending when they
// dropped), the resync has to say so via actingId, or a reconnecting client has no way
// to know it owes an action: bettingRound() is still awaiting the same original
// requestAction() promise, so nothing will re-prompt them otherwise.
/**
 * @param {string} roomId
 * @param {number} seatId
 * @returns {{state: import('../js/state.js').GameState, actingId: number|undefined}|null}
 */
export function markReconnected(roomId, seatId){
  const game = liveGames.get(roomId);
  if(!game) return null;
  const timer = game.graceTimers.get(seatId);
  if(timer){ clearTimeout(timer); game.graceTimers.delete(seatId); }
  return {
    state: viewFor(game.G, seatId),
    actingId: game.resolvers.has(seatId) ? seatId : undefined
  };
}

// Which room (if any) a given user is currently a live seat in — used on a fresh
// connection to detect "this is actually a reconnect", not a linear-scan concern at
// hobby scale (a handful of concurrent rooms, not thousands).
/** @param {number} userId */
export function findLiveRoomForUser(userId){
  for(const [roomId, game] of liveGames){
    const seat = game.seats.find(s=>s.userId===userId);
    if(seat) return {roomId, seatId: seat.seatId};
  }
  return null;
}
