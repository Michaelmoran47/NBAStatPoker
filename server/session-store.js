// @ts-check
// A minimal express-session Store backed by the same SQLite DB as everything else.
// express-session's default MemoryStore is explicitly not meant for production: it
// leaks memory over time and forgets every session on process restart, which on a
// deployed server means a redeploy or container restart logs everyone out. Rolling a
// small store here (rather than pulling in a third-party one) keeps it fully typed via
// JSDoc — matching every other file in this repo — and avoids a second SQLite driver;
// it reuses the exact `db` handle `db.js` already opens.

import session from 'express-session';

const TABLE = 'sessions';

export class SqliteSessionStore extends session.Store {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    super();
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);

    // Sweeping expired rows on a timer (rather than on every read) keeps `get` cheap;
    // an expired-but-not-yet-swept row is still correctly treated as absent by the
    // `expires_at > datetime('now')` check in `get` below. `.unref()` so this interval
    // alone never keeps the process alive.
    this.sweepInterval = setInterval(() => {
      this.db.prepare(`DELETE FROM ${TABLE} WHERE expires_at <= datetime('now')`).run();
    }, 1000 * 60 * 60 * 24).unref();
  }

  /**
   * @param {string} sid
   * @param {(err: any, session?: import('express-session').SessionData | null) => void} callback
   */
  get(sid, callback) {
    try {
      const row = /** @type {{ sess: string } | undefined} */ (
        this.db
          .prepare(`SELECT sess FROM ${TABLE} WHERE sid = ? AND expires_at > datetime('now')`)
          .get(sid)
      );
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      callback(err);
    }
  }

  /**
   * @param {string} sid
   * @param {import('express-session').SessionData} sessionData
   * @param {(err?: any) => void} [callback]
   */
  set(sid, sessionData, callback) {
    try {
      const maxAge = sessionData.cookie?.maxAge ?? 1000 * 60 * 60 * 24; // default: 1 day
      const expiresAt = new Date(Date.now() + maxAge).toISOString();
      this.db
        .prepare(`INSERT OR REPLACE INTO ${TABLE} (sid, sess, expires_at) VALUES (?, ?, ?)`)
        .run(sid, JSON.stringify(sessionData), expiresAt);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  /**
   * @param {string} sid
   * @param {(err?: any) => void} [callback]
   */
  destroy(sid, callback) {
    try {
      this.db.prepare(`DELETE FROM ${TABLE} WHERE sid = ?`).run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  /**
   * @param {string} sid
   * @param {import('express-session').SessionData} sessionData
   * @param {() => void} [callback]
   */
  touch(sid, sessionData, callback) {
    this.set(sid, sessionData, callback);
  }
}
