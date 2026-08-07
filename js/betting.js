// @ts-check
// Betting rules and the CPU decision policy. No DOM access, and no assumption about
// who's actually behind a non-AI seat — `bettingRound` takes a `requestAction(seatId)`
// callback for that, so the exact same loop drives a local human's button clicks or a
// network-connected player's socket messages.

import { logMsg, activePlayers } from './state.js';
import { scoreCategories } from './scoring.js';
import { sleep } from './utils.js';

/**
 * @param {import('./state.js').GameState} G
 * @returns {number}
 */
export function currentMaxBet(G){
  return Math.max(0, ...G.players.filter(p=>!p.folded).map(p=>p.roundBet));
}

/**
 * @param {import('./state.js').GameState} G
 * @param {import('./state.js').GamePlayer} p
 */
export function applyFold(G, p){ p.folded = true; logMsg(G, `${p.name} folds.`); }

/**
 * @param {import('./state.js').GameState} G
 * @param {import('./state.js').GamePlayer} p
 * @returns {number} What was actually paid — 0 means this was a check, not a call.
 */
export function applyCall(G, p){
  const need = currentMaxBet(G) - p.roundBet;
  const pay = Math.min(need, p.chips);
  p.chips -= pay; p.roundBet += pay; G.pot += pay;
  if(p.chips===0) p.allIn = true;
  logMsg(G, pay===0 ? `${p.name} checks.` : `${p.name} calls $${pay}.`);
  return pay;
}

/**
 * @param {import('./state.js').GameState} G
 * @param {import('./state.js').GamePlayer} p
 * @param {number} raiseTo
 */
export function applyRaise(G, p, raiseTo){
  const need = raiseTo - p.roundBet;
  const pay = Math.min(need, p.chips);
  p.chips -= pay; p.roundBet += pay; G.pot += pay;
  if(p.chips===0) p.allIn = true;
  logMsg(G, `${p.name} raises to $${p.roundBet}.`);
}

/**
 * @param {import('./state.js').GameState} G
 * @param {import('./state.js').GamePlayer} p
 * @returns {import('./state.js').BettingAction}
 */
export function aiDecide(G, p){
  const active = activePlayers(G);
  const cats = G.revealedCats;
  const maxBet = currentMaxBet(G);
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
  const potOdds = need / Math.max(1, G.pot+need);

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
    const raiseAmt = Math.max(20, Math.round(G.pot*0.4/10)*10);
    const raiseTo = Math.min(p.chips+p.roundBet, maxBet + raiseAmt);
    return {action:'raise', amount: raiseTo};
  }
  return {action:'call'};
}

// Runs a full betting round (everyone acts until bets are matched or one player remains).
// `render(actingId)` shows whose turn it is; `render()` after each action.
// `requestAction(seatId)` is only ever called for non-AI seats — see its doc in state.js.
/**
 * @param {import('./state.js').GameState} G
 * @param {import('./state.js').RenderFn} render
 * @param {import('./state.js').RequestActionFn} requestAction
 * @returns {Promise<void>}
 */
export async function bettingRound(G, render, requestAction){
  const order = G.players.map(p=>p.id);
  /** @type {Set<number>} */
  let acted = new Set();
  let guard = 0;
  // Index into `order` to resume scanning from — NOT reset to 0 each iteration. Without
  // this, the search below always re-scanned from seat 0 on every iteration, so after a
  // raise from anyone but the first seat, action jumped back to seat 0 instead of
  // continuing around the table to the next seat in line (visible as turns going e.g.
  // player1, player2, player1, player3 instead of player1, player2, player3, player1).
  let cursor = 0;

  while(guard++ < 200){
    const active = G.players.filter(p=>!p.folded);
    if(active.length<=1) break;

    const maxBet = currentMaxBet(G);
    /** @type {number|undefined} */
    let needsAction;
    for(let i=0;i<order.length;i++){
      const idx = (cursor+i) % order.length;
      const pid = order[idx];
      const p = G.players.find(x=>x.id===pid);
      if(!p || p.folded || p.allIn) continue;
      if(!acted.has(pid) || p.roundBet < maxBet){ needsAction = pid; cursor = idx; break; }
    }
    // betting.js is loaded by both the browser (single-player) and Node (server) —
    // `process` only exists in the latter, and isn't declared at all in the client's
    // jsconfig.json (no @types/node there), so this goes through `globalThis` with an
    // `any` cast rather than referencing the bare identifier.
    const proc = /** @type {any} */ (globalThis).process;
    if(proc?.env?.DEBUG_BETTING){
      console.log('[bettingRound]', {maxBet, acted:[...acted], needsAction, players: G.players.map(p=>({id:p.id, folded:p.folded, allIn:p.allIn, roundBet:p.roundBet, chips:p.chips}))});
    }
    if(needsAction===undefined) break;

    const p = /** @type {import('./state.js').GamePlayer} */ (G.players.find(x=>x.id===needsAction));
    render(p.id);

    /** @type {import('./state.js').BettingAction} */
    let result;
    if(!p.isAI){
      result = await requestAction(p.id);
    } else {
      await sleep(650);
      result = aiDecide(G, p);
    }

    /** @type {'fold'|'call'|'raise'|'check'} */
    let actionLabel = result.action;
    if(result.action==='fold'){ applyFold(G, p); }
    else if(result.action==='raise'){ applyRaise(G, p, result.amount); acted = new Set(); }
    else {
      const pay = applyCall(G, p);
      if(pay===0) actionLabel = 'check'; // a zero-cost call is a check — different animation, no chip flies
    }

    acted.add(p.id);
    cursor = (cursor+1) % order.length; // resume the next scan from the seat right after this one
    // Passing what just happened lets the UI play a one-shot animation (chip flight,
    // fold fade, pot bump, check tap) for this render only — betting.js still never
    // touches the DOM itself, it just tells the render callback what occurred.
    render(undefined, {playerId: p.id, action: actionLabel});
    await sleep(150);
  }
}
