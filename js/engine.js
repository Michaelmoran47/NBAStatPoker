// @ts-check
// Orchestrates a game: deal hole cards once, then run ROUNDS rounds, each being
// reveal-one-card -> bet -> resolve that round's winner(s). Like betting.js, this takes
// a `render` callback rather than touching the DOM directly, so the same flow could
// later be driven by a server loop instead of a browser event loop.

import { state, logMsg, activePlayers, startNewGame, startRound, ROUNDS } from './state.js';
import { bettingRound } from './betting.js';
import { scoreCategories } from './scoring.js';
import { sleep } from './utils.js';

/**
 * @param {(actingId?: number) => void} render
 * @returns {Promise<void>}
 */
export async function playGame(render){
  state.handInProgress = true;
  startNewGame();
  render();
  await sleep(400);
  await playRound(render);
}

/**
 * @param {(actingId?: number) => void} render
 * @returns {Promise<void>}
 */
export async function playRound(render){
  startRound();
  render();
  await sleep(300);
  await bettingRound(render);
  await resolveRound(render);
  state.handInProgress = state.G.stage !== 'game-over';
}

// Called when the human clicks "Next Round".
/**
 * @param {(actingId?: number) => void} render
 * @returns {Promise<void>}
 */
export async function nextRound(render){
  state.G.round += 1;
  await playRound(render);
}

/**
 * @param {(actingId?: number) => void} render
 * @returns {Promise<void>}
 */
export async function resolveRound(render){
  const G = state.G;
  const cat = G.roundCats[G.round-1];
  const active = activePlayers();

  if(active.length===1){
    const winner = active[0];
    winner.chips += G.pot;
    winner.cardsWon += 1;
    logMsg(`${winner.name} wins the ${cat.label} card uncontested (+1 🃏).`);
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
      player.cardsWon += 1;
    });

    logMsg(`${winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ')} won the ${cat.label} card (+1 🃏 each)!`);
    G.roundResult = {category:cat, winners, uncontested:false, values};
  }

  if(G.round>=ROUNDS){
    const best = Math.max(...G.players.map(p=>p.cardsWon));
    const gameWinners = G.players.filter(p=>p.cardsWon===best).map(p=>p.id);
    G.gameResult = {winners: gameWinners};
    G.stage = 'game-over';
    logMsg(`Game over! ${gameWinners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ')} win the match with ${best} 🃏!`);
  } else {
    G.stage = 'round-result';
  }
  render();
}
