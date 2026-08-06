// @ts-check
// Pure hand-scoring logic: no DOM, no game state, no randomness. Given a set of players
// and revealed categories, these functions always return the same answer.
//
// Keeping this pure and dependency-free (beyond static data) matters for multiplayer:
// this is the module a server would import to be the authoritative judge of a showdown,
// so it must behave identically wherever it runs.

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
