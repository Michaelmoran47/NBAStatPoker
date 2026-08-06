// Game state: shape, setup, and the mutations every hand goes through (dealing, antes,
// the running log). `state` is the single mutable object the rest of the app reads and
// writes — swapping it for "the state the server just sent us" is the seam a future
// online-lobby client would plug into.

import { POOL, CATS } from './data.js';
import { shuffle } from './utils.js';

export const ANTE = 20;
export const START_CHIPS = 1000;

// state.G is the current game (null before a game starts). state.resolveHuman is the
// pending Promise resolver waiting on the human player's next action, if any.
export const state = {
  G: null,
  resolveHuman: null,
  handInProgress: false
};

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

export function logMsg(m){
  const G = state.G;
  G.log.unshift(m);
  if(G.log.length>60) G.log.pop();
}

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
