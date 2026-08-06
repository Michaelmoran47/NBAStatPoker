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
  const slider = /** @type {HTMLInputElement} */ (document.getElementById('raiseSlider'));
  const amt = parseInt(slider.value,10);
  humanAction('raise', amt);
}

/** Keeps the Raise button's label in sync while the slider is being dragged,
 * without forcing a full re-render (which would interrupt the drag).
 * @param {string} value
 */
export function updateRaiseLabel(value){
  const btn = document.getElementById('raiseBtn');
  if(btn) btn.textContent = 'Raise ' + value;
}

const PERSON_ICON = `<svg class="id-icon" viewBox="0 0 200 260">
  <circle cx="100" cy="80" r="66" fill="none" stroke="currentColor" stroke-width="10"/>
  <line x1="70" y1="144" x2="35" y2="240" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>
  <line x1="130" y1="144" x2="165" y2="240" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>
</svg>`;

/**
 * @param {import('./state.js').GamePlayer} p
 * @param {number|undefined} actingId
 * @param {boolean} revealHoles
 * @param {'seat-left'|'seat-right'} side
 */
function renderSeat(p, actingId, revealHoles, side){
  return `
    <div class="seat ${side} ${p.folded?'folded':''} ${actingId===p.id?'acting':''}" data-seat="${p.id}">
      <div class="seat-cards">
        ${[0,1].map(i=>{
          return revealHoles
            ? `<div class="mini-card revealed">${p.hole[i].name.split(' ').slice(-1)[0]}</div>`
            : `<div class="mini-card back">🏀</div>`;
        }).join('')}
      </div>
      <div class="seat-name">${p.name}</div>
      <div class="seat-chips chip-amount">$${p.chips}${p.allIn?' (all-in)':''}</div>
      <div class="cards-tally">${'🃏'.repeat(p.cardsWon)}</div>
    </div>`;
}

// Sends a small poker chip flying from wherever the bet came from to the pot, then
// bumps the pot number once it "lands". Runs for both the human's and CPUs' actions,
// since both flow through the same post-action render() call in betting.js.
/**
 * @param {string} fromSelector
 * @param {number} [delay]
 */
function flyChip(fromSelector, delay){
  setTimeout(()=>{
    const fromEl = document.querySelector(fromSelector);
    const potEl = document.getElementById('potAmount');
    if(!fromEl || !potEl) return;
    const from = fromEl.getBoundingClientRect();
    const to = potEl.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'chip-fly';
    chip.style.left = (from.left + from.width/2 - 10) + 'px';
    chip.style.top = (from.top + from.height/2 - 10) + 'px';
    document.body.appendChild(chip);
    const dx = (to.left + to.width/2) - (from.left + from.width/2);
    const dy = (to.top + to.height/2) - (from.top + from.height/2);
    requestAnimationFrame(()=>{
      chip.style.transform = `translate(${dx}px,${dy}px) scale(.55)`;
      chip.style.opacity = '0';
    });
    setTimeout(()=>{ chip.remove(); }, 600);
  }, delay || 0);
}

/**
 * @param {number} [actingId] Whose turn it is right now, if anyone.
 * @param {{playerId:number, action:'fold'|'call'|'raise'}} [lastAction] What just happened,
 *   so this render can play the matching one-shot animation (chip flight, fold fade,
 *   pot bump) — set only on the render call immediately after an action is applied.
 */
