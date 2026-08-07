// @ts-check
// Express app: serves the existing static site (unchanged) plus the new /api auth
// routes, all from one process — one `npm start` runs the whole thing locally.

import express from 'express';
import session from 'express-session';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { authRouter } from './auth.js';
import './db.js'; // creates the DB file + table on first run, as a side effect

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 5500;

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn(
    'No SESSION_SECRET set — using a random one for this run. ' +
    'Everyone will be logged out the next time the server restarts. ' +
    'Set SESSION_SECRET before deploying anywhere real.'
  );
}

const app = express();

app.use(express.json());
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  }
}));

app.use('/api', authRouter);

// Everything else (index.html, css/, js/, auth/login.html, ...) is the existing
// static site, served as-is — the game itself is untouched by this phase.
app.use(express.static(projectRoot));

app.listen(PORT, () => {
  console.log(`NBA Stat Poker server running at http://localhost:${PORT}`);
});
