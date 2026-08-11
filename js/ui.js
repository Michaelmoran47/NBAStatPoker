// @ts-check
// All DOM rendering and user-input handling. This is the only module that touches
// `document` — everything it needs from the game (state, rules, scoring) is imported,
// nothing here leaks the other direction. That keeps the door open to swapping this
// file out for a different client (or a thin multiplayer client) without touching engine.js.

import { ANTE, MIN_RAISE, ROUNDS, makeGame } from './state.js';
import { currentMaxBet, ACTION_TIMEOUT_MS, timeoutAction } from './betting.js';
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

// How long the round-reveal animation holds on each player's combined stat before the
// card flies to the winner, and how long that flight itself takes. Both the solo
// auto-advance timer below and the animation sequencing in renderGame() are driven off
// these same two numbers so they can never drift out of sync with each other.
const REVEAL_HOLD_MS = 5000;
const CARD_FLY_MS = 650;

// A single chip's travel time (matches the .chip-fly transition duration in CSS — kept
// here too since flyChip's cleanup setTimeout needs to know when the animation is
// actually done). A raise fires two chips STAGGER_MS apart rather than nearly at once —
// that gap is what actually reads as "more chips going in" instead of a call with an
// extra chip blurred on top of it.
const CHIP_FLY_MS = 500;
const RAISE_CHIP_STAGGER_MS = 220;
// How long the floating "CALL $X"/"RAISE $X" label stays up — matches .bet-amount-pop's
// own animation duration in CSS.
const BET_POP_MS = 900;

// There used to be a "Next Round" button the human clicked once they'd read the round
// result. Now that round-result is a timed animation instead of a static popup, solo
// play needs to drive itself forward the same way the multiplayer server already does
// for everyone else (see NEXT_ROUND_DELAY_MS in server/game-rooms.js) — this timer is
// solo's equivalent. Lives here (not in renderGame) because renderGame is also called
// directly by the multiplayer client, which must never self-advance a server-authoritative
// match.
/** @type {ReturnType<typeof setTimeout>|null} */
let advanceTimer = null;

// Tracks which round-result the animation has already played for, so a re-render that
// doesn't represent a *new* round outcome (there shouldn't be one, but better safe)
// never restarts the reveal from scratch. Keyed by round number + category rather than
// object identity, since a multiplayer GameState is JSON off the wire — a fresh object
// every broadcast even when nothing actually changed.
/** @type {string|null} */
let lastRevealedResultKey = null;

