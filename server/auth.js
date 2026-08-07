// @ts-check
// Signup / login / logout / me, plus Google sign-in. Passwords are hashed with bcrypt
// before they ever touch the database — the DB only ever stores a hash, never the
// plaintext password. Google accounts never get a password_hash at all; they're
// matched by Google's own stable per-account id (google_id) instead.

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { db } from './db.js';

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

const googleClient = new OAuth2Client();

const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const insertGoogleUser = db.prepare(
  'INSERT INTO users (username, google_id, email) VALUES (?, ?, ?)'
);
const findUserByUsername = db.prepare(
  'SELECT id, username, password_hash FROM users WHERE username = ?'
);
const findUserByGoogleId = db.prepare(
  'SELECT id, username FROM users WHERE google_id = ?'
);
const usernameExists = db.prepare(
  'SELECT 1 FROM users WHERE username = ?'
);

export const authRouter = Router();

authRouter.post('/signup', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Username is required.' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  const cleanUsername = username.trim();

  if (findUserByUsername.get(cleanUsername)) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const info = insertUser.run(cleanUsername, passwordHash);

  req.session.userId = /** @type {number} */ (info.lastInsertRowid);
  req.session.username = cleanUsername;
  res.status(201).json({ username: cleanUsername });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = /** @type {{id:number, username:string, password_hash:string|null}|undefined} */ (
    findUserByUsername.get(username.trim())
  );

  // Compare against a hash either way, so a nonexistent username (or a Google-only
  // account with no password) doesn't respond measurably faster than a wrong
  // password — that timing difference is itself a way to enumerate valid usernames.
  const validHash = user?.password_hash || '$2b$12$invalidsaltinvalidsaltinvalidsaltinva';
  const passwordMatches = await bcrypt.compare(password, validHash);

  if (!user || !user.password_hash || !passwordMatches) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ username: user.username });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.status(204).end();
  });
});

authRouter.get('/me', (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  res.json({ username: req.session.username });
});

// The client posts the ID token it got back from Google's "Sign in with Google"
// button. We verify its signature or reject it — we never trust a token the browser
// just says is valid.
authRouter.post('/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  }

  const { credential } = req.body ?? {};
  if (typeof credential !== 'string') {
    return res.status(400).json({ error: 'Missing Google credential.' });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Could not verify that Google sign-in.' });
  }
  if (!payload?.sub) {
    return res.status(401).json({ error: 'Could not verify that Google sign-in.' });
  }

  const googleId = payload.sub;
  const email = payload.email || null;

  const existing = /** @type {{id:number, username:string}|undefined} */ (findUserByGoogleId.get(googleId));
  if (existing) {
    req.session.userId = existing.id;
    req.session.username = existing.username;
    return res.json({ username: existing.username });
  }

  const username = uniqueUsernameFrom(email || `player${Date.now()}`);
  const info = insertGoogleUser.run(username, googleId, email);

  req.session.userId = /** @type {number} */ (info.lastInsertRowid);
  req.session.username = username;
  res.status(201).json({ username });
});

// Turns "jane.doe@gmail.com" into "jane_doe", then "jane_doe2", "jane_doe3", ... if
// that's already someone's username — Google gives us an email, not a username, and
// this app's usernames need to be unique.
/** @param {string} email */
function uniqueUsernameFrom(email){
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24) || 'player';
  let candidate = base;
  let n = 2;
  while (usernameExists.get(candidate)) {
    candidate = `${base}${n}`;
    n++;
  }
  return candidate;
}
