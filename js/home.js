// @ts-check
// Landing page, and the main menu for signed-in players. Signed-out visitors see a short landing screen
// with the logo and three buttons, modelled on Wordle's front page:
//   - Log in / Sign up: the sign-in page. Playing needs an account, so there's no play button here.
// Signed-in players get the menu, with one big button per way to play, like chess.com's Play screen:
//   - Start game: ranked matchmaking, which opens the lobby already searching,
//   - Play with friends: the lobby, to create or join a room,
//   - Practice vs Bots: solo play against two bot opponents.

import { mountChrome } from '../social/chrome.js';
import { escapeHtml } from './ui.js';
import { displayName } from './trivia.js';

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

async function init(){
  const res = await fetch('/api/me');
  if(!res.ok){
    renderLanding();
    return;
  }
  const me = /** @type {{username:string, elo:number}} */ (await res.json());
  await mountChrome({active: 'play', title: 'Quantrivia', back: null});
  render(me);
  loadChallenges();
  setInterval(loadChallenges, 15000);
}

/**
 * Challenges from friends that are still waiting for players, shown above the menu buttons.
 * Refreshed every 15 seconds, so a new challenge appears without a page reload.
 */
async function loadChallenges(){
  const box = document.getElementById('challenges');
  if(!box) return;
  const res = await fetch('/api/challenges');
  if(!res.ok) return;
  const { challenges } = /** @type {{challenges: Array<{id:number, roomId:string, from:string}>}} */ (await res.json());
  box.innerHTML = challenges.map(c => `
    <div class="challenge-card">
      <p class="challenge-text"><b>${escapeHtml(displayName(c.from))}</b> challenged you</p>
      <div class="challenge-actions">
        <button class="btn primary yellow" data-join="${escapeHtml(c.roomId)}">Join</button>
        <button class="btn ghost" data-dismiss="${c.id}">Dismiss</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-join]').forEach(el => {
    el.addEventListener('click', () => {
      location.href = `/lobby/lobby.html?join=${encodeURIComponent(/** @type {HTMLElement} */ (el).dataset.join ?? '')}`;
    });
  });
  box.querySelectorAll('[data-dismiss]').forEach(el => {
    el.addEventListener('click', async () => {
      await fetch(`/api/challenges/${/** @type {HTMLElement} */ (el).dataset.dismiss}`, {method: 'DELETE'});
      loadChallenges();
    });
  });
}

// The Quantrivia mark: a lens ring with a tail and a blue answer dot. Same drawing as the logo options.
function renderLanding(){
  app.innerHTML = `
    <div class="landing">
      <svg class="landing-mark" viewBox="0 0 120 120" role="img" aria-label="Quantrivia">
        <circle cx="56" cy="56" r="30" fill="none" stroke="#fffa0b" stroke-width="13"/>
        <path d="M76 78 L94 98" stroke="#fffa0b" stroke-width="13" stroke-linecap="round"/>
        <circle cx="56" cy="56" r="6" fill="#7acaf6"/>
      </svg>
      <h1 class="landing-title">Quantrivia</h1>
      <p class="landing-tagline">a numbers based trivia game</p>
      <div class="landing-actions">
        <a class="btn" href="/auth/login.html">Log in</a>
        <a class="btn primary" href="/auth/login.html?mode=signup">Sign up</a>
      </div>
    </div>`;
}

/** @param {{username:string, elo:number}} me */
function render(me){
  app.innerHTML = `
    <div class="menu">
      <div class="menu-logo">
        <svg class="landing-mark" viewBox="0 0 120 120" role="img" aria-label="Quantrivia">
          <circle cx="56" cy="56" r="30" fill="none" stroke="#fffa0b" stroke-width="13"/>
          <path d="M76 78 L94 98" stroke="#fffa0b" stroke-width="13" stroke-linecap="round"/>
          <circle cx="56" cy="56" r="6" fill="#7acaf6"/>
        </svg>
        <h1 class="landing-title">Quantrivia</h1>
      </div>
      <p class="menu-signed">Signed in as <b>${escapeHtml(displayName(me.username))}</b> · Rating <b class="mono">${me.elo}</b></p>
      <div class="challenges" id="challenges"></div>
      <a class="btn lime big" href="/solo.html?daily=1">Play the Daily</a>
      <a class="btn primary yellow big" href="/lobby/lobby.html?mode=ranked">Play Ranked</a>
      <a class="btn panel big" href="/lobby/lobby.html?mode=friends">Play with friends</a>
      <a class="btn panel big" href="/solo.html">Practice vs Bots</a>
      <button class="btn panel big" id="logoutBtn">Log out</button>
    </div>`;
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/logout', {method: 'POST'});
    location.replace('/auth/login.html');
  });
}

init();
