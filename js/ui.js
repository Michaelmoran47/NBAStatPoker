// @ts-check
// All DOM rendering and user-input handling. This is the only module that touches
// `document` — everything it needs from the game (state, rules, scoring) is imported,
// nothing here leaks the other direction. That keeps the door open to swapping this
// file out for a different client (or a thin multiplayer client) without touching engine.js.

import { ANTE, ROUNDS, makeGame, activePlayers } from './state.js';
import { currentMaxBet } from './betting.js';
import { playGame, nextRound as engineNextRound } from './engine.js';
import { CATS } from './data.js';

// A Category's `fmt` is a function — fine for solo play, where the GameState is a live
// JS object, but a multiplayer GameState travels over the wire as JSON, and
// JSON.stringify silently drops function-valued properties. A category object received
// from the server has everything *except* fmt. Always resolve fmt from this client's
// own local CATS by key instead of trusting the transmitted object to carry it.
/**
 * @param {string} key
 * @param {number} value
 * @returns {string}
 */
function fmtStat(key, value){
  const cat = CATS.find(c=>c.key===key);
  return cat ? cat.fmt(value) : String(value);
}

// This client's own local game session — state.js itself holds no mutable state any
// more (see its header comment), so the one-and-only GameState a solo game needs to
// remember lives here instead, alongside the pending-action resolver requestAction()
// uses in place of a server socket.
/** @type {{G: import('./state.js').GameState|null, resolveHuman: ((result: import('./state.js').BettingAction) => void)|null}} */
const state = { G: null, resolveHuman: null };

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

// The client's requestAction: there's only ever one non-AI seat (seat 0, "You"), and
// "waiting for the human" just means holding onto this Promise's resolver until a
// button click calls humanAction() above.
/** @type {import('./state.js').RequestActionFn} */
function requestAction(seatId){
  return new Promise(res => { state.resolveHuman = res; });
}

export function renderStart(){
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));
  app.innerHTML = `
    <div id="start-screen">
      <h2>Ready to play?</h2>
      <p>Each player is dealt 2 "hole" NBA legends and keeps them for the whole game.
      ${ROUNDS} community cards are revealed one at a time — a stat category each — with
      a round of betting before every reveal. Whoever has the higher combined stat wins
      that card and its pot. The goal is to end up with the most money — go broke and
      you're out for the rest of the match. Whoever has the most chips when only one
      player's left, or after ${ROUNDS} rounds, wins.</p>
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
        If your bank hits $0 after a round, you're eliminated and become a spectator for
        the rest of the match. The match ends the moment only one player still has money
        left, or after ${ROUNDS} rounds if everyone's still in — whoever has the most
        chips at that point wins.
      </div>
    </div>`;
}

export function startGame(){
  const numOpp = /** @type {HTMLSelectElement} */ (document.getElementById('numOpp'));
  const n = parseInt(numOpp.value,10);
  state.G = makeGame(n);
  playGame(state.G, render, requestAction);
}

