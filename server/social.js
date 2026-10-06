// @ts-check
// Profiles, friendships, and the friend leaderboard. Every endpoint acts on behalf of
// req.session.userId, set once at login (the same rule server/auth.js follows), so no
// request can name "who I am". Anything a client sends about *another* user is a username
// that we look up here and validate; a numeric id from the client is never trusted.

import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from './db.js';
import { rooms } from './rooms.js';
import { createLimiter, limitRoute, userOrIp } from './rate-limit.js';

/** @typedef {{id:number, username:string, elo:number}} UserRow */
/** @typedef {{user_a:number, user_b:number, status:'pending'|'accepted', requested_by:number}} PairRow */

const MAX_USERNAME_LENGTH = 200;
const RECENT_MATCH_LIMIT = 10;

const findUserByName = db.prepare('SELECT id, username, elo FROM users WHERE username = ?');
const findUserById = db.prepare('SELECT id, username, elo FROM users WHERE id = ?');
const findPair = db.prepare('SELECT user_a, user_b, status, requested_by FROM friendships WHERE user_a = ? AND user_b = ?');
const insertPending = db.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES (?, ?, 'pending', ?)");
// The requested_by check is in SQL so you can only accept a request that was sent *to* you.
const acceptIncoming = db.prepare(
  "UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ? AND status = 'pending' AND requested_by != ?"
);
// Same rule for declining: only an incoming pending request can be declined.
const declineIncoming = db.prepare(
  "DELETE FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'pending' AND requested_by != ?"
);
// Removes a friend, cancels a request you sent, or (as with decline) drops one sent to you.
const deletePair = db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?');
const listRelations = db.prepare(`
  SELECT u.username, u.elo, f.status, f.requested_by
  FROM friendships f
  JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
  WHERE f.user_a = ? OR f.user_b = ?
  ORDER BY u.username
`);
// Me plus my accepted friends, highest ELO first. The UNION keeps me in even if I have no friends.
const leaderboardRows = db.prepare(`
  SELECT id, username, elo FROM users WHERE id = ?
  UNION
  SELECT u.id, u.username, u.elo
  FROM friendships f
  JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
  WHERE (f.user_a = ? OR f.user_b = ?) AND f.status = 'accepted'
  ORDER BY elo DESC, username ASC
`);
const recordTotals = db.prepare(`
  SELECT COALESCE(SUM(result = 'win'), 0) AS wins, COALESCE(SUM(result = 'loss'), 0) AS losses
  FROM match_results WHERE user_id = ?
`);
const recentMatches = db.prepare(`
  SELECT result, elo_delta, created_at FROM match_results
  WHERE user_id = ? ORDER BY id DESC LIMIT ${RECENT_MATCH_LIMIT}
`);

export const socialRouter = Router();

// Friend requests and challenges per player per hour. Stops one account spamming invites.
const inviteLimit = limitRoute(createLimiter({max: 30, windowMs: 60 * 60 * 1000}), userOrIp, 'You have sent a lot of invites. Try again later.');

const findInviteCode = db.prepare('SELECT code FROM invite_codes WHERE user_id = ?');
const insertInviteCode = db.prepare('INSERT OR IGNORE INTO invite_codes (user_id, code) VALUES (?, ?)');

// Challenges: a friend invites you to a room that's still waiting for players. Only friends can be
// challenged, and a challenge stops showing after 30 minutes or once its room has started.
const insertChallenge = db.prepare('INSERT INTO challenges (from_user, to_user, room_id) VALUES (?, ?, ?)');
const areFriends = db.prepare("SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'accepted'");
const incomingChallenges = db.prepare(`
  SELECT c.id, c.room_id, u.username FROM challenges c
  JOIN users u ON u.id = c.from_user
  WHERE c.to_user = ? AND c.created_at > datetime('now', '-30 minutes')
  ORDER BY c.id DESC LIMIT 10
`);
const deleteChallenge = db.prepare('DELETE FROM challenges WHERE id = ? AND to_user = ?');

