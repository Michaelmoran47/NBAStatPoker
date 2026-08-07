// @ts-check
// Real-time layer: the lobby (phase 2 — browse/create/join/ready/start) plus, once a
// room starts, the live game itself (phase 3). Authenticates each socket off the same
// session cookie the rest of the site uses. Every anti-cheat guarantee here comes down
// to one rule: a message only ever acts on behalf of conn.userId (set once, from the
// authenticated session, at connection time) — never a client-supplied id.

import { WebSocketServer } from 'ws';
import { rooms, createRoom, listOpenRooms, joinRoom, leaveRoom, toggleReady, startRoom } from './rooms.js';
import { startLiveGame, submitAction, markDisconnected, markReconnected, findLiveRoomForUser } from './game-rooms.js';

/** @typedef {import('ws').WebSocket & {userId: number, username: string, roomId: string|null}} Conn */

/** @type {Set<Conn>} */
const connections = new Set();

/**
 * @param {import('http').Server} httpServer
 * @param {import('express').RequestHandler} sessionMiddleware Same instance the
 *   Express app uses, so a socket's session matches its HTTP session exactly.
 */
export function attachWebSocketServer(httpServer, sessionMiddleware){
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
      if(resynced) send(conn, {type: 'game-state', state: resynced.state, actingId: resynced.actingId});
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
      case 'leave-room': {
        leaveCurrentRoom(conn);
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
      case 'game-action': {
        if(!conn.roomId) throw new Error('You are not in a room.');
        const room = rooms.get(conn.roomId);
        if(!room || room.status !== 'started') throw new Error('No game in progress.');
        const seatId = room.seats.findIndex(s => s.userId === conn.userId);
        if(seatId === -1) throw new Error('You are not seated in this game.');
        const action = parseGameAction(msg);
        if(!submitAction(conn.roomId, seatId, action)) throw new Error('It is not your turn.');
        break;
      }
    }
  } catch(err){
    send(conn, {type: 'error', message: /** @type {Error} */ (err).message});
  }
}

/**
 * Validates a client-supplied action into the shape betting.js expects. This is the
 * only trust boundary that matters — once it's a well-formed BettingAction, the
 * existing engine (applyRaise's own Math.min(need, chips) clamp, whose-turn-it-is
 * enforcement via the pending-resolver map) is already the authority on whether it's
 * actually legal, exactly as it is for the local single-player client.
 * @param {any} msg
 * @returns {import('../js/state.js').BettingAction}
 */
function parseGameAction(msg){
  if(msg.action === 'fold') return {action: 'fold'};
  if(msg.action === 'call') return {action: 'call'};
  if(msg.action === 'raise'){
    const amount = Number(msg.amount);
    if(!Number.isFinite(amount)) throw new Error('Invalid raise amount.');
    return {action: 'raise', amount};
  }
  throw new Error('Unknown action.');
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

/** @param {Conn} conn */
function handleDisconnect(conn){
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
