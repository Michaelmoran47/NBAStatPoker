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
    // Still run this lone player through scoreCategories (rather than leaving `values`
    // empty) so the round-reveal animation has a number to show even when nobody else
    // was left to compare against.
    const {breakdown} = scoreCategories(active, [cat]);
    G.roundResult = {category:cat, winners:[winner.id], uncontested:true, values:{[winner.id]: breakdown[winner.id][cat.key].value}, payouts:{[winner.id]: G.pot}};
  } else {
    const {breakdown, totals} = scoreCategories(active, [cat]);
    const best = Math.max(...Object.values(totals));
    const winners = active.filter(p=>totals[p.id]===best).map(p=>p.id);
    const share = Math.floor(G.pot/winners.length);

    /** @type {Object<number, number>} */
    const values = {};
    active.forEach(p=>{ values[p.id] = breakdown[p.id][cat.key].value; });

    /** @type {Object<number, number>} */
    const payouts = {};
    winners.forEach(id=>{
      const player = /** @type {import('./state.js').GamePlayer} */ (G.players.find(p=>p.id===id));
      player.chips += share;
      player.wonCategories.push(cat);
      payouts[id] = share;
    });

    logMsg(G, `${winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ')} won the ${cat.label} card (+1 🃏 each)!`);
    G.roundResult = {category:cat, winners, uncontested:false, values, payouts};
  }

  // Anyone the round just left at $0 is out for the rest of the game — cards removed,
  // no more antes/bets, spectator only. Checked here (after chips are awarded) rather
  // than in startRound, since going broke is itself an outcome of this round's betting.
  G.players.forEach(p=>{
    if(!p.eliminated && p.chips===0){
      p.eliminated = true;
      logMsg(G, `${p.name} is out of chips and becomes a spectator.`);
    }
  });

  const remaining = G.players.filter(p=>!p.eliminated);
  // Game ends either when only one player still has money — no need to play out the
  // remaining rounds — or once the full round count is reached. `remaining` can't be
  // empty here: whoever just won this round's pot gained chips before this check ran,
  // so there's always at least one player left to be "remaining."
  if(remaining.length<=1 || G.round>=ROUNDS){
    const best = Math.max(...remaining.map(p=>p.chips));
    const gameWinners = remaining.filter(p=>p.chips===best).map(p=>p.id);
    G.gameResult = {winners: gameWinners};
    G.stage = 'game-over';
    const names = gameWinners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ');
    logMsg(G, remaining.length<=1
      ? `Game over! ${names} is the last player standing with $${best}!`
      : `Game over! ${names} win the match with $${best}!`);
  } else {
    G.stage = 'round-result';
  }
  render();
}
