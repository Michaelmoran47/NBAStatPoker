// @ts-check
// Orchestrates a game: deal hole cards once, then run ROUNDS rounds, each being
// reveal-one-card -> bet -> resolve that round's winner(s). Like betting.js, this takes
// the GameState, a `render` callback, and a `requestAction` callback as explicit
// arguments rather than reaching into any shared state — a local single-player client
// and a multiplayer server both drive the exact same functions, just with different
// GameState instances and different requestAction implementations.

import { logMsg, activePlayers, startNewGame, startRound, ROUNDS } from './state.js';
import { bettingRound } from './betting.js';
import { scoreCategories } from './scoring.js';
import { sleep } from './utils.js';

/**
 * @param {import('./state.js').GameState} G
 * @param {import('./state.js').RenderFn} render
 * @param {import('./state.js').RequestActionFn} requestAction
 * @returns {Promise<void>}
 */
export async function playGame(G, render, requestAction){
  startNewGame(G);
  render();
  await sleep(400);
  await playRound(G, render, requestAction);
}

/**
 * @param {import('./state.js').GameState} G
 * @param {import('./state.js').RenderFn} render
 * @param {import('./state.js').RequestActionFn} requestAction
 * @returns {Promise<void>}
 */
export async function playRound(G, render, requestAction){
  startRound(G);
  render();
  await sleep(300);
  await bettingRound(G, render, requestAction);
  await resolveRound(G, render);
}

// Called when the human clicks "Next Round" (or, on the server, when every seat has
// acknowledged the previous round's result).
/**
 * @param {import('./state.js').GameState} G
 * @param {import('./state.js').RenderFn} render
 * @param {import('./state.js').RequestActionFn} requestAction
 * @returns {Promise<void>}
 */
export async function nextRound(G, render, requestAction){
  G.round += 1;
  await playRound(G, render, requestAction);
}

/**
 * @param {import('./state.js').GameState} G
 * @param {import('./state.js').RenderFn} render
 * @returns {Promise<void>}
 */
export async function resolveRound(G, render){
  const cat = G.roundCats[G.round-1];
  const active = activePlayers(G);

  if(active.length===1){
    const winner = active[0];
    winner.chips += G.pot;
    winner.wonCategories.push(cat);
    logMsg(G, `${winner.name} wins the ${cat.label} card uncontested (+1 🃏).`);
    G.roundResult = {category:cat, winners:[winner.id], uncontested:true, values:null};
  } else {
    const {breakdown, totals} = scoreCategories(active, [cat]);
    const best = Math.max(...Object.values(totals));
    const winners = active.filter(p=>totals[p.id]===best).map(p=>p.id);
    const share = Math.floor(G.pot/winners.length);

    /** @type {Object<number, number>} */
    const values = {};
    active.forEach(p=>{ values[p.id] = breakdown[p.id][cat.key].value; });

    winners.forEach(id=>{
      const player = /** @type {import('./state.js').GamePlayer} */ (G.players.find(p=>p.id===id));
      player.chips += share;
      player.wonCategories.push(cat);
    });

    logMsg(G, `${winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ')} won the ${cat.label} card (+1 🃏 each)!`);
    G.roundResult = {category:cat, winners, uncontested:false, values};
  }

  if(G.round>=ROUNDS){
    const best = Math.max(...G.players.map(p=>p.wonCategories.length));
    const gameWinners = G.players.filter(p=>p.wonCategories.length===best).map(p=>p.id);
    G.gameResult = {winners: gameWinners};
    G.stage = 'game-over';
    logMsg(G, `Game over! ${gameWinners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ')} win the match with ${best} 🃏!`);
  } else {
    G.stage = 'round-result';
  }
  render();
}