// POST /api/challenges — the host of a waiting room challenges one friend to it.
socialRouter.post('/challenges', requireUser, inviteLimit, (req, res) => {
  const me = /** @type {number} */ (req.session.userId);
  const to = cleanUsername(req.body?.to);
  const roomId = typeof req.body?.roomId === 'string' ? req.body.roomId : '';
  const target = to ? /** @type {UserRow|undefined} */ (findUserByName.get(to)) : undefined;
  if (!target) return res.status(404).json({ error: 'That player was not found.' });
  const [a, b] = pairKey(me, target.id);
  if (!areFriends.get(a, b)) return res.status(403).json({ error: 'You can only challenge friends.' });
  const room = rooms.get(roomId);
  if (!room || room.hostUserId !== me || room.status !== 'waiting') {
    return res.status(400).json({ error: 'That room is not open.' });
  }
  insertChallenge.run(me, target.id, roomId);
  res.status(201).json({ ok: true });
});

// GET /api/challenges — challenges waiting for me whose room is still open.
socialRouter.get('/challenges', requireUser, (req, res) => {
  const rows = /** @type {Array<{id:number, room_id:string, username:string}>} */ (incomingChallenges.all(req.session.userId));
  const open = rows.filter(r => rooms.get(r.room_id)?.status === 'waiting');
  res.json({ challenges: open.map(r => ({ id: r.id, roomId: r.room_id, from: r.username })) });
});

// DELETE /api/challenges/:id — dismiss one of my challenges.
socialRouter.delete('/challenges/:id', requireUser, (req, res) => {
  deleteChallenge.run(Number(req.params.id), req.session.userId);
  res.status(204).end();
});

// GET /api/invite-code — the signed-in player's sign-up invite code, created on first use. The
// sign-up page turns it into a link (?invite=CODE). The code is random, so it can't be guessed.
socialRouter.get('/invite-code', requireUser, (req, res) => {
  const userId = req.session.userId;
  insertInviteCode.run(userId, crypto.randomBytes(9).toString('base64url'));
  const row = /** @type {{code:string}} */ (findInviteCode.get(userId));
  res.json({ code: row.code });
});

/** @type {import('express').RequestHandler} */
function requireUser(req, res, next){
  const userId = req.session.userId;
  // The session can outlive a user row (e.g. a manually deleted account), so check it still resolves.
  if(!userId || !findUserById.get(userId)){
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }
  next();
}

/**
 * Reads and validates a username from the URL or body. Returns null (and the caller sends 400) for anything
 * that isn't a plausible username, so garbage never reaches the database.
 * @param {unknown} raw
 * @returns {string|null}
 */
function cleanUsername(raw){
  if(typeof raw !== 'string') return null;
  const name = raw.trim();
  if(name.length === 0 || name.length > MAX_USERNAME_LENGTH) return null;
  return name;
}

/** The pair key: always (smaller id, larger id), matching the table's CHECK constraint.
 * @param {number} a @param {number} b @returns {[number, number]} */
function pairKey(a, b){
  return a < b ? [a, b] : [b, a];
}

/**
 * How `viewerId` relates to `otherId`. Drives which buttons the profile page shows and
 * whether friend-only data is returned.
 * @param {number} viewerId @param {number} otherId
 * @returns {'self'|'friends'|'outgoing'|'incoming'|'none'}
 */
function relationship(viewerId, otherId){
  if(viewerId === otherId) return 'self';
  const [a, b] = pairKey(viewerId, otherId);
  const row = /** @type {PairRow|undefined} */ (findPair.get(a, b));
  if(!row) return 'none';
  if(row.status === 'accepted') return 'friends';
  return row.requested_by === viewerId ? 'outgoing' : 'incoming';
}

/** Resolves a target username to a user row, or sends the 404/400 itself and returns null. */
/** @param {import('express').Response} res @param {unknown} raw @returns {UserRow|null} */
function resolveTarget(res, raw){
  const name = cleanUsername(raw);
  if(!name){
    res.status(400).json({ error: 'A valid username is required.' });
    return null;
  }
  const user = /** @type {UserRow|undefined} */ (findUserByName.get(name));
  if(!user){
    res.status(404).json({ error: 'No player with that username.' });
    return null;
  }
  return user;
}