export function render(actingId, lastAction){
  const G = state.G;
  if(!G){ renderStart(); return; }
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));
  const human = /** @type {import('./state.js').GamePlayer} */ (G.players.find(p=>p.id===0));
  const opponents = G.players.filter(p=>p.id!==0);

  // Hole cards flip face-up once a round has resolved — the numbers matter every round,
  // but who's actually holding them stays a mystery until there's a card on the line.
  const revealHoles = G.stage==='round-result' || G.stage==='game-over';

  const seatLeft = opponents[0] ? renderSeat(opponents[0], actingId, revealHoles, 'seat-left') : `<div class="seat-left"></div>`;
  const seatRight = opponents[1] ? renderSeat(opponents[1], actingId, revealHoles, 'seat-right') : `<div class="seat-right"></div>`;

  const currentCat = G.revealedCats[0];
  const statCardHtml = currentCat
    ? `<div class="id-card stat-card">
        <div class="label">${currentCat.label}</div>
        <div class="card-rule"></div>
        <div class="icon">${currentCat.icon}</div>
      </div>`
    : `<div class="id-card stat-card hidden"><div class="icon">?</div></div>`;

  const potJustBumped = lastAction && (lastAction.action==='call' || lastAction.action==='raise');

  // One pip per round of the match: filled in for rounds already dealt, dim for what's ahead.
  const pipsHtml = G.roundCats.map((c,i)=>{
    const done = i < G.round-1 || (i===G.round-1 && G.stage!=='betting' && G.stage!=='idle');
    const now = i===G.round-1 && !done;
    return `<div class="pip ${done?'done':''} ${now?'now':''}"></div>`;
  }).join('');

  const holeHtml = human.hole.length ? human.hole.map(pl=>`
    <div class="id-card player-card">
      ${PERSON_ICON}
      <div class="card-rule"></div>
      <div class="pname">${pl.name}</div>
    </div>`).join('') : '';

  const maxBet = currentMaxBet();
  const need = human.folded ? 0 : maxBet - human.roundBet;
  const callAmount = Math.min(need, human.chips); // what Call would actually cost, clamped to an all-in
  const humanTurn = actingId===0 && !human.folded && G.stage==='betting';

  const minRaiseTo = maxBet+20;
  const maxRaiseTo = human.chips+human.roundBet;
  // If a player's stack can't cover even the minimum legal raise, don't offer one —
  // a slider whose min exceeds its max just freezes, undraggable, which is exactly
  // the "raise slider doesn't work" bug this replaces.
  const canRaise = maxRaiseTo >= minRaiseTo;
  const raiseDefault = Math.min(minRaiseTo+20, maxRaiseTo);

  let controlsHtml = '';
  if(G.stage==='betting'){
    controlsHtml = humanTurn ? `
      <div class="controls">
        <div class="actions">
          <button class="btn btn-fold" onclick="humanAction('fold')">Fold</button>
          <button class="btn btn-call" onclick="humanAction('call')">${callAmount>0? 'Call $'+callAmount : 'Check'}</button>
          ${canRaise ? `<button class="btn btn-raise" id="raiseBtn" onclick="doRaise()">Raise ${raiseDefault}</button>` : ''}
        </div>
        ${canRaise ? `<input type="range" class="raise-slider" id="raiseSlider" min="${minRaiseTo}" max="${maxRaiseTo}" step="10" value="${raiseDefault}" oninput="updateRaiseLabel(this.value)">` : ''}
      </div>` : `<div class="controls"><div class="status-line">Waiting on other players…</div></div>`;
  }

  let roundResultHtml = '';
  if((G.stage==='round-result' || G.stage==='game-over') && G.roundResult){
    const rr = G.roundResult;
    const winnerNames = rr.winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ');
    const active = activePlayers();
    roundResultHtml = `<div id="round-result">
      <h3>${rr.category.icon} ${rr.category.label} — Round ${G.round}/${ROUNDS}</h3>
      ${rr.uncontested ? `<p>${winnerNames} won the card uncontested.</p>` : `
        <table class="breakdown"><thead><tr><th>Player</th>${active.map(p=>`<th>${p.name}</th>`).join('')}</tr></thead>
        <tbody><tr><td>${rr.category.icon} ${rr.category.label}</td>${active.map(p=>{
          const val = /** @type {Object<number,number>} */(rr.values)[p.id];
          return `<td class="${rr.winners.includes(p.id)?'winner-cell':''}">${rr.category.fmt(val)}</td>`;
        }).join('')}</tr></tbody></table>
        <p><b>${winnerNames} won the card!</b> (+1 🃏 each)</p>
      `}
      ${G.stage==='round-result' ? `<button class="btn-next" onclick="nextRound()">Next Round</button>` : ''}
    </div>`;
  }

  let gameOverHtml = '';
  if(G.stage==='game-over' && G.gameResult){
    const gr = G.gameResult;
    const winnerNames = gr.winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ');
    gameOverHtml = `<div id="game-over">
      <h2>🏆 Game Over</h2>
      <p>${G.players.map(p=>`${p.name}: ${p.cardsWon} 🃏`).join(' &nbsp;|&nbsp; ')}</p>
      <p><b>${winnerNames} win${gr.winners.length===1?'s':''} the match!</b></p>
      <button class="btn-next" onclick="renderStart()">New Game</button>
    </div>`;
  }

  app.innerHTML = `
    <div class="hud">
      <div class="round-label">Round ${Math.min(G.round,ROUNDS)}/${ROUNDS} — Game #${G.gameNum}</div>
      <div class="pip-row">${pipsHtml}</div>
    </div>

    <div class="table-area">
      ${seatLeft}
      <div class="center-column">
        <div class="center-circle" aria-hidden="true"></div>
        <div class="pot-banner">
          <div class="pot-amount ${potJustBumped?'just-bumped':''}" id="potAmount">$${G.pot}</div>
          <div class="pot-label">Pot</div>
        </div>
        ${statCardHtml}
      </div>
      ${seatRight}
    </div>

    <div class="you-seat ${human.folded?'folded':''}" data-seat="0">
      <div class="hole-cards ${lastAction && lastAction.playerId===0 && lastAction.action==='fold' ? 'just-folded' : ''}">${holeHtml}</div>
      <div class="you-header">
        <div class="you-name">You${human.folded?' (folded)':''}</div>
        <div class="cards-tally">${'🃏'.repeat(human.cardsWon)}</div>
        <div class="you-chips chip-amount">$${human.chips}</div>
      </div>
    </div>

    ${controlsHtml}
    ${roundResultHtml}
    ${gameOverHtml}

    <div class="log-strip">${G.log.map(l=>`<div>${l}</div>`).join('')}</div>`;

  if(lastAction){
    const seatSelector = `[data-seat="${lastAction.playerId}"] .chip-amount`;
    if(lastAction.action==='call'){
      flyChip(seatSelector);
    } else if(lastAction.action==='raise'){
      flyChip(seatSelector);
      flyChip(seatSelector, 140);
    }
  }
}
