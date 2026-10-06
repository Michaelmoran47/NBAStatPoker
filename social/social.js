// @ts-check
// The social pages: a profile, the friends screen (requests and list), and the friend leaderboard.
// One page, switched by the URL: ?user=NAME for a profile, ?view=leaderboard, otherwise friends.
// This file only displays. The server decides what each viewer may see, and every write goes
// through the /api/friends routes, which act on the signed-in session user.

import { escapeHtml, shareLink } from '../js/ui.js';
import { displayName } from '../js/trivia.js';
import { mountChrome } from './chrome.js';

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const params = new URLSearchParams(location.search);
const userParam = params.get('user');
const view = params.get('view') ?? 'friends';

/** Shown once at the top of the next render, e.g. "Request sent." or an error. */
let notice = '';
/** Re-renders whichever screen is up. Set by route() so actions can refresh in place. */
/** @type {() => Promise<void>} */
let rerender = async () => {};

// Avatar colours, all bright enough for the dark ink letter on top. Chosen by username, so a player
// keeps the same colour everywhere they appear.
const AVATAR_COLORS = ['#fffa0b', '#7acaf6', '#7c73c7', '#65c853', '#38bdf8', '#fb923c'];

/**
 * One JSON call. A 401 means the session is gone, so send the player to log in.
 * @param {'GET'|'POST'|'DELETE'} method @param {string} url @param {object} [body]
 * @returns {Promise<any>}
 */
