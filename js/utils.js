// Small stateless helpers used across the game.

import { POOL } from './data.js';

export function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

export function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Percentile of a single player's stat value among the whole pool (0-100).
// Lets you gauge "how strong is this hole card" without needing to see opponents' cards —
// same way knowing you hold pocket Kings tells you your hand is strong before any reveal.
export function percentile(catKey, value){
  const sorted = POOL.map(p=>p[catKey]).slice().sort((a,b)=>a-b);
  let count = 0;
  sorted.forEach(v=>{ if(v<=value) count++; });
  return Math.round(100*count/sorted.length);
}