// GET /api/profile/:username — public stats (name, ELO, wins/losses). Recent matches are
// friend-only, so they're returned only to the user themself or an accepted friend.
socialRouter.get('/profile/:username', requireUser, (req, res) => {
  const viewerId = /** @type {number} */ (req.session.userId);
  const target = resolveTarget(res, req.params.username);
  if(!target) return;

  const rel = relationship(viewerId, target.id);
  const totals = /** @type {{wins:number, losses:number}} */ (recordTotals.get(target.id));
  const canSeeMatches = rel === 'self' || rel === 'friends';

  res.json({
    username: target.username,
    elo: target.elo,
    wins: totals.wins,
    losses: totals.losses,
    relationship: rel,
    recentMatches: canSeeMatches
      ? /** @type {Array<{result:string, elo_delta:number|null, created_at:string}>} */ (recentMatches.all(target.id))
      : null
  });
});

// GET /api/friends — my friend list plus the requests waiting on me and the ones I've sent.
socialRouter.get('/friends', requireUser, (req, res) => {
  const me = /** @type {number} */ (req.session.userId);
  const rows = /** @type {Array<{username:string, elo:number, status:string, requested_by:number}>} */ (
    listRelations.all(me, me, me)
  );
  const friends = [];
  const incoming = [];
  const outgoing = [];
  for(const r of rows){
    if(r.status === 'accepted') friends.push({ username: r.username, elo: r.elo });
    else if(r.requested_by === me) outgoing.push({ username: r.username });
    else incoming.push({ username: r.username });
  }
  res.json({ friends, incoming, outgoing });
});

// POST /api/friends/request  {username}
socialRouter.post('/friends/request', requireUser, inviteLimit, (req, res) => {
  const me = /** @type {number} */ (req.session.userId);
  const target = resolveTarget(res, req.body?.username);
  if(!target) return;
  if(target.id === me) return res.status(400).json({ error: "You can't add yourself." });

  const [a, b] = pairKey(me, target.id);
  const existing = /** @type {PairRow|undefined} */ (findPair.get(a, b));
  if(existing){
    if(existing.status === 'accepted') return res.status(409).json({ error: 'You are already friends.' });
    if(existing.requested_by === me) return res.status(409).json({ error: 'Your request is already pending.' });
    return res.status(409).json({ error: 'They already sent you a request. Accept it instead.' });
  }
  insertPending.run(a, b, me);
  res.status(201).json({ username: target.username, relationship: 'outgoing' });
});

// POST /api/friends/accept  {username}
socialRouter.post('/friends/accept', requireUser, (req, res) => {
  const me = /** @type {number} */ (req.session.userId);
  const target = resolveTarget(res, req.body?.username);
  if(!target) return;
  const [a, b] = pairKey(me, target.id);
  const info = acceptIncoming.run(a, b, me);
  if(info.changes === 0) return res.status(404).json({ error: 'No pending request from that player.' });
  res.json({ username: target.username, relationship: 'friends' });
});

// POST /api/friends/decline  {username}
socialRouter.post('/friends/decline', requireUser, (req, res) => {
  const me = /** @type {number} */ (req.session.userId);
  const target = resolveTarget(res, req.body?.username);
  if(!target) return;
  const [a, b] = pairKey(me, target.id);
  const info = declineIncoming.run(a, b, me);
  if(info.changes === 0) return res.status(404).json({ error: 'No pending request from that player.' });
  res.json({ username: target.username, relationship: 'none' });
});

// DELETE /api/friends/:username — unfriend, or cancel a request I sent.
socialRouter.delete('/friends/:username', requireUser, (req, res) => {
  const me = /** @type {number} */ (req.session.userId);
  const target = resolveTarget(res, req.params.username);
  if(!target) return;
  const [a, b] = pairKey(me, target.id);
  const info = deletePair.run(a, b);
  if(info.changes === 0) return res.status(404).json({ error: "You aren't friends with that player." });
  res.json({ username: target.username, relationship: 'none' });
});

// GET /api/leaderboard/friends — me and my accepted friends, ranked by ELO.
socialRouter.get('/leaderboard/friends', requireUser, (req, res) => {
  const me = /** @type {number} */ (req.session.userId);
  const rows = /** @type {Array<UserRow>} */ (leaderboardRows.all(me, me, me, me));
  res.json({
    entries: rows.map((r, i) => ({ rank: i + 1, username: r.username, elo: r.elo, isMe: r.id === me }))
  });
});
