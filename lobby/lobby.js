// @ts-check
// Real-time lobby: browse open rooms, create or join one, ready up, and the host starts. Once a
// room starts, the live match runs over the same WebSocket connection, with no page navigation.
// The match screen is js/ui.js's renderGame(), the same one solo play uses. Only where the
// view comes from differs: the server sends it, and the guess goes back over the socket.

import { renderGame, escapeHtml, shareLink } from '../js/ui.js';
import { displayName } from '../js/trivia.js';
import { mountChrome } from '../social/chrome.js';
// Mirrors MIN_SEATS_TO_START in server/rooms.js, so the Start button is only enabled when the server would accept it.
const MIN_SEATS_TO_START_CLIENT = 2;

const app = /** @type {HTMLElement} */ (document.getElementById('app'));


/** @type {{username:string, elo:number}|null} */
let me = null;
/** @type {'connecting'|'browse'|'room'|'game'|'queue'} */
let view = 'connecting';
/** @type {Array<{id:string, hostUsername:string, seatCount:number, maxSeats:number}>} */
let roomList = [];
/** @type {{id:string, hostUserId:number, maxSeats:number, seats:Array<{userId:number, username:string, ready:boolean}>, status:'waiting'|'started'}|null} */
let currentRoom = null;
/** @type {ReturnType<typeof import('../js/trivia.js').viewFor>|null} */
let gameState = null;
/** @type {number|null} */
let gameDeadline = null;
/** @type {Record<string, number>|null} */
let gameEloDeltas = null;
/** @type {string} */
let error = '';
/** Epoch ms when the player started searching for a ranked match. */
let queuedSince = 0;
/** @type {ReturnType<typeof setInterval>|null} */
let queueTimer = null;
/** @type {WebSocket|null} */
let socket = null;
// 'Start game' on the menu opens this page with ?mode=ranked. Join the queue once per page load.
let autoQueued = false;

// Friend challenges. The friends page opens this page with ?challenge=NAME, which creates a room. A
// friend's invite link opens it with ?join=ROOM_ID, which joins that room. Each runs once per page load.
// ?challenge=NAME challenges one friend. A bare ?challenge opens a room for anyone with the link.
const challengeRequested = new URLSearchParams(location.search).has('challenge');
const challengeName = new URLSearchParams(location.search).get('challenge') ?? '';
const joinRoomId = new URLSearchParams(location.search).get('join');
let autoChallenged = false;
let challengeNotified = false;
let autoJoined = false;

