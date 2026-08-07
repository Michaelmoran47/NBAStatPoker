// @ts-check
// Signup / login / logout / me. Passwords are hashed with bcrypt before they ever
// touch the database — the DB only ever stores a hash, never the plaintext password.

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from './db.js';

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const findUserByUsername = db.prepare(
  'SELECT id, username, password_hash FROM users WHERE username = ?'
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

  const user = /** @type {{id:number, username:string, password_hash:string}|undefined} */ (
    findUserByUsername.get(username.trim())
  );

  // Compare against a hash either way, so a nonexistent username doesn't respond
  // measurably faster than a wrong password (timing side-channel).
  const validHash = user ? user.password_hash : '$2b$12$invalidsaltinvalidsaltinvalidsaltinva';
  const passwordMatches = await bcrypt.compare(password, validHash);

  if (!user || !passwordMatches) {
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
