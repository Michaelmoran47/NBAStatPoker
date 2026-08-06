// Orchestrates a full hand: deal -> flop -> turn -> river -> showdown, each followed by
// a betting round. Like betting.js, this takes a `render` callback rather than touching
// the DOM directly, so the same hand flow could later be driven by a server loop instead
// of a browser event loop.

import { state, logMsg, dealNewHand, activePlayers } from './state.js';
import { bettingRound } from './betting.js';
import { scoreCategories, computeCombos, bonusForCombo } from './scoring.js';
import { sleep } from './utils.js';

export async function playHand(render){
  state.handInProgress = true;
  dealNewHand();
  render();
  await sleep(400);

  const stages = [
    {name:'flop', count:3},
    {name:'turn', count:1},
    {name:'river', count:1}
  ];

  for(const st of stages){
    if(activePlayers().length<=1) break;
    state.G.stage = st.name;
    for(let i=0;i<st.count;i++){
      state.G.revealedCats.push(state.G.handCats[state.G.revealedCats.length]);
    }
    logMsg(`--- ${st.name.toUpperCase()} ---  ` + state.G.revealedCats.slice(-st.count).map(c=>c.label).join(', '));
    state.G.players.forEach(p=>{ p.roundBet=0; });
    render();
    await sleep(300);
    await bettingRound(render);
  }

  await showdown(render);
  state.handInProgress = false;
}

export async function showdown(render){
  const G = state.G;
  G.stage = 'showdown';
  const active = activePlayers();

  if(active.length===1){
    const winner = active[0];
    winner.chips += G.pot;
    logMsg(`${winner.name} wins $${G.pot} (everyone else folded).`);
    G.lastResult = {breakdown:null, totals:null, winners:[winner.id], uncontested:true};
    render();
    return;
  }

  const {breakdown, totals} = scoreCategories(active, G.handCats);
  const best = Math.max(...Object.values(totals));
  const winners = active.filter(p=>totals[p.id]===best).map(p=>p.id);
  const combos = computeCombos(active, G.handCats, breakdown);

  const share = Math.floor(G.pot/winners.length);
  let bonusTotal = 0;
  const bonusLog = [];
  winners.forEach(id=>{
    const player = G.players.find(p=>p.id===id);
    const {mult, labels} = bonusForCombo(combos[id]);
    const bonus = Math.round(share*mult);
    player.chips += share + bonus;
    bonusTotal += bonus;
    if(labels.length) bonusLog.push(`${player.name}: ${labels.join(' + ')} → +$${bonus} bonus`);
  });

  logMsg(`Showdown! ${winners.map(id=>G.players.find(p=>p.id===id).name).join(' & ')} win the $${G.pot} pot${bonusTotal? ` (+$${bonusTotal} combo bonus)`:''}.`);
  bonusLog.forEach(l=>logMsg('🔥 '+l));

  G.lastResult = {breakdown, totals, winners, uncontested:false, combos, bonusLog};
  render();
}