async function api(method, url, body){
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if(res.status === 401){
    location.href = '/auth/login.html';
    throw new Error('Not logged in.');
  }
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/** @param {string} username the full stored username; the link itself uses it, the text shows displayName */
function nameLink(username){
  return `<a class="name-link" href="/social/social.html?user=${encodeURIComponent(username)}">${escapeHtml(displayName(username))}</a>`;
}

/**
 * A coloured circle with the player's first letter. Colour comes from a hash of the username, so it
 * stays the same across screens.
 * @param {string} username
 * @param {boolean} [large]
 */
function avatarHtml(username, large = false){
  const name = displayName(username);
  let hash = 0;
  for(const ch of username) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return `<span class="cc-avatar${large ? ' lg' : ''}" style="background:${color}" aria-hidden="true">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
}

/**
 * The "…" button and its small pop-up. Destructive actions live in here, so they aren't one tap away
 * on the list itself.
 * @param {string} username
 */
function moreMenuHtml(username){
  return `
    <div class="cc-menu-wrap">
      <button class="btn ghost cc-more" data-act="menu" aria-label="More actions for ${escapeHtml(displayName(username))}" aria-haspopup="menu" aria-expanded="false">⋯</button>
      <div class="cc-menu" role="menu" hidden>
        <button role="menuitem" data-act="remove" data-user="${escapeHtml(username)}">Remove friend</button>
      </div>
    </div>`;
}

/** @param {string} text */
function noticeHtml(text){
  return text ? `<div class="lobby-error" role="status">${escapeHtml(text)}</div>` : '';
}

/** @param {string} stamp SQLite datetime('now') text, which is UTC without a zone marker */
function formatDate(stamp){
  const d = new Date(stamp.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

async function renderFriends(){
  const data = await api('GET', '/api/friends');
  const list = (/** @type {Array<{username:string}>} */ items, /** @type {string} */ empty, /** @type {(u:string)=>string} */ actions) =>
    items.length === 0
      ? `<p class="cc-empty">${empty}</p>`
      : `<div class="cc-list">${items.map(i => `
        <div class="cc-row">
          ${avatarHtml(i.username)}
          <div class="cc-row-main">${nameLink(i.username)}</div>
          <div class="cc-row-actions">${actions(i.username)}</div>
        </div>`).join('')}</div>`;

  app.innerHTML = `
    <div class="social-page">
      ${noticeHtml(notice)}
      <div class="pap-actions">
        <button class="pap-action" data-act="invite">Invite friends to Quantrivia!</button>
        <button class="pap-action" data-act="challenge-open">Challenge your Friends</button>
      </div>
      <form class="cc-form" id="addFriendForm" autocomplete="off">
        <input class="cc-input" id="addFriendInput" type="text" maxlength="200" placeholder="Add by username" aria-label="Username to add" required>
        <button class="btn primary" type="submit">Add friend</button>
      </form>

      ${data.incoming.length > 0 ? `
      <section class="cc-panel">
        <h2 class="cc-heading">Requests <span class="cc-badge">${data.incoming.length}</span></h2>
        ${list(data.incoming, '', u =>
          `<button class="btn primary" data-act="accept" data-user="${escapeHtml(u)}">Accept</button>
           <button class="btn ghost" data-act="decline" data-user="${escapeHtml(u)}">Decline</button>`)}
      </section>` : ''}

      ${data.outgoing.length > 0 ? `
      <section class="cc-panel">
        <h2 class="cc-heading">Sent</h2>
        ${list(data.outgoing, '', u =>
          `<button class="btn ghost" data-act="cancel" data-user="${escapeHtml(u)}">Cancel</button>`)}
      </section>` : ''}

      <section class="cc-panel">
        <div class="cc-heading-row">
          <h2 class="cc-heading">Friends <span class="cc-badge">${data.friends.length}</span></h2>
          <a class="cc-link" href="/social/social.html?view=leaderboard">Leaderboard</a>
        </div>
        ${data.friends.length === 0
          ? '<p class="cc-empty">No friends yet. Invite someone above.</p>'
          : `<div class="cc-list">${data.friends.map(/** @param {{username:string, elo:number}} f */ f => `
            <div class="cc-row friend-row" data-search="${escapeHtml(`${displayName(f.username)} ${f.username}`.toLowerCase())}">
              ${avatarHtml(f.username)}
              <div class="cc-row-main">${nameLink(f.username)}<span class="cc-row-sub">Rating ${f.elo}</span></div>
              <div class="cc-row-actions">
                ${moreMenuHtml(f.username)}
              </div>
            </div>`).join('')}</div>
          `}
      </section>
    </div>`;
  notice = '';
}

/** @param {string} username */
async function renderProfile(username){
  const p = await api('GET', `/api/profile/${encodeURIComponent(username)}`);
  const games = p.wins + p.losses;
  const rate = games ? `${Math.round((p.wins / games) * 100)}%` : '—';

  /** @type {Record<string, string>} */
  const actionsByRel = {
    self: '',
    friends: `<button class="btn primary" data-act="challenge" data-user="${escapeHtml(p.username)}">Challenge</button>
              ${moreMenuHtml(p.username)}`,
    outgoing: `<button class="btn ghost" data-act="cancel" data-user="${escapeHtml(p.username)}">Cancel request</button>`,
    incoming: `<button class="btn primary" data-act="accept" data-user="${escapeHtml(p.username)}">Accept</button>
               <button class="btn ghost" data-act="decline" data-user="${escapeHtml(p.username)}">Decline</button>`,
    none: `<button class="btn primary" data-act="add" data-user="${escapeHtml(p.username)}">Add friend</button>`
  };
  const relNote = { self: 'This is you', friends: 'Friends', outgoing: 'Request sent', incoming: 'Wants to be friends', none: '' }[/** @type {string} */ (p.relationship)] ?? '';

  /** @type {string} */
  let matchesHtml;
  if(p.recentMatches === null){
    matchesHtml = '<p class="cc-empty">Recent games are shared with friends.</p>';
  } else if(p.recentMatches.length === 0){
    matchesHtml = '<p class="cc-empty">No games played yet.</p>';
  } else {
    matchesHtml = `<div class="cc-list">${p.recentMatches.map(/** @param {{result:string, elo_delta:number|null, created_at:string}} m */ m => {
      const won = m.result === 'win';
      const delta = m.elo_delta == null ? '' : `${m.elo_delta > 0 ? '+' : ''}${m.elo_delta}`;
      return `
        <div class="cc-row">
          <span class="cc-result ${won ? 'win' : 'loss'}" aria-label="${won ? 'Win' : 'Loss'}">${won ? 'W' : 'L'}</span>
          <div class="cc-row-main"><span class="cc-row-title">${won ? 'Win' : 'Loss'}</span><span class="cc-row-sub">${escapeHtml(formatDate(m.created_at))}</span></div>
          <div class="cc-row-actions"><span class="cc-delta mono ${m.elo_delta && m.elo_delta > 0 ? 'up' : m.elo_delta && m.elo_delta < 0 ? 'down' : ''}">${escapeHtml(delta)}</span></div>
        </div>`;
    }).join('')}</div>`;
  }

  app.innerHTML = `
    <div class="social-page">
      ${noticeHtml(notice)}
      <section class="cc-hero">
        ${avatarHtml(p.username, true)}
        <h1 class="cc-name">${escapeHtml(displayName(p.username))}</h1>
        ${relNote ? `<p class="cc-sub">${escapeHtml(relNote)}</p>` : ''}
        <p class="cc-rating"><b class="mono">${p.elo}</b>Rating</p>
        ${actionsByRel[p.relationship] ? `<div class="cc-hero-actions">${actionsByRel[p.relationship]}</div>` : ''}
      </section>

      <div class="cc-tiles">
        <div class="cc-tile"><span class="cc-tile-label">Rating</span><b class="mono">${p.elo}</b></div>
        <div class="cc-tile"><span class="cc-tile-label">Win rate</span><b class="mono">${rate}</b></div>
        <div class="cc-tile"><span class="cc-tile-label">Wins</span><b class="mono">${p.wins}</b></div>
        <div class="cc-tile"><span class="cc-tile-label">Losses</span><b class="mono">${p.losses}</b></div>
      </div>

      <section class="cc-panel">
        <h2 class="cc-heading">Recent games</h2>
        ${matchesHtml}
      </section>
    </div>`;
  notice = '';
}

async function renderLeaderboard(){
  const data = await api('GET', '/api/leaderboard/friends');
  app.innerHTML = `
    <div class="social-page">
      ${noticeHtml(notice)}
      <section class="cc-panel">
        <h2 class="cc-heading">Leaderboard · friends by rating</h2>
        <ol class="cc-list lb-list">
          ${data.entries.map(/** @param {{rank:number, username:string, elo:number, isMe:boolean}} e */ e => `
            <li class="cc-row lb-row${e.isMe ? ' me' : ''}">
              <span class="lb-rank mono">${e.rank}</span>
              ${avatarHtml(e.username)}
              <div class="cc-row-main">${nameLink(e.username)}${e.isMe ? '<span class="cc-row-sub">You</span>' : ''}</div>
              <span class="lb-elo mono">${e.elo}</span>
            </li>`).join('')}
        </ol>
        ${data.entries.length === 1 ? '<p class="cc-empty">Add friends to see them ranked here.</p>' : ''}
      </section>
    </div>`;
  notice = '';
}

async function route(){
  if(userParam){
    rerender = () => renderProfile(userParam);
  } else if(view === 'leaderboard'){
    rerender = renderLeaderboard;
  } else {
    rerender = renderFriends;
  }
  try{
    await rerender();
  } catch (err) {
    app.innerHTML = `<div class="lobby-error" role="alert">${escapeHtml(err instanceof Error ? err.message : 'Something went wrong.')}</div>`;
  }
}

/** Hides every "…" pop-up and resets its button's aria-expanded. */
function closeMenus(){
  app.querySelectorAll('.cc-menu').forEach(m => m.setAttribute('hidden', ''));
  app.querySelectorAll('.cc-more').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

// Tapping anywhere outside a "…" button or its pop-up closes the pop-up.
document.addEventListener('click', (event) => {
  const inside = event.target instanceof Element && event.target.closest('.cc-menu-wrap');
  if(!inside) closeMenus();
});

// One delegated handler for every button, so re-rendering the screen never needs rebinding.
app.addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-act]') : null;
  if(!(target instanceof HTMLElement)) return;
  const username = target.dataset.user ?? '';
  const act = target.dataset.act;
  if(act === 'menu'){
    // Open this row's menu and close any other that's open.
    const menu = target.parentElement?.querySelector('.cc-menu');
    const willOpen = menu?.hasAttribute('hidden') ?? false;
    closeMenus();
    if(menu && willOpen){
      menu.removeAttribute('hidden');
      target.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  closeMenus();
  try{
    if(act === 'invite'){
      // A personal sign-up link. The friend who signs up through it becomes a friend straight away.
      const { code } = await api('GET', '/api/invite-code');
      await shareLink('Join me on Quantrivia', `${location.origin}/auth/login.html?invite=${encodeURIComponent(code)}`);
      return;
    } else if(act === 'challenge-open'){
      // A challenge link with no friend named. Anyone with the link can join the room.
      location.href = '/lobby/lobby.html?challenge';
      return;
    } else if(act === 'challenge'){
      // The lobby creates the room and offers the invite link. Nothing is sent from here.
      location.href = `/lobby/lobby.html?challenge=${encodeURIComponent(username)}`;
      return;
    } else if(act === 'add'){
      await api('POST', '/api/friends/request', { username });
      notice = 'Request sent.';
    } else if(act === 'accept'){
      await api('POST', '/api/friends/accept', { username });
      notice = `You are now friends with ${displayName(username)}.`;
    } else if(act === 'decline'){
      await api('POST', '/api/friends/decline', { username });
      notice = 'Request declined.';
    } else if(act === 'cancel'){
      await api('DELETE', `/api/friends/${encodeURIComponent(username)}`);
      notice = 'Request cancelled.';
    } else if(act === 'remove'){
      if(!confirm(`Remove ${displayName(username)} from your friends?`)) return;
      await api('DELETE', `/api/friends/${encodeURIComponent(username)}`);
      notice = 'Friend removed.';
    }
    await rerender();
  } catch (err) {
    notice = err instanceof Error ? err.message : 'Something went wrong.';
    await rerender().catch(() => {});
  }
});

app.addEventListener('submit', async (event) => {
  const form = event.target;
  if(!(form instanceof HTMLFormElement) || form.id !== 'addFriendForm') return;
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ (document.getElementById('addFriendInput'));
  const username = input.value.trim();
  if(!username) return;
  try{
    await api('POST', '/api/friends/request', { username });
    notice = `Request sent to ${displayName(username)}.`;
  } catch (err) {
    notice = err instanceof Error ? err.message : 'Something went wrong.';
  }
  await rerender().catch(() => {});
});

const active = userParam ? 'profile' : view === 'leaderboard' ? 'leaderboard' : 'friends';
mountChrome({
  active,
  title: active === 'profile' ? 'Profile' : active === 'leaderboard' ? 'Leaderboard' : 'Play a Friend',
  back: '/lobby/lobby.html',
});
route();