// Tracks which round-result's winnings have actually "landed" — set inside
// flyStatCardToWinners's own landing timeout, the moment the flying card reaches the
// winner. Until then, renderGame() deliberately displays a winner's *pre-round* chips
// and tally (see displayChips/displayTallyIcons below) even though G.players itself was
// already updated back when resolveRound() ran — so a stray re-render mid-reveal (e.g.
// multiplayer's reconnect resync) can't let the real numbers leak out early.
/** @type {string|null} */
let landedResultKey = null;

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
// button click calls humanAction() above — or, if ACTION_TIMEOUT_MS passes first, until
// this timeout resolves it itself. The `state.resolveHuman === res` check is what makes
// a late click harmless once that's happened: humanAction() reads state.resolveHuman
// fresh at click time, so if the timeout already nulled it out (or a later turn already
// replaced it with its own resolver), a stale click is a no-op instead of hijacking
// whatever's currently pending.
/** @type {import('./state.js').RequestActionFn} */
function requestAction(seatId){
  return new Promise(res => {
    state.resolveHuman = res;
    setTimeout(()=>{
      if(state.resolveHuman === res && state.G){
        state.resolveHuman = null;
        const p = /** @type {import('./state.js').GamePlayer} */ (state.G.players.find(x=>x.id===seatId));
        res(timeoutAction(state.G, p));
      }
    }, ACTION_TIMEOUT_MS);
  });
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
 * @param {number} displayChips What to show for this seat's chip total — may be less
 *   than p.chips while this round's win hasn't "landed" yet (see landedResultKey).
 * @param {import('./data.js').Category[]} displayTally Which tally icons to show — may
 *   omit this round's just-won card for the same reason.
 * @param {{text:string, isWinner:boolean, folded:boolean}|null} stat This round's
 *   combined-stat badge, shown right on the seat during the reveal — null outside that
 *   window. `folded` is only ever true for the human's own private post-fold reveal
 *   (see humanStat in renderGame) — opponents never get one, folded or not.
 */
function renderSeat(p, actingId, revealHoles, side, justChecked, displayChips, displayTally, stat){
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

  // The stat badge sits beside the cards (in their own row), not stacked underneath the
  // name/chips — reads as "here's their hand's number" rather than another line in the
  // vertical stack of seat info.
  const statPopHtml = stat ? `<div class="seat-stat-pop ${stat.isWinner?'winner':''}">${stat.text}</div>` : '';

  return `
    <div class="seat ${side} ${p.folded?'folded':''} ${p.eliminated?'eliminated':''} ${actingId===p.id?'acting':''} ${justChecked?'just-checked':''}" data-seat="${p.id}">
      ${justChecked ? `<div class="check-tap">✊</div>` : ''}
      <div class="seat-cards-row">${cardsHtml}${statPopHtml}</div>
      <div class="seat-name">${p.name}</div>
      ${p.eliminated ? '' : `<div class="seat-chips chip-amount">$${displayChips}${p.allIn?' (all-in)':''}</div>`}
      <div class="cards-tally">${displayTally.map(c=>c.icon).join('')}</div>
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
    setTimeout(()=>{ chip.remove(); }, CHIP_FLY_MS + 180); // + the opacity fade's own tail, see .chip-fly
  }, delay || 0);
}

// The floating "CALL $X" / "RAISE $X" label — appended to document.body rather than
// baked into the seat's own template markup for the same reason flyChip is: the next
// actor's "your turn" render fires only ~150ms later (see bettingRound's sleep(150) in
// betting.js) and would wipe out anything embedded in #app's innerHTML long before its
// own animation actually finished. Living outside #app is what lets this play its full
// BET_POP_MS instead of getting cut off after a fraction of it.
/**
 * @param {string} fromSelector
 * @param {'call'|'raise'} action
 * @param {number|undefined} amount
 */
function popBetAmount(fromSelector, action, amount){
  if(amount===undefined) return;
  const fromEl = document.querySelector(fromSelector);
  if(!fromEl) return;
  const rect = fromEl.getBoundingClientRect();
  const label = document.createElement('div');
  label.className = `bet-amount-pop ${action}`;
  label.textContent = `${action==='raise' ? 'RAISE' : 'CALL'} $${amount}`;
  label.style.left = (rect.left + rect.width/2) + 'px';
  label.style.top = rect.top + 'px';
  document.body.appendChild(label);
  setTimeout(()=>{ label.remove(); }, BET_POP_MS);
}

// The second half of the round-reveal sequence: clones the center stat card and sends
// one copy flying to each winner's seat (more than one on a tie), then bumps that
// seat's card tally once it "lands" — same clone-a-floating-element-and-transform
// technique as flyChip above, just with a dynamic per-seat destination instead of a
// single fixed pot target. This is also the moment the winner's chip total and tally
// icon actually update in the DOM — renderGame() was deliberately showing pre-round
// values until now (see displayChips/displayTally + landedResultKey), so patching them
// in here means the win visibly *arrives* with the card instead of already having
// happened silently five seconds earlier.
/**
 * @param {import('./state.js').GameState} G
 * @param {number[]} winnerIds
 * @param {string} resultKey
 */
function flyStatCardToWinners(G, winnerIds, resultKey){
  const cardEl = document.querySelector('.center-column .stat-card');
  if(!cardEl) return;
  const from = cardEl.getBoundingClientRect();
  winnerIds.forEach(id=>{
    const seatEl = document.querySelector(`[data-seat="${id}"]`);
    const tallyEl = seatEl && seatEl.querySelector('.cards-tally');
    const chipEl = seatEl && seatEl.querySelector('.chip-amount');
    if(!seatEl) return;
    const to = (tallyEl || seatEl).getBoundingClientRect();
    const clone = /** @type {HTMLElement} */ (cardEl.cloneNode(true));
    clone.classList.add('stat-card-fly');
    clone.style.width = from.width + 'px';
    clone.style.height = from.height + 'px';
    clone.style.left = from.left + 'px';
    clone.style.top = from.top + 'px';
    document.body.appendChild(clone);
    const dx = (to.left + to.width/2) - (from.left + from.width/2);
    const dy = (to.top + to.height/2) - (from.top + from.height/2);
    requestAnimationFrame(()=>{
      clone.style.transform = `translate(${dx}px,${dy}px) scale(.2)`;
      clone.style.opacity = '0';
    });
    setTimeout(()=>{
      clone.remove();
      landedResultKey = resultKey;
      const player = G.players.find(pl=>pl.id===id);
      if(player){
        const allInTag = seatEl.classList.contains('you-seat') ? '' : (player.allIn ? ' (all-in)' : ''); // matches each seat's own pre-existing formatting
        if(chipEl) chipEl.textContent = `$${player.chips}${allInTag}`;
        if(tallyEl) tallyEl.innerHTML = player.wonCategories.map(c=>c.icon).join('');
      }
      if(tallyEl){
        tallyEl.classList.add('just-won');
        setTimeout(()=>tallyEl.classList.remove('just-won'), 500);
      }
    }, CARD_FLY_MS);
  });
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

  // Solo drives its own round-to-round pacing (multiplayer's equivalent lives in
  // server/game-rooms.js's runGame loop instead). Only (re)armed on the render that
  // actually entered round-result — every other render this round (betting actions,
  // etc.) leaves stage something else and this is a no-op.
  if(state.G.stage==='round-result'){
    if(advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = setTimeout(()=>{
      advanceTimer = null;
      if(state.G && state.G.stage==='round-result') nextRound();
    }, REVEAL_HOLD_MS + CARD_FLY_MS + 400);
  }
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

  // While this round's result is showing but hasn't "landed" yet (see landedResultKey's
  // own comment), a winner's chip total and tally icon are deliberately displayed as
  // they were *before* this round's payout — the win visibly arrives with the card-fly
  // animation instead of having already happened silently the instant the round ended.
  // gameNum is part of the key (not just round+category) so a new game's round 1
  // revealing the same category its predecessor's round 1 did doesn't get mistaken for
  // "already handled" and skip both the reveal animation and the payout suppression.
  const resultKey = G.roundResult ? `${G.gameNum}:${G.round}:${G.roundResult.category.key}` : null;
  const isPendingReveal = resultKey!==null && (G.stage==='round-result' || G.stage==='game-over') && resultKey!==landedResultKey;
  /** @param {import('./state.js').GamePlayer} p @returns {number} */
  const displayChips = p => {
    if(isPendingReveal && G.roundResult && G.roundResult.winners.includes(p.id)){
      return p.chips - (G.roundResult.payouts[p.id] || 0);
    }
    return p.chips;
  };
  /** @param {import('./state.js').GamePlayer} p @returns {import('./data.js').Category[]} */
  const displayTally = p => {
    if(isPendingReveal && G.roundResult && G.roundResult.winners.includes(p.id)){
      return p.wonCategories.slice(0, -1);
    }
    return p.wonCategories;
  };
  // The round-reveal's combined-stat badge, shown right on each player's own seat
  // (rather than in one separate list you have to match names against) for as long as
  // the result is up — fades out on its own cue once the card starts its flight, same
  // moment displayChips/displayTally above start telling the truth.
  /** @param {import('./state.js').GamePlayer} p @returns {{text:string, isWinner:boolean, folded:boolean}|null} */
  const statFor = p => {
    const rr = G.roundResult;
    if(!rr || !(G.stage==='round-result' || G.stage==='game-over') || !(p.id in rr.values)) return null;
    return {text: fmtStat(rr.category.key, rr.values[p.id]), isWinner: rr.winners.includes(p.id), folded: false};
  };

  const seatLeft = opponents[0] ? renderSeat(opponents[0], actingId, revealHoles, 'seat-left', checkedId===opponents[0].id, displayChips(opponents[0]), displayTally(opponents[0]), statFor(opponents[0])) : `<div class="seat-left"></div>`;
  const seatRight = opponents[1] ? renderSeat(opponents[1], actingId, revealHoles, 'seat-right', checkedId===opponents[1].id, displayChips(opponents[1]), displayTally(opponents[1]), statFor(opponents[1])) : `<div class="seat-right"></div>`;

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
  // If you folded this round, statFor(human) comes back null — scoreCategories never
  // ran on you, so you're not in rr.values and there's no verdict to show. You can
  // still privately see what your own hand would have scored, though: your own hole
  // cards are never redacted from your own view (see viewFor in state.js), so this is
  // computed straight from them client-side rather than added to G.roundResult — it
  // never becomes part of the shared game state, so nobody else's client ever sees it,
  // only yours.
  const humanStat = statFor(human) || (() => {
    const rr = G.roundResult;
    // G.roundResult isn't cleared by startRound() — it's only ever overwritten when
    // resolveRound() runs again, so during the *current* round's own betting phase it's
    // still holding the *previous* round's result. Without this stage check, folding
    // early in a round would show last round's category/value for a beat before this
    // round even resolves — gate on the same reveal window statFor() uses.
    if(!rr || !(G.stage==='round-result' || G.stage==='game-over') || !human.folded || human.hole.length!==2) return null;
    const key = /** @type {keyof import('./data.js').NBAPlayer} */ (rr.category.key);
    const value = /** @type {number} */(human.hole[0][key]) + /** @type {number} */(human.hole[1][key]);
    return {text: fmtStat(rr.category.key, value), isWinner: false, folded: true};
  })();

  const minRaiseTo = maxBet+MIN_RAISE;
  const maxRaiseTo = human.chips+human.roundBet;
  // If a player's stack can't cover even the minimum legal raise, don't offer one —
  // a slider whose min exceeds its max just freezes, undraggable, which is exactly
  // the "raise slider doesn't work" bug this replaces.
  const canRaise = maxRaiseTo >= minRaiseTo;
  const raiseDefault = Math.min(minRaiseTo+MIN_RAISE, maxRaiseTo);

  let controlsHtml = '';
  if(G.stage==='betting'){
    // The bar's own countdown is driven entirely by CSS (a full-width-to-empty
    // transition timed to ACTION_TIMEOUT_MS via the inline custom property below) — it's
    // purely a visual echo of the actual clock enforced in requestAction() above; if the
    // human acts first, this element just gets torn down with the rest of .controls on
    // the next render, same as everything else here.
    controlsHtml = humanTurn ? `
      <div class="controls">
        <div class="action-timer" style="--action-timeout:${ACTION_TIMEOUT_MS}ms"><div class="action-timer-bar"></div></div>
        <div class="actions">
          <button class="btn btn-fold" onclick="humanAction('fold')">Fold</button>
          <button class="btn btn-call" onclick="humanAction('call')">${callAmount>0? 'Call $'+callAmount : 'Check'}</button>
          ${canRaise ? `<button class="btn btn-raise" id="raiseBtn" onclick="doRaise()">Raise ${raiseDefault}</button>` : ''}
        </div>
        ${canRaise ? `<input type="range" class="raise-slider" id="raiseSlider" min="${minRaiseTo}" max="${maxRaiseTo}" step="1" value="${raiseDefault}" oninput="updateRaiseLabel(this.value)">` : ''}
      </div>` : `<div class="controls"><div class="status-line">${human.eliminated ? "You're out — watching the rest of the match." : 'Waiting on other players…'}</div></div>`;
  }

  // Replaces the old static "here's who won, click Next Round" popup: this is now just
  // a category header — the actual per-player numbers live on each seat itself (see
  // statFor/.seat-stat-pop above), so comparing them doesn't mean looking away from the
  // table to a separate list and matching names back up. Holds for REVEAL_HOLD_MS, then
  // (see the resultKey block below, once this HTML is actually in the DOM) the stat card
  // flies to the winner's seat and — for solo — the match advances itself. No button,
  // nothing to click.
  let roundResultHtml = '';
  if((G.stage==='round-result' || G.stage==='game-over') && G.roundResult){
    const rr = G.roundResult;
    roundResultHtml = `<div id="round-reveal">
      <h3>${rr.category.icon} ${rr.category.label} — Round ${G.round}/${ROUNDS}</h3>
      ${rr.uncontested ? `<p class="reveal-note">Uncontested — everyone else folded.</p>` : ''}
    </div>`;
  }

  let gameOverHtml = '';
  if(G.stage==='game-over' && G.gameResult){
    const gr = G.gameResult;
    const winnerNames = gr.winners.map(id=>/** @type {import('./state.js').GamePlayer} */(G.players.find(p=>p.id===id)).name).join(' & ');
    gameOverHtml = `<div id="game-over">
      <h2>🏆 Game Over</h2>
      <p>${G.players.map(p=>`${p.name}: ${displayTally(p).map(c=>c.icon).join('') || '—'}`).join(' &nbsp;|&nbsp; ')}</p>
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
        : `<div class="seat-cards-row">
            <div class="hole-cards ${lastAction && lastAction.playerId===mySeatId && lastAction.action==='fold' ? 'just-folded' : ''}">${holeHtml}</div>
            ${humanStat ? `<div class="seat-stat-pop ${humanStat.isWinner?'winner':''} ${humanStat.folded?'folded-stat':''}">${humanStat.text}</div>` : ''}
          </div>`}
      <div class="you-header">
        <div class="you-name">You${human.eliminated?' (spectator)':human.folded?' (folded)':''}</div>
        <div class="cards-tally">${displayTally(human).map(c=>c.icon).join('')}</div>
        <div class="you-chips chip-amount">$${displayChips(human)}</div>
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
      popBetAmount(seatSelector, 'call', lastAction.amount);
    } else if(lastAction.action==='raise'){
      flyChip(seatSelector);
      flyChip(seatSelector, RAISE_CHIP_STAGGER_MS);
      popBetAmount(seatSelector, 'raise', lastAction.amount);
    }
  }

  // Kick off the round-reveal's second beat — the stat card flying to the winner —
  // once the first beat (each seat's own .seat-stat-pop, holding for REVEAL_HOLD_MS) has
  // had its moment. Keyed by round+category rather than run unconditionally on every
  // render, so a render that re-displays the *same* still-open round result (nothing
  // else re-renders during this window in practice, but the guard costs nothing) never
  // restarts or double-plays the flight.
  if(G.roundResult && resultKey && (G.stage==='round-result' || G.stage==='game-over')){
    if(resultKey !== lastRevealedResultKey){
      lastRevealedResultKey = resultKey;
      const winners = G.roundResult.winners;
      setTimeout(()=>{
        document.querySelectorAll('.seat-stat-pop').forEach(el=>el.classList.add('fading'));
        flyStatCardToWinners(G, winners, resultKey);
      }, REVEAL_HOLD_MS);
    }
  }
}
