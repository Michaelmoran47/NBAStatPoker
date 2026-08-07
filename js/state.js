// @ts-check
// Game state: shape, setup, and the mutations a game goes through. Every function here
// takes the GameState it operates on explicitly — nothing in this file (or betting.js /
// engine.js) reaches into a module-level singleton any more. That's what lets the exact
// same functions run a local single-player game (one GameState, owned by the client) and
// a multiplayer one (many GameStates, one per room, owned by the server) without forking
// the logic in two places.
//
// Play style: each player is dealt hole cards once and keeps them for the whole game.
// The game runs for ROUNDS rounds; each round reveals one community stat category, has
// one betting round, then awards that round's pot (and a community card) to whoever has
// the higher combined stat. After ROUNDS rounds, whoever holds the most community cards
// wins the match.

import { POOL, CATS } from './data.js';
import { shuffle } from './utils.js';

/**
 * One seat at the table.
 * @typedef {Object} GamePlayer
 * @property {number} id
 * @property {string} name
 * @property {boolean} isAI
 * @property {number} chips
 * @property {import('./data.js').NBAPlayer[]} hole Dealt once per game, kept the whole match.
 * @property {boolean} folded Resets every round.
 * @property {number} roundBet
 * @property {boolean} allIn
 * @property {import('./data.js').Category[]} wonCategories Community cards won so far
 *   this game, in the order they were won — the category's own icon is what gets shown
 *   next to a player's name, not a generic card glyph, so this has to be the categories
 *   themselves rather than just a count.
 */

/**
 * @typedef {Object} CategoryScore
 * @property {number} value
 * @property {number} points
 */

/**
 * The outcome of a single round's community-card contest.
 * @typedef {Object} RoundResult
 * @property {import('./data.js').Category} category
 * @property {number[]} winners Player ids who won this round's card.
 * @property {boolean} uncontested True if everyone else folded.
 * @property {Object<number, number>|null} values Each active player's combined stat for this round's category.
 */

/**
 * The final outcome of a game, once all rounds are played.
 * @typedef {Object} GameResult
 * @property {number[]} winners Player ids with the most community cards.
 */

/**
 * @typedef {Object} GameState
 * @property {GamePlayer[]} players
 * @property {number} pot Current round's pot.
 * @property {number} gameNum
 * @property {number} round Current round, 1-based.
 * @property {import('./data.js').Category[]} roundCats The ROUNDS categories for this game, one per round.
 * @property {import('./data.js').Category[]} revealedCats The current round's single revealed category.
 * @property {string} stage 'idle' | 'betting' | 'round-result' | 'game-over'
 * @property {string[]} log
 * @property {RoundResult} [roundResult]
 * @property {GameResult} [gameResult]
 */

/**
 * @typedef {{action:'fold'}|{action:'call'}|{action:'raise', amount:number}} BettingAction
 */

/**
 * What just happened, passed to `render` on the single call right after an action is
 * applied — lets the UI play a one-shot animation (chip flight, fold fade, pot bump,
 * check tap) without betting.js/engine.js touching the DOM themselves. 'check' is a
 * zero-cost 'call' — betting.js resolves the distinction before render ever sees it.
 * @typedef {{playerId:number, action:'fold'|'call'|'raise'|'check'}} LastAction
 */

/**
 * The shape every render callback passed into engine.js/betting.js must have.
 * @typedef {(actingId?: number, lastAction?: LastAction) => void} RenderFn
 */

/**
 * Asks whoever's actually behind seat `seatId` for their next action and resolves once
 * they answer. The single-player client implements this with a resolver stashed until
 * a button click fires; the multiplayer server implements it with a resolver stashed
 * per room-and-seat until the right authenticated socket sends a 'game-action' message
 * (or a disconnect grace period expires and it auto-folds them).
 * @typedef {(seatId: number) => Promise<BettingAction>} RequestActionFn
 */

export const ANTE = 20;
export const START_CHIPS = 1000;
export const ROUNDS = 3;

/**
 * @param {number} numOpponents
 * @returns {GameState}
 */
