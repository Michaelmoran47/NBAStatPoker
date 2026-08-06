// @ts-check
// All DOM rendering and user-input handling. This is the only module that touches
// `document` — everything it needs from the game (state, rules, scoring) is imported,
// nothing here leaks the other direction. That keeps the door open to swapping this
// file out for a different client (or a thin multiplayer client) without touching engine.js.

import { ANTE, ROUNDS, state, makeGame, activePlayers } from './state.js';
import { currentMaxBet } from './betting.js';
import { playGame, nextRound as engineNextRound } from './engine.js';

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
      <p>Each player is dealt 2 "hole" NBA legends and keeps them for the whole game.
      ${ROUNDS} community cards are revealed one at a time — a stat category each — with
      a round of betting before every reveal. Whoever has the higher combined stat wins
      that card. Most community cards after ${ROUNDS} rounds wins the match.</p>
      <div>
        Opponents:
        <select id="numOpp">
          <option value="1">1 CPU opponent</option>
          <option value="2" selected>2 CPU opponents</option>
        </select>
      </div>
      <button class="btn-next" onclick="startGame()">Deal Me In</button>
      <div class="rules">
        <b>Rules:</b> Everyone antes $${ANTE} into the pot each round. One stat category is
        revealed as that round's community card, followed by a betting round (check/call,
        raise, or fold). Whoever has the higher combined stat across their two hole players
        wins the card and that round's pot — ties split the pot and every tied player gets
        the card. This repeats ${ROUNDS} times with the same hole cards throughout.
        Whoever has won the most community cards after ${ROUNDS} rounds wins the match.
      </div>
    </div>`;
}

export function startGame(){
  const numOpp = /** @type {HTMLSelectElement} */ (document.getElementById('numOpp'));
  const n = parseInt(numOpp.value,10);
  state.G = makeGame(n);
  playGame(render);
}

export function nextRound(){
  engineNextRound(render);
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

  // Hole cards flip face-up once a round has resolved — the numbers matter every round,
  // but who's actually holding them stays a mystery until there's a card on the line.
  const revealHoles = G.stage==='round-result' || G.stage==='game-over';

  const oppHtml = opponents.map(p=>`
    <div class="opponent-box ${p.folded?'folded':''} ${actingId===p.id?'acting':''}">
      <div class="name">${p.name} <span class="cards-tally">${'🃏'.repeat(p.cardsWon)}</span></div>
      <div class="chips">$${p.chips}${p.allIn?' (all-in)':''}</div>
      <div class="hole-mini">
        ${p.hole.length? [0,1].map(i=>{
          return revealHoles
            ? `<div class="mini-card revealed">${p.hole[i].name.split(' ').slice(-1)[0]}</div>`
            : `<div class="mini-card back"><span class="mini-card-back-art">🏀</span></div>`;
        }).join('') : ''}
      </div>
    </div>`).join('');

  // One box per round of the match: filled in for rounds already dealt, "?" for what's ahead.
  const catHtml = G.roundCats.map((c,i)=>{
    const revealed = i < G.round;
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
  const humanTurn = actingId===0 && !human.folded && G.stage==='betting';

  const actionsHtml = humanTurn ? `
    <div class="actions">
      <button class="btn-fold" onclick="humanAction('fold')">Fold</button>
      <button class="btn-call" onclick="humanAction('call')">${need>0? 'Call $'+need : 'Check'}</button>
      <div class="raise-box">
        <input type="number" id="raiseAmt" min="${maxBet+20}" max="${human.chips+human.roundBet}" step="10" value="${maxBet+40}">
        <button class="btn-raise" onclick="doRaise()">Raise</button>
      </div>
    </div>` : (G.stage==='betting' ? `<div class="status-line">Waiting on other players…</div>` : '');

  let roundResultHtml = '';
  if((G.stage==='round-result' || G.stage==='game-over') && G.roundResult){
    const rr = G.roundResult;
    const winnerNames = rr.winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ');
    const active = activePlayers();
    roundResultHtml = `<div id="round-result">
      <h3 style="text-align:center;">${rr.category.icon} ${rr.category.label} — Round ${G.round}/${ROUNDS}</h3>
      ${rr.uncontested ? `<p style="text-align:center;">${winnerNames} won the card uncontested.</p>` : `
        <table class="breakdown"><thead><tr><th>Player</th>${active.map(p=>`<th>${p.name}</th>`).join('')}</tr></thead>
        <tbody><tr><td>${rr.category.icon} ${rr.category.label}</td>${active.map(p=>{
          const val = /** @type {Object<number,number>} */(rr.values)[p.id];
          return `<td class="${rr.winners.includes(p.id)?'winner-cell':''}">${rr.category.fmt(val)}</td>`;
        }).join('')}</tr></tbody></table>
        <p style="text-align:center;margin-top:8px;"><b>${winnerNames} won the card!</b> (+1 🃏 each)</p>
      `}
      ${G.stage==='round-result' ? `<div class="actions"><button class="btn-next" onclick="nextRound()">Next Round</button></div>` : ''}
    </div>`;
  }

  let gameOverHtml = '';
  if(G.stage==='game-over' && G.gameResult){
    const gr = G.gameResult;
    const winnerNames = gr.winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ');
    gameOverHtml = `<div id="game-over">
      <h2 style="text-align:center;">🏆 Game Over</h2>
      <p style="text-align:center;">${G.players.map(p=>`${p.name}: ${p.cardsWon} 🃏`).join(' &nbsp;|&nbsp; ')}</p>
      <p style="text-align:center;"><b>${winnerNames} win${gr.winners.length===1?'s':''} the match!</b></p>
      <div class="actions"><button class="btn-next" onclick="renderStart()">New Game</button></div>
    </div>`;
  }

  app.innerHTML = `
    <div class="table">
      <div class="row">${oppHtml}</div>
      <div class="status-line">Round ${Math.min(G.round,ROUNDS)}/${ROUNDS} — Game #${G.gameNum}</div>
      <div class="categories">${catHtml}</div>
      <div class="pot-line">💰 Pot: $${G.pot}</div>
      <div class="hole-area">${holeHtml}</div>
      <div class="you-line">You <span class="cards-tally">${'🃏'.repeat(human.cardsWon)}</span> — $${human.chips}${human.folded?' (folded)':''}</div>
      ${actionsHtml}
      ${roundResultHtml}
      ${gameOverHtml}
      <div id="log">${G.log.map(l=>`<div>${l}</div>`).join('')}</div>
    </div>`;
}
