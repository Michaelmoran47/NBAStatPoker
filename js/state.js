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
 * @property {boolean} eliminated Bank hit $0 after some round this game — permanently
 *   out (a spectator) for the rest of the match, unlike `folded` which resets every
 *   round. Reset to false only when a brand new game is dealt (startNewGame).
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
 * @property {Object<number, number>} values Each active player's combined stat for this round's category — always
 *   populated (including the uncontested case, where there's only one entry) so the UI can show it during the
 *   round-reveal animation regardless of how the round ended.
 * @property {Object<number, number>} payouts How much each winner's chips (already
 *   credited by the time this GameState reaches render()) actually went up by this round
 *   — one entry per id in `winners`. The UI subtracts this back out to show a winner's
 *   pre-round total during the reveal, only "landing" it once the card-to-winner
 *   animation actually arrives, so money and the tally icon never appear before the
 *   animation that's supposed to deliver them.
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
 * `amount` is what was actually paid this action (omitted for fold/check) — the UI
 * labels the chip animation with it so a call and a raise never look ambiguous.
 * @typedef {{playerId:number, action:'fold'|'call'|'raise'|'check', amount?:number}} LastAction
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
 * (or a disconnect grace period expires and it auto-folds them). Both implementations
 * also race that stashed resolver against betting.js's ACTION_TIMEOUT_MS action clock —
 * see timeoutAction() there for what a seat is treated as doing if it runs out.
 * @typedef {(seatId: number) => Promise<BettingAction>} RequestActionFn
 */

export const ANTE = 2;
export const START_CHIPS = 20;
export const ROUNDS = 5;
// The smallest amount a raise must increase the current bet by. Tied to ANTE (not a
// separate hardcoded number) so shrinking/growing the stakes — like START_CHIPS above —
// keeps raises proportionally meaningful instead of silently becoming "must go all-in"
// or "meaninglessly tiny" relative to a player's stack.
export const MIN_RAISE = ANTE;

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
      roundBet:0, allIn:false, eliminated:false, wonCategories:[]
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

  G.players.forEach(p=>{ p.folded=false; p.roundBet=0; p.allIn=false; p.eliminated=false; p.wonCategories=[]; p.hole=[]; });

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
  // Eliminated players stay folded for the rest of the game — this single line is what
  // keeps them out of activePlayers()/betting/scoring everywhere else, without every
  // consumer of `folded` needing to know about elimination separately.
  G.players.forEach(p=>{ p.folded=p.eliminated; p.roundBet=0; p.allIn=false; });

  const cat = G.roundCats[G.round-1];
  G.revealedCats = [cat];

  G.players.forEach(p=>{
    if(p.eliminated) return; // spectators don't ante into a pot they can't win
    const ante = Math.min(ANTE, p.chips);
    p.chips -= ante;
    G.pot += ante;
    // A player whose ante is capped at their whole remaining stack is all-in from the
    // moment the round starts, same as if they'd gone all-in via a bet — otherwise
    // they'd sit at $0 without the tag until their own turn happened to come up.
    if(p.chips===0) p.allIn = true;
  });
  logMsg(G, `--- Round ${G.round}/${ROUNDS}: ${cat.icon} ${cat.label} --- everyone antes $${ANTE}. Pot: $${G.pot}`);
}

// The one place hidden information gets redacted before a GameState is allowed to leave
// the process it's authoritative in. Own hole cards are always visible; everyone else's
// stay hidden until the match is actually over — reusing that existing rule rather than
// inventing a second one. A local single-player client never needs this (there's
// nothing to hide from yourself), but a multiplayer server must call this before
// sending state to any socket, always.
/**
 * @param {GameState} G
 * @param {number} seatId
 * @returns {GameState}
 */
export function viewFor(G, seatId){
  const revealHoles = G.stage==='game-over';
  return {
    ...G,
    players: G.players.map(p=>{
      if(p.id===seatId || revealHoles) return p;
      return {...p, hole: p.hole.map(()=>null)};
    })
  };
}
