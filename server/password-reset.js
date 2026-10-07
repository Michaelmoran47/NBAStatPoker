// @ts-check
// Forgot-password flow: request a link by email, then set a new password with the token
// from that link. Google-only accounts have no password_hash and so never match
// findUserByEmail — there's nothing on them to reset.

import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { db } from './db.js';
import { sendEmail } from './email.js';
import { createLimiter, limitRoute, userOrIp } from './rate-limit.js';

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const BASE_URL = process.env.BASE_URL || 'http://localhost:5500';

// Keyed by IP (no session exists yet at this point), separate limits for each step.
const forgotLimit = limitRoute(
  createLimiter({ max: 5, windowMs: 60 * 60 * 1000 }), userOrIp,
  'Too many reset requests from this network. Try again later.'
);
const resetLimit = limitRoute(
  createLimiter({ max: 20, windowMs: 60 * 60 * 1000 }), userOrIp,
  'Too many attempts. Try again later.'
);

const findResettableUserByEmail = db.prepare(
  'SELECT id, username FROM users WHERE email = ? AND password_hash IS NOT NULL'
);
const insertToken = db.prepare(
  'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
);
// A fresh request supersedes any earlier, still-unused link for the same account, so only
// the newest email actually works.
const invalidateTokensForUser = db.prepare(
  "UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL"
);
const findActiveToken = db.prepare(`
  SELECT id, user_id FROM password_resets
  WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
`);
const markTokenUsed = db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?");
const updatePasswordHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

/** @param {string} token */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

export const passwordResetRouter = Router();

passwordResetRouter.post('/forgot-password', forgotLimit, async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== 'string' || email.trim().length === 0) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  // The response is identical whether or not the email matches an account — otherwise the
  // response itself would let someone enumerate which emails have accounts here.
  const genericReply = { message: "If an account with that email has a password set, we've sent a reset link." };

  const user = /** @type {{id:number, username:string}|undefined} */ (
    findResettableUserByEmail.get(email.trim())
  );
  if (user) {
    invalidateTokensForUser.run(user.id);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    insertToken.run(user.id, hashToken(token), expiresAt);

    const link = `${BASE_URL}/auth/reset.html?token=${token}`;
    await sendEmail({
      to: email.trim(),
      subject: 'Reset your Quantrivia password',
      html: `
        <p>Hi ${escapeHtml(user.username)},</p>
        <p>Someone asked to reset the password on your Quantrivia account. If that was you, set a new one here — this link works for 30 minutes:</p>
        <p><a href="${link}">${link}</a></p>
        <p>If you didn't ask for this, you can ignore this email and your password will stay the same.</p>
      `
    });
  }

  res.json(genericReply);
});

passwordResetRouter.post('/reset-password', resetLimit, async (req, res) => {
  const { token, password } = req.body ?? {};

  if (typeof token !== 'string' || token.length === 0) {
    return res.status(400).json({ error: 'Missing reset token.' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  const row = /** @type {{id:number, user_id:number}|undefined} */ (
    findActiveToken.get(hashToken(token))
  );
  if (!row) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  updatePasswordHash.run(passwordHash, row.user_id);
  markTokenUsed.run(row.id);

  res.json({ message: 'Password updated. You can log in now.' });
});
