// @ts-check
// Opens (and creates, if missing) the SQLite database that holds accounts.
// A single file on disk — no separate database server to install or run, which is
// what makes this a good fit for "get it working locally first."

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');

// password_hash is nullable: a Google-only account never sets one.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// One row per player per completed match. 'loss' via the reconnect-grace-period
// forfeit path is recorded the moment the timer expires, independent of how the rest
// of the match eventually turns out — see server/matches.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    room_id TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('win','loss')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
