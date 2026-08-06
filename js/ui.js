// @ts-check
// All DOM rendering and user-input handling. This is the only module that touches
// `document` — everything it needs from the game (state, rules, scoring) is imported,
// nothing here leaks the other direction. That keeps the door open to swapping this
// file out for a different client (or a thin multiplayer client) without touching engine.js.

import { ANTE, state, makeGame, activePlayers } from './state.js';
import { currentMaxBet } from './betting.js';
import { playHand } from './engine.js';

/**
 * @param {'fold'|'call'|'raise'} action
 * @param {number} [amount]
 */
export function humanAction(action, amount){
  if(!state.resolveHuman) return;
  const r = state.resolveHuman;
  state.resolveHuman = null;
  r(/** @type {import('./state.js').BettingAction} */ ({action, amount}));
}

export function renderStart(){
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));
  app.innerHTML = `
    <div id="start-screen">
      <h2>Ready to play?</h2>
      <p>Each player gets 2 "hole" NBA legends. Five stat categories flip like flop/turn/river.
      Best combined stats across the revealed categories wins the pot.</p>
      <div>
        Opponents:
        <select id="numOpp">
          <option value="1">1 CPU opponent</option>
          <option value="2" selected>2 CPU opponents</option>
        </select>
      </div>
      <button class="btn-next" onclick="startGame()">Deal Me In</button>
      <div class="rules">
        <b>Rules:</b> Everyone antes $${ANTE} into the pot each hand. Three stat categories reveal on the
        "flop", then one on the "turn", one on the "river" — with a betting round after each, just like
        Hold'em (check/call, raise, or fold). At showdown, each active player's two hole players' stats are
        summed for every revealed category; the player who ranks #1 in the most categories (by total rank
        points) wins the pot. Ties split it.
        <br><br>
        <b>Combos to chase:</b> win 4 of the 5 categories for a <b>Dominant</b> bonus (+20% pot), or all 5
        for a <b>Sweep</b> (+35%).
      </div>
    </div>`;
}

export function startGame(){
  const numOpp = /** @type {HTMLSelectElement} */ (document.getElementById('numOpp'));
  const n = parseInt(numOpp.value,10);
  state.G = makeGame(n);
  playHand(render);
}

export function nextHand(){
  const human = /** @type {import('./state.js').GamePlayer} */ (state.G.players.find(p=>p.id===0));
  if(human.chips<=0){
    /** @type {HTMLElement} */ (document.getElementById('app')).insertAdjacentHTML('beforeend',
      `<div style="text-align:center;margin-top:16px;"><h2>You're out of chips!</h2>
       <button class="btn-next" onclick="renderStart()">Play Again</button></div>`);
    return;
  }
  playHand(render);
}

export function doRaise(){
  const input = /** @type {HTMLInputElement} */ (document.getElementById('raiseAmt'));
  const amt = parseInt(input.value,10);
  humanAction('raise', amt);
}

