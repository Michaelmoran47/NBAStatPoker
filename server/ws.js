// @ts-check
// Real-time lobby layer (phase 2): browse open rooms live, create/join/ready/start.
// Authenticates each socket off the same session cookie the rest of the site uses —
// no separate login step for real-time features, and no player-supplied id is ever
// trusted for who a socket is allowed to act as.

import { WebSocketServer } from 'ws';
import { createRoom, listOpenRooms, joinRoom, leaveRoom, toggleReady, startRoom } from './rooms.js';

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

    send(conn, {type: 'room-list', rooms: publicRoomList()});

    conn.on('message', raw => handleMessage(conn, raw));
    conn.on('close', () => {
      connections.delete(conn);
      leaveCurrentRoom(conn);
    });
  });
}

/**
 * @param {Conn} conn
 * @param {Buffer} raw
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
        broadcastRoom(startRoom(conn.roomId, conn.userId));
        broadcastRoomList(); // no longer open once started
        break;
      }
    }
  } catch(err){
    send(conn, {type: 'error', message: /** @type {Error} */ (err).message});
  }
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
