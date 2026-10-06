// @ts-check
// Real-time layer: the lobby (phase 2 — browse/create/join/ready/start) plus, once a
// room starts, the live game itself (phase 3). Authenticates each socket off the same
// session cookie the rest of the site uses. Every anti-cheat guarantee here comes down
// to one rule: a message only ever acts on behalf of conn.userId (set once, from the
// authenticated session, at connection time) — never a client-supplied id.

import { WebSocketServer } from 'ws';
import { rooms, createRoom, listOpenRooms, joinRoom, leaveRoom, toggleReady, startRoom, startMatchRoom } from './rooms.js';
import { enqueue, dequeue, startMatchmaking } from './matchmaking.js';
import { getRating } from './matches.js';
import { startLiveGame, submitPlayerGuess, markDisconnected, markReconnected, findLiveRoomForUser, quitSeat } from './game-rooms.js';
import { makeGuess } from '../js/trivia.js';
import { createLimiter } from './rate-limit.js';

// Every message a player's socket sends counts against this. Real play needs a handful a round, so this
// only catches floods.
const messageLimit = createLimiter({max: 40, windowMs: 10_000});

/** @typedef {import('ws').WebSocket & {userId: number, username: string, roomId: string|null}} Conn */

/** @type {Set<Conn>} */
const connections = new Set();

/**
 * @param {import('http').Server} httpServer
 * @param {import('express').RequestHandler} sessionMiddleware Same instance the
 *   Express app uses, so a socket's session matches its HTTP session exactly.
 */
export function attachWebSocketServer(httpServer, sessionMiddleware){
  startMatchmaking(startRankedMatch);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    // express-session's middleware only needs to *read* the session here, so a bare
    // {} stands in for `res` — we never send an HTTP response on this connection.
    // @ts-ignore
    sessionMiddleware(req, {}, () => {
      const session = /** @type {any} */ (req).session;
      if(!session?.userId){
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, session.userId, session.username);
      });
    });
  });

  wss.on('connection', (ws, userId, username) => {
    const conn = /** @type {Conn} */ (ws);
    conn.userId = userId;
    conn.username = username;
    conn.roomId = null;
    connections.add(conn);

    // A fresh connection might actually be a reconnect — the same account rejoining
    // an in-progress match after a refresh or a network drop. If so, resync them
    // straight into the game instead of dropping them into the lobby browse view.
    const live = findLiveRoomForUser(userId);
    if(live){
      conn.roomId = live.roomId;
      const resynced = markReconnected(live.roomId, live.seatId);
      if(resynced) send(conn, {type: 'game-state', state: resynced.state, deadline: resynced.deadline});
    } else {
      send(conn, {type: 'room-list', rooms: publicRoomList()});
    }

    conn.on('message', raw => handleMessage(conn, raw));
    conn.on('close', () => {
      connections.delete(conn);
      handleDisconnect(conn);
    });
  });
}

/**
 * @param {Conn} conn
 * @param {import('ws').RawData} raw
 */
function handleMessage(conn, raw){
  if(!messageLimit(String(conn.userId))){
    send(conn, {type: 'error', message: 'Slow down: too many messages.'});
    return;
  }
  /** @type {any} */
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  try {
    switch(msg.type){
      case 'create-room': {
        const room = createRoom(conn.userId, conn.username);
        conn.roomId = room.id;
        broadcastRoom(room);
        broadcastRoomList();
        break;
      }
      case 'join-room': {
        const room = joinRoom(msg.roomId, conn.userId, conn.username);
        conn.roomId = room.id;
        broadcastRoom(room);
        broadcastRoomList();
        break;
      }
      case 'queue-join': {
        if(conn.roomId) throw new Error('Leave your room before queuing.');
        const joined = enqueue({userId: conn.userId, username: conn.username, elo: getRating(conn.userId), conn});
        if(!joined) throw new Error('You are already in the ranked queue.');
        send(conn, {type: 'queue-state', status: 'searching'});
        break;
      }
      case 'queue-leave': {
        dequeue(conn.userId);
        send(conn, {type: 'queue-state', status: 'idle'});
        break;
      }
      case 'leave-room': {
        leaveCurrentRoom(conn);
        break;
      }
      case 'quit-game': {
        // Quitting a match in progress forfeits this player's seat. Outside a live match it just leaves the room.
        if(!conn.roomId) break;
        if(!quitSeat(conn.roomId, conn.userId)) leaveCurrentRoom(conn);
        else conn.roomId = null;
        break;
      }
      case 'ready': {
        if(!conn.roomId) throw new Error('You are not in a room.');
        broadcastRoom(toggleReady(conn.roomId, conn.userId));
        break;
      }
      case 'start-room': {
        if(!conn.roomId) throw new Error('You are not in a room.');
        const room = startRoom(conn.roomId, conn.userId);
        broadcastRoom(room);
        broadcastRoomList(); // no longer open once started
        startLiveGame(room.id, room.seats.map(s=>({userId:s.userId, username:s.username})), makeSendToSeat(room.id));
        break;
      }
      case 'submit-guess': {
        if(!conn.roomId) throw new Error('You are not in a room.');
        const room = rooms.get(conn.roomId);
        if(!room || room.status !== 'started') throw new Error('No game in progress.');
        const seatId = room.seats.findIndex(s => s.userId === conn.userId);
        if(seatId === -1) throw new Error('You are not seated in this game.');
        // Check the guess before it locks the round, so a bad message can't stop a real answer going in.
        const guess = parseGuess(msg);
        if(guess.value === null) throw new Error('Type a number before you lock in.');
        if(!submitPlayerGuess(conn.roomId, seatId, guess)) throw new Error('Guessing is closed for this round.');
        break;
      }
    }
  } catch(err){
    send(conn, {type: 'error', message: /** @type {Error} */ (err).message});
  }
}

