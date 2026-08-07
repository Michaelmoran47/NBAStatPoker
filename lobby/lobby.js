// @ts-check
// Real-time lobby: browse open rooms, create/join one, ready up, host starts. No game
// logic lives here — starting a room just proves the lobby works end to end; the
// actual game engine gets wired into 'started' rooms in the next phase.

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/** @type {{username:string}|null} */
let me = null;
/** @type {'connecting'|'browse'|'room'} */
let view = 'connecting';
/** @type {Array<{id:string, hostUsername:string, seatCount:number, maxSeats:number}>} */
let roomList = [];
/** @type {{id:string, hostUserId:number, maxSeats:number, seats:Array<{userId:number, username:string, ready:boolean}>, status:'waiting'|'started'}|null} */
let currentRoom = null;
/** @type {string} */
let error = '';
/** @type {WebSocket|null} */
let socket = null;

async function init(){
  const res = await fetch('/api/me');
  if(!res.ok){
    location.href = '../auth/login.html';
    return;
  }
  me = await res.json();
  connect();
}

function connect(){
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    view = roomList.length || currentRoom ? view : 'browse';
    render();
  });

  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if(msg.type === 'room-list'){
      roomList = msg.rooms;
      if(!currentRoom) view = 'browse';
    } else if(msg.type === 'room-state'){
      currentRoom = msg.room;
      view = 'room';
      error = '';
    } else if(msg.type === 'room-closed'){
      currentRoom = null;
      view = 'browse';
      error = 'The host left — room closed.';
    } else if(msg.type === 'error'){
      error = msg.message;
    }
    render();
  });

  socket.addEventListener('close', () => {
    view = 'connecting';
    error = 'Disconnected from the lobby — reconnecting…';
    render();
    setTimeout(connect, 1500);
  });
}

/** @param {object} payload */
function send(payload){
  if(socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function render(){
  if(view === 'connecting'){
    app.innerHTML = `
      <div class="id-card lobby-card">
        <h1 class="lobby-title">🏀 NBA Stat Poker</h1>
        <p class="lobby-status">${escapeHtml(error) || 'Connecting…'}</p>
      </div>`;
    return;
  }

  if(view === 'room' && currentRoom){
    const room = currentRoom;
    const mySeat = room.seats.find(s => s.userId === myUserId());
    const isHost = room.hostUserId === myUserId();
    const canStart = isHost && room.status === 'waiting' && room.seats.length >= 2 && room.seats.every(s => s.ready);

    app.innerHTML = `
      <div class="id-card lobby-card">
        <h1 class="lobby-title">🏀 Room ${escapeHtml(room.id)}</h1>
        <div class="seat-list">
          ${room.seats.map(s => `
            <div class="seat-row">
              <span class="seat-name">${escapeHtml(s.username)}${s.userId===myUserId()?' (you)':''}</span>
              <span>
                ${s.userId===room.hostUserId ? '<span class="seat-tag host">Host</span>' : ''}
                <span class="seat-tag ${s.ready?'ready':'waiting'}">${s.ready?'Ready':'Not ready'}</span>
              </span>
            </div>`).join('')}
        </div>
        ${room.status==='started' ? `
          <p class="lobby-status">🎉 Game started! The real table isn't wired up here yet —
          that's the next phase. This just proves the lobby itself works end to end.</p>
        ` : `
          <div class="lobby-error">${escapeHtml(error)}</div>
          <div class="lobby-actions">
            <button class="btn-next" id="readyBtn">${mySeat?.ready ? 'Not Ready' : 'Ready'}</button>
            ${isHost ? `<button class="btn-next" id="startBtn" ${canStart?'':'disabled'}>Start Game</button>` : ''}
          </div>
        `}
        <button class="btn-next btn-secondary" id="leaveBtn">Leave Room</button>
      </div>`;

    document.getElementById('readyBtn')?.addEventListener('click', () => send({type:'ready'}));
    document.getElementById('startBtn')?.addEventListener('click', () => send({type:'start-room'}));
    document.getElementById('leaveBtn')?.addEventListener('click', () => send({type:'leave-room'}));
    return;
  }

  // browse
  app.innerHTML = `
    <div class="id-card lobby-card">
      <h1 class="lobby-title">🏀 NBA Stat Poker</h1>
      <p class="lobby-status">Signed in as <b>${escapeHtml(me?.username ?? '')}</b></p>
      <div class="lobby-error">${escapeHtml(error)}</div>
      <button class="btn-next" id="createBtn">Create Room</button>
      <div class="room-list">
        ${roomList.length === 0
          ? '<div class="room-empty">No open rooms right now — create one.</div>'
          : roomList.map(r => `
            <div class="room-row">
              <div class="room-info">
                <span class="room-host">${escapeHtml(r.hostUsername)}'s room</span>
                <span class="room-seats">${r.seatCount}/${r.maxSeats} seated</span>
              </div>
              <button class="btn-next" data-join="${escapeHtml(r.id)}" style="padding:8px 16px;">Join</button>
            </div>`).join('')
        }
      </div>
    </div>`;

  document.getElementById('createBtn')?.addEventListener('click', () => send({type:'create-room'}));
  app.querySelectorAll('[data-join]').forEach(btn=>{
    btn.addEventListener('click', () => send({type:'join-room', roomId: /** @type {HTMLElement} */(btn).dataset.join}));
  });
}

function myUserId(){
  // The server is the source of truth for who's who; the client only ever needs its
  // own seat's userId to know which row is "you" and whether it's the host — that
  // comes back to us on every room-state message rather than being tracked locally.
  return currentRoom?.seats.find(s => s.username === me?.username)?.userId ?? -1;
}

/** @param {string} s */
function escapeHtml(s){
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

init();
