// @ts-check
// Pure hand-scoring logic: no DOM, no game state, no randomness. Given a set of players
// and revealed categories, these functions always return the same answer.
//
// Keeping this pure and dependency-free (beyond static data) matters for multiplayer:
// this is the module a server would import to be the authoritative judge of a showdown,
// so it must behave identically wherever it runs.

import { FAMILY_PAIRS } from './data.js';

/**
 * @param {import('./state.js').GamePlayer[]} players
 * @param {import('./data.js').Category[]} cats
 * @returns {{breakdown: Object<number, Object<string, import('./state.js').CategoryScore>>, totals: Object<number, number>}}
 */
export function scoreCategories(players, cats){
  const n = players.length;
  /** @type {Object<number, Object<string, import('./state.js').CategoryScore>>} */
  const breakdown = {};
  /** @type {Object<number, number>} */
  const totals = {};
  players.forEach(p=>{ breakdown[p.id]={}; totals[p.id]=0; });
  cats.forEach(cat=>{
    const key = /** @type {keyof import('./data.js').NBAPlayer} */ (cat.key);
    const vals = players.map(p=>({id:p.id, value:/** @type {number} */(p.hole[0][key])+/** @type {number} */(p.hole[1][key])}));
    vals.sort((a,b)=>b.value-a.value);
    let i=0;
    while(i<vals.length){
      let j=i;
      while(j+1<vals.length && vals[j+1].value===vals[i].value) j++;
      let pts=0;
      for(let k=i;k<=j;k++) pts += (n-k);
      pts /= (j-i+1);
      for(let k=i;k<=j;k++){
        breakdown[vals[k].id][cat.key] = {value: vals[k].value, points: pts};
        totals[vals[k].id] += pts;
      }
      i=j+1;
    }
  });
  return {breakdown, totals};
}

// Which categories did each player win outright (no tie), and did they complete
// any "Flush" pair (both halves of a Scoring/Rebounding/Playmaking pair present
// in this hand's categories, and won both)? This is the "straights & flushes"
// layer — named combos worth chasing on top of the raw category totals.
/**
 * @param {import('./state.js').GamePlayer[]} active
 * @param {import('./data.js').Category[]} cats
 * @param {Object<number, Object<string, import('./state.js').CategoryScore>>} breakdown
 * @returns {Object<number, import('./state.js').ComboInfo>}
 */
export function computeCombos(active, cats, breakdown){
  const n = active.length;
  /** @type {Object<number, import('./state.js').ComboInfo>} */
  const combos = {};
  active.forEach(p=>{
    const won = cats.filter(c => breakdown[p.id][c.key].points === n).map(c=>c.key);
    const flushes = FAMILY_PAIRS.filter(fp =>
      fp.keys.every(k => cats.some(c=>c.key===k)) && fp.keys.every(k => won.includes(k))
    ).map(fp=>fp.name);
    combos[p.id] = {won, flushes};
  });
  return combos;
}

/**
 * @param {import('./state.js').ComboInfo} combo
 * @returns {{mult: number, labels: string[]}}
 */
export function bonusForCombo(combo){
  let mult = 0;
  const labels = [];
  const wonCount = combo.won.length;
  if(wonCount>=5){ mult += 0.35; labels.push('SWEEP (5/5)'); }
  else if(wonCount===4){ mult += 0.20; labels.push('DOMINANT (4/5)'); }
  else if(wonCount===3){ mult += 0.10; labels.push('HAT TRICK (3/5)'); }
  combo.flushes.forEach(name=>{ mult += 0.15; labels.push(name.toUpperCase()); });
  return {mult: Math.min(mult, 0.6), labels};
}
