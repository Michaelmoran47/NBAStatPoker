// @ts-check
// Game state: shape, setup, and the mutations a game goes through. `state` is the single
// mutable object the rest of the app reads and writes — swapping it for "the state the
// server just sent us" is the seam a future online-lobby client would plug into.
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
 * @property {number} cardsWon Community cards won so far this game.
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

export const ANTE = 20;
export const START_CHIPS = 1000;
export const ROUNDS = 3;

/**
 * @typedef {Object} AppState
 * @property {GameState|null} G Current game, or null before one has started.
 * @property {((result: BettingAction) => void)|null} resolveHuman Pending resolver waiting on the human's next action.
 * @property {boolean} handInProgress
 */

// state.G is the current game (null before a game starts). state.resolveHuman is the
// pending Promise resolver waiting on the human player's next action, if any.
/** @type {AppState} */
export const state = {
  G: null,
  resolveHuman: null,
  handInProgress: false
};

/**
 * @param {number} numOpponents
 * @returns {GameState}
 */
export function makeGame(numOpponents){
  const names = ["You"];
  for(let i=1;i<=numOpponents;i++) names.push("CPU "+i);
  return {
    players: names.map((n,i)=>({
      id:i, name:n, isAI:i!==0, chips:START_CHIPS, hole:[], folded:false,
      roundBet:0, allIn:false, cardsWon:0
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

/** @param {string} m */
export function logMsg(m){
  const G = state.G;
  G.log.unshift(m);
  if(G.log.length>60) G.log.pop();
}

/** @returns {GamePlayer[]} */
export function activePlayers(){ return state.G.players.filter(p=>!p.folded); }

// Deals hole cards once for the whole game and picks the ROUNDS categories that will be
// revealed one per round. Called once at the start of a game, never between rounds.
export function startNewGame(){
  const G = state.G;
  G.gameNum++;
  G.pot = 0;
  G.round = 1;
  G.stage = 'idle';
  G.log = [];
  G.roundResult = undefined;
  G.gameResult = undefined;

  // remove broke players between games (the human seat always stays)
  G.players = G.players.filter(p=> p.id===0 || p.chips>0);

  G.players.forEach(p=>{ p.folded=false; p.roundBet=0; p.allIn=false; p.cardsWon=0; p.hole=[]; });

  const deck = shuffle(POOL);
  let idx=0;
  G.players.forEach(p=>{ p.hole=[deck[idx++], deck[idx++]]; });

  G.roundCats = shuffle(CATS).slice(0, ROUNDS);
  G.revealedCats = [];

  logMsg(`Game #${G.gameNum}: hole cards dealt for a ${ROUNDS}-round match.`);
}

// Reveals the current round's single community card, collects antes into a fresh pot,
// and resets folded/betting state so everyone gets to act on the new card.
export function startRound(){
  const G = state.G;
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
  logMsg(`--- Round ${G.round}/${ROUNDS}: ${cat.icon} ${cat.label} --- everyone antes $${ANTE}. Pot: $${G.pot}`);
}