/** @param {number} [actingId] */
export function render(actingId){
  const G = state.G;
  if(!G){ renderStart(); return; }
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));
  const human = /** @type {import('./state.js').GamePlayer} */ (G.players.find(p=>p.id===0));
  const opponents = G.players.filter(p=>p.id!==0);
  const handCats = /** @type {import('./data.js').Category[]} */ (G.handCats || []);

  const oppHtml = opponents.map(p=>`
    <div class="opponent-box ${p.folded?'folded':''} ${actingId===p.id?'acting':''}">
      <div class="name">${p.name}</div>
      <div class="chips">$${p.chips}${p.allIn?' (all-in)':''}</div>
      <div class="hole-mini">
        ${p.hole.length? [0,1].map(i=>{
          const revealed = G.stage==='showdown' && !p.folded;
          return revealed
            ? `<div class="mini-card revealed">${p.hole[i].name.split(' ').slice(-1)[0]}</div>`
            : `<div class="mini-card back"><span class="mini-card-back-art">🏀</span></div>`;
        }).join('') : ''}
      </div>
    </div>`).join('');

  const catHtml = handCats.map(c=>{
    const revealed = G.revealedCats.includes(c);
    return revealed
      ? `<div class="cat-card revealed"><div class="icon">${c.icon}</div><div class="label">${c.label}</div></div>`
      : `<div class="cat-card hidden"><div class="icon">?</div></div>`;
  }).join('');

  const holeHtml = human.hole.length ? human.hole.map(pl=>`
    <div class="player-card">
      <div class="pname">${pl.name}</div>
    </div>`).join('') : '';

  const maxBet = currentMaxBet();
  const need = human.folded ? 0 : maxBet - human.roundBet;
  const humanTurn = actingId===0 && !human.folded;

  const actionsHtml = humanTurn ? `
    <div class="actions">
      <button class="btn-fold" onclick="humanAction('fold')">Fold</button>
      <button class="btn-call" onclick="humanAction('call')">${need>0? 'Call $'+need : 'Check'}</button>
      <div class="raise-box">
        <input type="number" id="raiseAmt" min="${maxBet+20}" max="${human.chips+human.roundBet}" step="10" value="${maxBet+40}">
        <button class="btn-raise" onclick="doRaise()">Raise</button>
      </div>
    </div>` : (G.stage==='showdown' ? `<div class="actions"><button class="btn-next" onclick="nextHand()">Next Hand</button></div>` : `<div class="status-line">Waiting on other players…</div>`);

  let showdownHtml = '';
  if(G.stage==='showdown' && G.lastResult){
    if(G.lastResult.uncontested){
      showdownHtml = `<div id="showdown"><b>${/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===G.lastResult.winners[0])).name} takes the pot uncontested.</b></div>`;
    } else {
      const active = activePlayers();
      const {breakdown, totals, winners, combos, bonusLog} = G.lastResult;
      const n = active.length;
      showdownHtml = `<div id="showdown"><h3>Showdown Breakdown</h3>
        <table class="breakdown"><thead><tr><th>Category</th>${active.map(p=>`<th>${p.name}<br><small>${p.hole.map(h=>h.name).join(' / ')}</small></th>`).join('')}</tr></thead>
        <tbody>
        ${handCats.map(c=>{
          // rank cells within this row so the best value glows green, worst glows red
          const rowVals = active.map(p=>({id:p.id, value:/** @type {Object<number,Object<string,import('./state.js').CategoryScore>>} */(breakdown)[p.id][c.key].value}));
          const maxV = Math.max(...rowVals.map(r=>r.value));
          const minV = Math.min(...rowVals.map(r=>r.value));
          return `<tr><td>${c.icon} ${c.label}</td>${active.map(p=>{
            const b = /** @type {Object<number,Object<string,import('./state.js').CategoryScore>>} */(breakdown)[p.id][c.key];
            const cls = n>1 ? (b.value===maxV ? 'rank-best' : b.value===minV ? 'rank-worst' : 'rank-mid') : '';
            return `<td class="${cls}">${c.fmt(b.value)} <small>(${b.points.toFixed(1)}pt)</small></td>`;
          }).join('')}</tr>`;
        }).join('')}
        <tr><th>Total</th>${active.map(p=>`<th class="${winners.includes(p.id)?'winner-cell':''}">${/** @type {Object<number,number>} */(totals)[p.id].toFixed(1)}</th>`).join('')}</tr>
        <tr><td>Combos</td>${active.map(p=>{
          const c = /** @type {Object<number,import('./state.js').ComboInfo>} */(combos)[p.id];
          const pills =
            c.won.length>=5 ? ['<span class="combo-pill">SWEEP</span>'] :
            c.won.length===4 ? ['<span class="combo-pill">DOMINANT</span>'] : [];
          return `<td>${pills.length? pills.join(' ') : '<small style="opacity:.5;">—</small>'}</td>`;
        }).join('')}</tr>
        </tbody></table>
        <p style="text-align:center;margin-top:8px;"><b>${winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ')} win${winners.length===1?'s':''} the pot!</b></p>
        ${bonusLog && bonusLog.length ? `<div class="bonus-line">${bonusLog.map(l=>'🔥 '+l).join('<br>')}</div>` : ''}
        </div>`;
    }
  }

  app.innerHTML = `
    <div class="table">
      <div class="row">${oppHtml}</div>
      <div class="status-line">Stage: ${G.stage.toUpperCase()} — Hand #${G.handNum}</div>
      <div class="categories">${catHtml}</div>
      <div class="pot-line">💰 Pot: $${G.pot}</div>
      <div class="hole-area">${holeHtml}</div>
      <div class="you-line">You — $${human.chips}${human.folded?' (folded)':''}</div>
      ${actionsHtml}
      ${showdownHtml}
      <div id="log">${G.log.map(l=>`<div>${l}</div>`).join('')}</div>
    </div>`;
}
