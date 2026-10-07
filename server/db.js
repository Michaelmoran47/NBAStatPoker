// @ts-check
// Opens (and creates, if missing) the SQLite database that holds accounts.
// A single file on disk — no separate database server to install or run, which is
// what makes this a good fit for "get it working locally first."

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { START_ELO } from '../js/trivia.js';

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

// One row per pair of users. user_a is always the smaller id, so the UNIQUE constraint
// makes "A and B" and "B and A" the same row: a pair can never have two friendships, and
// a request can't be filed twice in opposite directions. status 'pending' is a request
// waiting on user_b (or user_a) to accept; requested_by says which of the two sent it.
// Friendship is mutual once 'accepted'. See server/social.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL REFERENCES users(id),
    user_b INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
    requested_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_a, user_b),
    CHECK (user_a < user_b)
  );
  CREATE INDEX IF NOT EXISTS friendships_user_b ON friendships(user_b);

  -- A challenge sent to one friend, pointing at a waiting room. Shown on their home menu for a while.
  CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER NOT NULL REFERENCES users(id),
    to_user INTEGER NOT NULL REFERENCES users(id),
    room_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One invite code per player, fixed for life, so a link already shared keeps working.
  -- Used by the sign-up page (server/auth.js) to make the new player friends with the inviter.
  CREATE TABLE IF NOT EXISTS invite_codes (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    code TEXT NOT NULL UNIQUE
  );
`);

// One row per human answer in a multiplayer match: which question, and how far off the guess was
// (NULL for no guess). There is deliberately no user id, so these rows can't be traced back to a player.
// Read only by the admin stats page, see server/question-stats.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS question_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id TEXT NOT NULL,
    pct_off REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS question_answers_question ON question_answers(question_id);
`);

// A password-reset link's token, stored as a SHA-256 hash rather than the raw token — the same
// reasoning as hashing passwords with bcrypt: a database leak alone shouldn't hand out working
// reset links. used_at is set the moment a token is spent (or superseded by a newer request), so
// each token works at most once. See server/password-reset.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS password_resets_token ON password_resets(token_hash);
`);

// A player reporting another player. Usernames are snapshotted at report time (alongside the ids)
// so the report still reads sensibly even if someone involved later renames or deletes their account.
// There's no in-app admin view for these yet — see server/reports.js, which also emails each one to
// the operator's contact address.
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    reported_id INTEGER NOT NULL REFERENCES users(id),
    reporter_username TEXT NOT NULL,
    reported_username TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Added after the original tables so an existing app.db (from before ELO existed) gets
// the new columns too. CREATE TABLE IF NOT EXISTS alone would leave old databases missing
// them. ALTER TABLE ... ADD COLUMN is guarded by a PRAGMA check because SQLite has no
// "ADD COLUMN IF NOT EXISTS".
/** @param {string} table @param {string} column @param {string} definition */
function addColumnIfMissing(table, column, definition){
  const cols = /** @type {{name:string}[]} */ (db.prepare(`PRAGMA table_info(${table})`).all());
  if(!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumnIfMissing('users', 'elo', `INTEGER NOT NULL DEFAULT ${START_ELO}`);
addColumnIfMissing('match_results', 'elo_delta', 'INTEGER');
// The guess itself, in the answer's base units (so a guess of 4 million miles is stored as 4000000).
// Older rows from before this column existed have NULL here.
addColumnIfMissing('question_answers', 'guess', 'REAL');
// The question's text and correct answer, saved with each answer so the stats still make sense after a
// question is edited or removed from the bank. Older rows have NULL here and fall back to the bank.
addColumnIfMissing('question_answers', 'question_text', 'TEXT');
addColumnIfMissing('question_answers', 'answer', 'REAL');