async function init(){
  const res = await fetch('/api/me');
  if(!res.ok){
    // Keep the current page (including any ?join= invite) so sign-in brings the player back to it.
    location.href = `../auth/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  me = await res.json();
  connect();
}

function connect(){
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    if(new URLSearchParams(location.search).get('mode') === 'ranked' && !autoQueued){
      autoQueued = true;
      send({type: 'queue-join'});
    }
    if(challengeRequested && !autoChallenged){
      autoChallenged = true;
      send({type: 'create-room'});
    }
    if(joinRoomId && !autoJoined){
      autoJoined = true;
      send({type: 'join-room', roomId: joinRoomId});
    }
    if(!gameState){
      currentRoom = null;
      view = 'browse';
    }
    render();
  });

  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if(msg.type === 'room-list'){
      roomList = msg.rooms;
      if(!currentRoom && !gameState) view = 'browse';
    } else if(msg.type === 'room-state'){
      currentRoom = msg.room;
      view = 'room';
      error = '';
      // A challenge to one friend: once the room exists, tell the friend about it on their home menu.
      if(challengeName && !challengeNotified && currentRoom.hostUserId === myUserId()){
        challengeNotified = true;
        fetch('/api/challenges', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({to: challengeName, roomId: currentRoom.id})
        }).catch(() => {});
      }
    } else if(msg.type === 'room-closed'){
      currentRoom = null;
      view = 'browse';
      error = 'The host left — room closed.';
    } else if(msg.type === 'game-state'){
      gameState = msg.state;
      gameDeadline = msg.deadline ?? null;
      gameEloDeltas = msg.eloDeltas ?? null;
      view = 'game';
      error = '';
    } else if(msg.type === 'queue-state'){
      if(msg.status === 'searching'){
        queuedSince = Date.now();
        view = 'queue';
      } else if(view === 'queue'){
        view = 'browse';
      }
      error = '';
    } else if(msg.type === 'error'){
      error = msg.message;
      if(/not in a room/i.test(msg.message)){
        currentRoom = null;
        if(view === 'room') view = 'browse';
      }
    }
    render();
  });

  socket.addEventListener('close', () => {
    view = 'connecting';
    error = 'Disconnected — reconnecting…';
    render();
    setTimeout(connect, 1500);
  });
}

/** @param {object} payload */
function send(payload){
  if(socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

/** @param {string} roomId */
function inviteUrl(roomId){
  return `${location.origin}/lobby/lobby.html?join=${encodeURIComponent(roomId)}`;
}

/** @param {string} url */
function sendInvite(url){
  return shareLink(`${displayName(me?.username ?? '')} challenged you to Quantrivia`, url);
}

function render(){
  // The sidebar is hidden during a match so the game gets the whole screen.
  // renderGame() sets the in-game class itself during a match. Every other view clears it.
  if(view !== 'game') document.body.classList.remove('in-game');

  if(view === 'connecting'){
    app.innerHTML = `
      <div class="start-card">
        <h1 class="lobby-title">Quantrivia</h1>
        <p class="sub">${escapeHtml(error) || 'Connecting…'}</p>
      </div>`;
    return;
  }

  if(view === 'game' && gameState){
    const over = gameState.stage === 'game-over';
    renderGame(gameState, {
      mode: 'multiplayer',
      deadline: gameDeadline,
      eloDeltas: gameEloDeltas,
      onGuess: (guess) => send({type: 'submit-guess', text: guess.text, unit: guess.unit}),
      // Once the match ends the server has torn the room down, so a reload is the cleanest way back.
      extra: over ? `<div class="lobby-actions">
        <button class="btn yellow" id="backToLobbyBtn">Back to lobby</button>
        <button class="btn primary" id="playAgainBtn">Play again</button>
      </div>` : ''
    });
    // The home menu has Start game and Play with friends. Play again opens the ranked queue fresh, so the
    // player waits for another random opponent right away.
    document.getElementById('backToLobbyBtn')?.addEventListener('click', () => { location.href = '/'; });
    document.getElementById('playAgainBtn')?.addEventListener('click', () => { location.href = '/lobby/lobby.html?mode=ranked'; });
    if(error){
      const banner = document.createElement('div');
      banner.className = 'toast';
      banner.textContent = error;
      app.prepend(banner);
    }
    return;
  }

  if(view === 'queue'){
    app.innerHTML = `
      <div class="start-card">
        <h1 class="lobby-title">Ranked</h1>
        <p class="sub">Searching for players near your rating of <b class="mono">${me?.elo ?? 1200}</b></p>
        <p class="queue-time mono" id="queueTime">0:00</p>
        <div class="lobby-error">${escapeHtml(error)}</div>
        <button class="btn ghost" id="cancelQueueBtn">Cancel</button>
      </div>`;
    // Leaving the queue goes home, to Start game, rather than falling back to the create-room page.
    document.getElementById('cancelQueueBtn')?.addEventListener('click', () => {
      send({type: 'queue-leave'});
      location.href = '/';
    });
    startQueueTimer();
    return;
  }
  stopQueueTimer();

  if(view === 'room' && currentRoom){
    const room = currentRoom;
    const mySeat = room.seats.find(s => s.userId === myUserId());
    const isHost = room.hostUserId === myUserId();
    const canStart = isHost && room.status === 'waiting'
      && room.seats.length >= MIN_SEATS_TO_START_CLIENT
      && room.seats.every(s => s.ready);
    const open = room.maxSeats - room.seats.length;

    const inviting = isHost && room.status === 'waiting' && open > 0;
    app.innerHTML = `
      <div class="start-card lobby-card">
        <h1 class="lobby-title">Room ${escapeHtml(room.id.slice(0,8))}</h1>
        ${challengeName && isHost ? `<p class="sub">Challenge for ${escapeHtml(displayName(challengeName))}</p>` : ''}
        <div class="seat-list">
          ${room.seats.map(s => `
            <div class="seat-row">
              <span class="seat-name"><a class="name-link" href="/social/social.html?user=${encodeURIComponent(s.username)}">${escapeHtml(displayName(s.username))}</a></span>
              <span class="seat-tags">
                ${s.userId === room.hostUserId ? '<span class="seat-tag host">Host</span>' : ''}
                <span class="seat-tag ${s.ready ? 'ready' : 'waiting'}">${s.ready ? 'Ready' : 'Not ready'}</span>
              </span>
            </div>`).join('')}
        </div>
        <p class="sub">${room.seats.length}/${room.maxSeats} seated${open > 0 ? ` · ${open} open` : ''} · needs ${MIN_SEATS_TO_START_CLIENT} to start</p>
        <div class="lobby-error">${escapeHtml(error)}</div>
        <div class="lobby-actions">
          <button class="btn" id="readyBtn">${mySeat?.ready ? 'Not ready' : 'Ready'}</button>
          ${isHost ? `<button class="btn primary" id="startBtn" ${canStart ? '' : 'disabled'}>Start match</button>` : ''}
        </div>
        ${inviting ? `
        <div class="invite-box">
          <p class="sub">Invite a friend to this room</p>
          <div class="lobby-actions">
            <button class="btn primary" id="textInviteBtn">Text invite</button>
            <button class="btn ghost" id="copyInviteBtn">Copy link</button>
          </div>
        </div>` : ''}
      </div>`;

    if(inviting){
      const url = inviteUrl(room.id);
      document.getElementById('textInviteBtn')?.addEventListener('click', () => sendInvite(url));
      document.getElementById('copyInviteBtn')?.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(url);
        const btn = document.getElementById('copyInviteBtn');
        if(btn) btn.textContent = 'Copied';
      });
    }

    document.getElementById('readyBtn')?.addEventListener('click', () => send({type:'ready'}));
    document.getElementById('startBtn')?.addEventListener('click', () => send({type:'start-room'}));
    return;
  }

  // browse
  app.innerHTML = `
    <div class="start-card lobby-card">
      <h1 class="lobby-title">Quantrivia</h1>
      <p class="sub">Signed in as <b>${escapeHtml(displayName(me?.username ?? ''))}</b> · Rating <b class="mono">${me?.elo ?? 1200}</b></p>
      <div class="lobby-error">${escapeHtml(error)}</div>
      <button class="btn primary yellow" id="createBtn">Create room</button>
      <div class="room-list">
        ${roomList.length === 0
          ? '<div class="room-empty">No open rooms right now. Create one.</div>'
          : roomList.map(r => `
            <div class="room-row">
              <div class="room-info">
                <span class="room-host"><a class="name-link" href="/social/social.html?user=${encodeURIComponent(r.hostUsername)}">${escapeHtml(displayName(r.hostUsername))}</a>'s room</span>
                <span class="room-seats mono">${r.seatCount}/${r.maxSeats} seated</span>
              </div>
              <button class="btn" data-join="${escapeHtml(r.id)}">Join</button>
            </div>`).join('')
        }
      </div>
    </div>`;

  document.getElementById('createBtn')?.addEventListener('click', () => send({type:'create-room'}));
  app.querySelectorAll('[data-join]').forEach(btn => {
    btn.addEventListener('click', () => send({type:'join-room', roomId: /** @type {HTMLElement} */(btn).dataset.join}));
  });
}

// Shows how long the player has been searching. Ticks once a second while the queue screen is up.
function startQueueTimer(){
  if(queueTimer) return;
  const tick = () => {
    const el = document.getElementById('queueTime');
    if(!el) return;
    const secs = Math.floor((Date.now() - queuedSince) / 1000);
    el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  };
  tick();
  queueTimer = setInterval(tick, 1000);
}

function stopQueueTimer(){
  if(queueTimer) clearInterval(queueTimer);
  queueTimer = null;
}

function myUserId(){
  // The server is the source of truth for who is who. The client only needs its own seat's
  // userId to label "you" and to know whether it's the host, and that arrives with each room-state.
  return currentRoom?.seats.find(s => s.username === me?.username)?.userId ?? -1;
}

mountChrome({active: 'play', title: 'Play', back: '/'}).then(() => {
  // The top-bar back arrow is the only back control. In a room or the ranked queue it leaves that
  // room or queue instead of going home, so there's no second back button on the page.
  document.querySelector('.topbar .top-btn[aria-label="Back"]')?.addEventListener('click', (e) => {
    // During a live match the arrow asks first. Quitting counts as a loss, tied for last for rating.
    if(view === 'game' && gameState && gameState.stage !== 'game-over'){
      e.preventDefault();
      if(!confirm('Are you sure you want to quit?')) return;
      send({type: 'quit-game'});
      // Give the quit message a moment to leave before the page changes.
      setTimeout(() => { location.href = '/'; }, 200);
      return;
    }
    // In the queue the arrow just follows its link home. Leaving the page drops the player from the queue.
    if(view === 'room' && currentRoom){
      e.preventDefault();
      currentRoom = null;
      view = 'browse';
      error = '';
      render();
      send({type: 'leave-room'});
    }
  });
});
init();
