// @ts-check
// Express app: serves the existing static site (unchanged) plus the new /api auth
// routes, all from one process — one `npm start` runs the whole thing locally.

import './env.js'; // must stay first: loads server/.env before the modules below read it
import express from 'express';
import session from 'express-session';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { authRouter } from './auth.js';
import { passwordResetRouter } from './password-reset.js';
import { reportsRouter } from './reports.js';
import { socialRouter } from './social.js';
import { attachWebSocketServer } from './ws.js';
import { adminRouter, dailyRouter } from './question-stats.js';
import { db } from './db.js'; // creates the DB file + tables on first run, as a side effect
import { SqliteSessionStore } from './session-store.js';

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
// Behind Traefik the real client address arrives in X-Forwarded-For. Trust that one proxy hop so rate limits
// count each player's own address, not the proxy's.
app.set('trust proxy', 1);

// Built once and reused for both regular HTTP requests and the WebSocket upgrade
// below, so a socket's session is always exactly the same session its HTTP requests
// see — one login, no separate real-time auth step. Uses `SqliteSessionStore` (see
// session-store.js) instead of express-session's default MemoryStore, which leaks
// memory and forgets every session on restart — a deploy/container restart would
// otherwise log everyone out.
const sessionMiddleware = session({
  store: new SqliteSessionStore(db),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  }
});

app.use(express.json());
app.use(sessionMiddleware);

app.use('/api', authRouter);
app.use('/api', passwordResetRouter);
app.use('/api', reportsRouter);
app.use('/api', socialRouter);
app.use('/api', dailyRouter); // daily reporting + live-computed spreads, see server/question-stats.js
app.use(adminRouter); // owner-only stats page and data, see server/question-stats.js

// Public, non-secret config the client needs — a Google OAuth Client ID is meant to
// be visible in client-side code (unlike a client secret, which this app never uses
// at all: verifying an ID token only needs the client ID). Lets the login page know
// whether to show the Google button without hardcoding the id into checked-in files.
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

// The client's static assets — served individually by exact directory/file rather than
// `express.static(projectRoot)` for the whole repo. That blanket form used to also serve
// every *other* file under the project root over plain HTTP to anyone: server/server.js,
// server/db.js, server/package.json, Dockerfile, VPS_DEPLOY.md, CLAUDE.md, and — critically —
// server/data/app.db (the live user database, bcrypt hashes and all) and .git/ (Express's
// static-file dotfile handling did not block it in practice, confirmed by directly
// requesting /.git/config and /server/data/app.db against a running instance and getting
// real file content back, not a 404). None of that is meant to leave this process, so
// only these specific directories — everything an actual page ever references, per every
// href="…"/src="…" in index.html, solo.html, auth/login.html, and lobby/lobby.html — are
// mounted, each under its own path.
for (const dir of ['css', 'js', 'auth', 'lobby', 'social']) {
  app.use(`/${dir}`, express.static(path.join(projectRoot, dir)));
}
for (const file of ['index.html', 'solo.html', 'privacy.html', 'terms.html']) {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(projectRoot, file)));
}
app.get('/', (req, res) => res.sendFile(path.join(projectRoot, 'index.html')));

// An explicit http.Server (rather than app.listen()'s implicit one) is needed so the
// WebSocket layer can share the exact same port via the 'upgrade' event.
const httpServer = http.createServer(app);
attachWebSocketServer(httpServer, sessionMiddleware);

httpServer.listen(PORT, () => {
  console.log(`Quantrivia server running at http://localhost:${PORT}`);
});