/**
 * Validates a client-supplied answer. The client sends the typed text and the picked unit key. The
 * shared makeGuess (js/trivia.js) parses them, and an unknown unit or non-number becomes an invalid
 * guess that scores 0. The once-per-round rule is enforced by the engine.
 * @param {any} msg
 * @returns {import('../js/trivia.js').Guess}
 */
function parseGuess(msg){
  const text = typeof msg.text === 'string' ? msg.text.slice(0, 40) : '';
  const unit = typeof msg.unit === 'string' ? msg.unit : '';
  return makeGuess(text, unit);
}

/**
 * @param {string} roomId
 * @returns {(seatId:number, payload:unknown) => void}
 */
function makeSendToSeat(roomId){
  return (seatId, payload) => {
    const room = rooms.get(roomId);
    const userId = room?.seats[seatId]?.userId;
    if(userId===undefined) return;
    for(const c of connections){
      if(c.userId === userId && c.roomId === roomId){ send(c, payload); return; }
    }
    // Not currently connected to this room — fine, markReconnected() resyncs them
    // with a fresh view the moment they do reconnect.
  };
}

// Turns a group picked by the ranked queue into a normal room, readies everyone, and starts it as a
// ranked match. Matchmaking has already chosen the players, so there's no ready-up step.
/** @param {import('./matchmaking.js').QueueEntry[]} group */
function startRankedMatch(group, bots){
  const [host, ...rest] = group;
  const room = createRoom(host.userId, host.username);
  for(const p of rest) joinRoom(room.id, p.userId, p.username);
  for(const p of group) p.conn.roomId = room.id;
  startMatchRoom(room.id);
  broadcastRoom(room);
  broadcastRoomList();
  startLiveGame(
    room.id,
    room.seats.map(s => ({userId: s.userId, username: s.username})),
    makeSendToSeat(room.id),
    true,
    bots
  );
}

/** @param {Conn} conn */
function handleDisconnect(conn){
  dequeue(conn.userId);
  if(!conn.roomId) return;
  const room = rooms.get(conn.roomId);

  if(room?.status === 'started'){
    // In-progress match: this is a disconnect, not a "leave". Don't touch the seat
    // list or tear the room down — start the reconnect grace period instead.
    const seatId = room.seats.findIndex(s => s.userId === conn.userId);
    if(seatId !== -1) markDisconnected(conn.roomId, seatId);
    return;
  }

  leaveCurrentRoom(conn);
}

/** @param {Conn} conn */
function leaveCurrentRoom(conn){
  if(!conn.roomId) return;
  const roomId = conn.roomId;
  const remaining = leaveRoom(roomId, conn.userId);
  conn.roomId = null;

  if(remaining){
    broadcastRoom(remaining);
  } else {
    // The room is gone (host left, or that was the last seat) — kick anyone else
    // whose client still thinks they're in it back out to the lobby.
    for(const c of connections){
      if(c.roomId === roomId){
        c.roomId = null;
        send(c, {type: 'room-closed'});
      }
    }
  }
  broadcastRoomList();
}

function publicRoomList(){
  return listOpenRooms().map(r => ({
    id: r.id,
    hostUsername: r.seats.find(s => s.userId === r.hostUserId)?.username ?? '?',
    seatCount: r.seats.length,
    maxSeats: r.maxSeats
  }));
}

function broadcastRoomList(){
  const list = publicRoomList();
  for(const c of connections){
    if(!c.roomId) send(c, {type: 'room-list', rooms: list});
  }
}

/** @param {import('./rooms.js').Room} room */
function broadcastRoom(room){
  for(const c of connections){
    if(c.roomId === room.id) send(c, {type: 'room-state', room});
  }
}

/**
 * @param {Conn} conn
 * @param {unknown} payload
 */
function send(conn, payload){
  if(conn.readyState === conn.OPEN) conn.send(JSON.stringify(payload));
}