export function makeGame(numOpponents){
  const names = ["You"];
  for(let i=1;i<=numOpponents;i++) names.push("CPU "+i);
  return makeGameFromPlayers(names.map((n,i)=>({id:i, name:n, isAI:i!==0})));
}

// The generic constructor behind makeGame — takes an arbitrary list of seats (id, name,
// isAI) rather than assuming "seat 0 is the human, the rest are CPUs". A multiplayer
// room builds its GameState by passing every connected player's own id/username here,
// all isAI:false, since there are no CPU seats once real people fill a room.
/**
 * @param {{id:number, name:string, isAI:boolean}[]} seats
 * @returns {GameState}
 */
export function makeGameFromPlayers(seats){
  return {
    players: seats.map(s=>({
      id:s.id, name:s.name, isAI:s.isAI, chips:START_CHIPS, hole:[], folded:false,
      roundBet:0, allIn:false, wonCategories:[]
    })),
    pot:0,
    gameNum:0,
    round:1,
    roundCats:[],
    revealedCats:[],
    stage:'idle',
    log:[]
  };
}

/**
 * @param {GameState} G
 * @param {string} m
 */
export function logMsg(G, m){
  G.log.unshift(m);
  if(G.log.length>60) G.log.pop();
}

/**
 * @param {GameState} G
 * @returns {GamePlayer[]}
 */
export function activePlayers(G){ return G.players.filter(p=>!p.folded); }

// Deals hole cards once for the whole game and picks the ROUNDS categories that will be
// revealed one per round. Called once at the start of a game, never between rounds.
/** @param {GameState} G */
export function startNewGame(G){
  G.gameNum++;
  G.pot = 0;
  G.round = 1;
  G.stage = 'idle';
  G.log = [];
  G.roundResult = undefined;
  G.gameResult = undefined;

  // remove broke players between games (seat 0 — single-player's human — always stays;
  // multiplayer games don't currently span multiple makeGame() calls, so this mainly
  // matters for the local single-player client)
  G.players = G.players.filter(p=> p.id===0 || p.chips>0);

  G.players.forEach(p=>{ p.folded=false; p.roundBet=0; p.allIn=false; p.wonCategories=[]; p.hole=[]; });

  const deck = shuffle(POOL);
  let idx=0;
  G.players.forEach(p=>{ p.hole=[deck[idx++], deck[idx++]]; });

  G.roundCats = shuffle(CATS).slice(0, ROUNDS);
  G.revealedCats = [];

  logMsg(G, `Game #${G.gameNum}: hole cards dealt for a ${ROUNDS}-round match.`);
}

// Reveals the current round's single community card, collects antes into a fresh pot,
// and resets folded/betting state so everyone gets to act on the new card.
/** @param {GameState} G */
export function startRound(G){
  G.pot = 0;
  G.stage = 'betting';
  G.players.forEach(p=>{ p.folded=false; p.roundBet=0; p.allIn=false; });

  const cat = G.roundCats[G.round-1];
  G.revealedCats = [cat];

  G.players.forEach(p=>{
    const ante = Math.min(ANTE, p.chips);
    p.chips -= ante;
    G.pot += ante;
  });
  logMsg(G, `--- Round ${G.round}/${ROUNDS}: ${cat.icon} ${cat.label} --- everyone antes $${ANTE}. Pot: $${G.pot}`);
}

// The one place hidden information gets redacted before a GameState is allowed to leave
// the process it's authoritative in. Own hole cards are always visible; everyone else's
// are hidden until the same moment the UI already reveals them at — round-result or
// game-over — reusing that existing rule rather than inventing a second one. A local
// single-player client never needs this (there's nothing to hide from yourself), but a
// multiplayer server must call this before sending state to any socket, always.
/**
 * @param {GameState} G
 * @param {number} seatId
 * @returns {GameState}
 */
export function viewFor(G, seatId){
  const revealHoles = G.stage==='round-result' || G.stage==='game-over';
  return {
    ...G,
    players: G.players.map(p=>{
      if(p.id===seatId || revealHoles) return p;
      return {...p, hole: p.hole.map(()=>null)};
    })
  };
}
