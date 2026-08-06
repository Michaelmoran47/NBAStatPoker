// @ts-check
// Game state: shape, setup, and the mutations every hand goes through (dealing, antes,
// the running log). `state` is the single mutable object the rest of the app reads and
// writes — swapping it for "the state the server just sent us" is the seam a future
// online-lobby client would plug into.

import { POOL, CATS } from './data.js';
import { shuffle } from './utils.js';

/**
 * One seat at the table.
 * @typedef {Object} GamePlayer
 * @property {number} id
 * @property {string} name
 * @property {boolean} isAI
 * @property {number} chips
 * @property {import('./data.js').NBAPlayer[]} hole
 * @property {boolean} folded
 * @property {number} roundBet
 * @property {boolean} allIn
 */

/**
 * @typedef {Object} CategoryScore
 * @property {number} value
 * @property {number} points
 */

/**
 * @typedef {Object} ComboInfo
 * @property {string[]} won
 * @property {string[]} flushes
 */

/**
 * @typedef {Object} ShowdownResult
 * @property {Object<number, Object<string, CategoryScore>>|null} breakdown
 * @property {Object<number, number>|null} totals
 * @property {number[]} winners
 * @property {boolean} uncontested
 * @property {Object<number, ComboInfo>} [combos]
 * @property {string[]} [bonusLog]
 */

/**
 * @typedef {Object} GameState
 * @property {GamePlayer[]} players
 * @property {number} pot
 * @property {number} handNum
 * @property {string} stage
 * @property {import('./data.js').Category[]} revealedCats
 * @property {import('./data.js').Category[]} [handCats]
 * @property {string[]} log
 * @property {ShowdownResult} [lastResult]
 */

/**
 * @typedef {{action:'fold'}|{action:'call'}|{action:'raise', amount:number}} BettingAction
 */

export const ANTE = 20;
export const START_CHIPS = 1000;

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
      roundBet:0, allIn:false
    })),
    pot:0,
    handNum:0,
    stage:'idle',
    revealedCats:[],
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

export function dealNewHand(){
  const G = state.G;
  G.handNum++;
  G.pot = 0;
  G.stage = 'preflop';
  G.revealedCats = [];
  G.log = [];
  G.players.forEach(p=>{ p.folded=false; p.roundBet=0; p.allIn=false; p.hole=[]; });

  // remove broke players
  G.players = G.players.filter(p=> p.id===0 || p.chips>0);

  const deck = shuffle(POOL);
  let idx=0;
  G.players.forEach(p=>{ p.hole=[deck[idx++], deck[idx++]]; });

  // pick 5 distinct categories for this hand: 3 flop, 1 turn, 1 river
  G.handCats = shuffle(CATS).slice(0,5);

  // collect ante
  G.players.forEach(p=>{
    const ante = Math.min(ANTE, p.chips);
    p.chips -= ante;
    G.pot += ante;
  });
  logMsg(`Hand #${G.handNum}: everyone antes $${ANTE}. Pot: $${G.pot}`);
}