export function nextRound(){
  if(state.G) engineNextRound(state.G, render, requestAction);
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
 * @param {boolean} justChecked
 */
function renderSeat(p, actingId, revealHoles, side, justChecked){
  // A player who's busted has their cards removed for the rest of the match — no
  // card-backs to hide behind, just a spectator tag where their chip count used to be.
  const cardsHtml = p.eliminated
    ? `<div class="spectator-tag">Spectator</div>`
    : `<div class="seat-cards">
        ${[0,1].map(i=>{
          return revealHoles
            ? `<div class="mini-card revealed">${p.hole[i].name.split(' ').slice(-1)[0]}</div>`
            : `<div class="mini-card back">🏀</div>`;
        }).join('')}
      </div>`;

  return `
    <div class="seat ${side} ${p.folded?'folded':''} ${p.eliminated?'eliminated':''} ${actingId===p.id?'acting':''} ${justChecked?'just-checked':''}" data-seat="${p.id}">
      ${justChecked ? `<div class="check-tap">✊</div>` : ''}
      ${cardsHtml}
      <div class="seat-name">${p.name}</div>
      ${p.eliminated ? '' : `<div class="seat-chips chip-amount">$${p.chips}${p.allIn?' (all-in)':''}</div>`}
      <div class="cards-tally">${p.wonCategories.map(c=>c.icon).join('')}</div>
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

// Local single-player wiring: renderGame always needs a GameState + whose seat is
// "you" explicitly, but engine.js's RenderFn only ever calls render(actingId,
// lastAction) — this closes over this client's own state/seat (always 0) so that
// shape still matches, without renderGame itself needing to assume single-player.
/**
 * @param {number} [actingId] Whose turn it is right now, if anyone.
 * @param {import('./state.js').LastAction} [lastAction] What just happened,
 *   so this render can play the matching one-shot animation (chip flight, fold fade,
 *   pot bump, check tap) — set only on the render call immediately after an action is applied.
 */
export function render(actingId, lastAction){
  if(!state.G){ renderStart(); return; }
  renderGame(state.G, actingId, lastAction, 0, 'solo');
}

// The shared render — used directly by the local single-player wrapper above, and by
// the multiplayer client (lobby/lobby.js) with server-pushed state instead of a local
// GameState, and mySeatId taken from wherever the player actually ended up sitting
// (join order, not always 0). 'solo' vs 'multiplayer' only changes two things: whether
// "Next Round" is clickable (multiplayer's server advances rounds on its own timer —
// nothing is waiting on that click) and what happens after game-over.
/**
 * @param {import('./state.js').GameState} G
 * @param {number|undefined} actingId Whose turn it is right now, if anyone.
 * @param {import('./state.js').LastAction|undefined} lastAction What just happened,
 *   so this render can play the matching one-shot animation (chip flight, fold fade,
 *   pot bump, check tap) — set only on the render call immediately after an action is applied.
 * @param {number} mySeatId Which player id is "you".
 * @param {'solo'|'multiplayer'} mode
 */
export function renderGame(G, actingId, lastAction, mySeatId, mode){
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));
  const human = /** @type {import('./state.js').GamePlayer} */ (G.players.find(p=>p.id===mySeatId));
  const opponents = G.players.filter(p=>p.id!==mySeatId);

  // Hole cards stay face-down for the entire match — who's actually holding what stays
  // a mystery until the very end, even after individual rounds resolve.
  const revealHoles = G.stage==='game-over';
  const checkedId = lastAction && lastAction.action==='check' ? lastAction.playerId : null;

  const seatLeft = opponents[0] ? renderSeat(opponents[0], actingId, revealHoles, 'seat-left', checkedId===opponents[0].id) : `<div class="seat-left"></div>`;
  const seatRight = opponents[1] ? renderSeat(opponents[1], actingId, revealHoles, 'seat-right', checkedId===opponents[1].id) : `<div class="seat-right"></div>`;

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

  // Busted players have their cards removed for the rest of the match, same as opponents.
  const holeHtml = human.hole.length && !human.eliminated ? human.hole.map(pl=>`
    <div class="id-card player-card">
      ${PERSON_ICON}
      <div class="card-rule"></div>
      <div class="pname">${pl.name}</div>
    </div>`).join('') : '';

  const maxBet = currentMaxBet(G);
  const need = human.folded ? 0 : maxBet - human.roundBet;
  const callAmount = Math.min(need, human.chips); // what Call would actually cost, clamped to an all-in
  const humanTurn = actingId===mySeatId && !human.folded && G.stage==='betting';

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
      </div>` : `<div class="controls"><div class="status-line">${human.eliminated ? "You're out — watching the rest of the match." : 'Waiting on other players…'}</div></div>`;
  }

  let roundResultHtml = '';
  if((G.stage==='round-result' || G.stage==='game-over') && G.roundResult){
    const rr = G.roundResult;
    const winnerNames = rr.winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ');
    const active = activePlayers(G);
    roundResultHtml = `<div id="round-result">
      <h3>${rr.category.icon} ${rr.category.label} — Round ${G.round}/${ROUNDS}</h3>
      ${rr.uncontested ? `<p>${winnerNames} won the card uncontested.</p>` : `
        <table class="breakdown"><thead><tr><th>Player</th>${active.map(p=>`<th>${p.name}</th>`).join('')}</tr></thead>
        <tbody><tr><td>${rr.category.icon} ${rr.category.label}</td>${active.map(p=>{
          const val = /** @type {Object<number,number>} */(rr.values)[p.id];
          return `<td class="${rr.winners.includes(p.id)?'winner-cell':''}">${fmtStat(rr.category.key, val)}</td>`;
        }).join('')}</tr></tbody></table>
        <p><b>${winnerNames} won the card!</b> (+1 🃏 each)</p>
      `}
      ${G.stage==='round-result'
        ? (mode==='solo'
            ? `<button class="btn-next" onclick="nextRound()">Next Round</button>`
            : `<p class="status-line">Next round starting…</p>`)
        : ''}
    </div>`;
  }

  let gameOverHtml = '';
  if(G.stage==='game-over' && G.gameResult){
    const gr = G.gameResult;
    const winnerNames = gr.winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ');
    gameOverHtml = `<div id="game-over">
      <h2>🏆 Game Over</h2>
      <p>${G.players.map(p=>`${p.name}: ${p.wonCategories.map(c=>c.icon).join('') || '—'}`).join(' &nbsp;|&nbsp; ')}</p>
      <p><b>${winnerNames} win${gr.winners.length===1?'s':''} the match!</b></p>
      ${mode==='solo'
        ? `<button class="btn-next" onclick="renderStart()">New Game</button>`
        : `<button class="btn-next" onclick="backToLobby()">Back to Lobby</button>`}
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

    <div class="you-seat ${human.folded?'folded':''} ${human.eliminated?'eliminated':''} ${checkedId===mySeatId?'just-checked':''}" data-seat="${mySeatId}">
      ${checkedId===mySeatId ? `<div class="check-tap">✊</div>` : ''}
      ${human.eliminated
        ? `<div class="spectator-tag">Spectator</div>`
        : `<div class="hole-cards ${lastAction && lastAction.playerId===mySeatId && lastAction.action==='fold' ? 'just-folded' : ''}">${holeHtml}</div>`}
      <div class="you-header">
        <div class="you-name">You${human.eliminated?' (spectator)':human.folded?' (folded)':''}</div>
        <div class="cards-tally">${human.wonCategories.map(c=>c.icon).join('')}</div>
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
