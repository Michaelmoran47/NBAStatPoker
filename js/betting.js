// @ts-check
// Betting rules and the CPU decision policy. No DOM access — `bettingRound` takes a
// `render` callback so this stays reusable outside a browser (e.g. a server driving
// the same round logic against network-connected players instead of a redraw).

import { state, logMsg, activePlayers } from './state.js';
import { scoreCategories } from './scoring.js';
import { sleep } from './utils.js';

/** @returns {number} */
export function currentMaxBet(){
  return Math.max(0, ...state.G.players.filter(p=>!p.folded).map(p=>p.roundBet));
}

/** @param {import('./state.js').GamePlayer} p */
export function applyFold(p){ p.folded = true; logMsg(`${p.name} folds.`); }

/** @param {import('./state.js').GamePlayer} p */
export function applyCall(p){
  const need = currentMaxBet() - p.roundBet;
  const pay = Math.min(need, p.chips);
  p.chips -= pay; p.roundBet += pay; state.G.pot += pay;
  if(p.chips===0) p.allIn = true;
  logMsg(pay===0 ? `${p.name} checks.` : `${p.name} calls $${pay}.`);
}

/**
 * @param {import('./state.js').GamePlayer} p
 * @param {number} raiseTo
 */
export function applyRaise(p, raiseTo){
  const need = raiseTo - p.roundBet;
  const pay = Math.min(need, p.chips);
  p.chips -= pay; p.roundBet += pay; state.G.pot += pay;
  if(p.chips===0) p.allIn = true;
  logMsg(`${p.name} raises to $${p.roundBet}.`);
}

/**
 * @param {import('./state.js').GamePlayer} p
 * @returns {import('./state.js').BettingAction}
 */
export function aiDecide(p){
  const active = activePlayers();
  const cats = state.G.revealedCats;
  const maxBet = currentMaxBet();
  const need = maxBet - p.roundBet;
  let strength = 0.5;
  if(cats.length>0){
    const {totals} = scoreCategories(active, cats);
    const maxPossible = active.length; // max per category
    const best = Math.max(...Object.values(totals));
    strength = totals[p.id] / (maxPossible*cats.length);
    if(totals[p.id]===best) strength = Math.max(strength, 0.7);
  }
  const bluff = Math.random() < 0.12;
  const potOdds = need / Math.max(1, state.G.pot+need);

  /** @type {'fold'|'call'|'raise'} */
  let action;
  if(need===0){
    action = (strength>0.55 || bluff) && Math.random()<0.35 && p.chips>0 ? 'raise' : 'call'; // "call" here = check
  } else if(strength < 0.28 - (bluff?0.3:0) && potOdds > 0.18){
    action = Math.random() < 0.75 ? 'fold' : 'call';
  } else if((strength > 0.62 || bluff) && p.chips > need && Math.random() < 0.4){
    action = 'raise';
  } else {
    action = 'call';
  }

  if(action==='fold'){ return {action:'fold'}; }
  if(action==='raise'){
    const raiseAmt = Math.max(20, Math.round(state.G.pot*0.4/10)*10);
    const raiseTo = Math.min(p.chips+p.roundBet, maxBet + raiseAmt);
    return {action:'raise', amount: raiseTo};
  }
  return {action:'call'};
}

// Runs a full betting round (everyone acts until bets are matched or one player remains).
// `render(actingId)` is called to show whose turn it is; `render()` after each action.
/**
 * @param {(actingId?: number) => void} render
 * @returns {Promise<void>}
 */
export async function bettingRound(render){
  const order = state.G.players.map(p=>p.id);
  /** @type {Set<number>} */
  let acted = new Set();
  let guard = 0;

  while(guard++ < 200){
    const active = state.G.players.filter(p=>!p.folded);
    if(active.length<=1) break;

    const maxBet = currentMaxBet();
    const needsAction = order.find(pid=>{
      const p = state.G.players.find(x=>x.id===pid);
      if(!p || p.folded || p.allIn) return false;
      return !acted.has(pid) || p.roundBet < maxBet;
    });
    if(needsAction===undefined) break;

    const p = /** @type {import('./state.js').GamePlayer} */ (state.G.players.find(x=>x.id===needsAction));
    render(p.id);

    /** @type {import('./state.js').BettingAction} */
    let result;
    if(p.id===0){
      result = await new Promise(res=>{ state.resolveHuman = res; });
    } else {
      await sleep(650);
      result = aiDecide(p);
    }

    if(result.action==='fold'){ applyFold(p); }
    else if(result.action==='raise'){ applyRaise(p, result.amount); acted = new Set(); }
    else { applyCall(p); }

    acted.add(p.id);
    render();
    await sleep(150);
  }
}
