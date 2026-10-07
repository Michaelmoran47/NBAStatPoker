// @ts-check
// Player reports: one form on a profile page, backed by a DB row (for a record that survives even
// if the email bounces or gets lost) and an email to the operator's contact address, which is where
// reports actually get read and acted on today — there's no in-app review queue yet.

import { Router } from 'express';
import { db } from './db.js';
import { sendEmail } from './email.js';
import { createLimiter, limitRoute, userOrIp } from './rate-limit.js';

const REPORT_EMAIL = process.env.REPORT_EMAIL || 'contact@playquantrivia.com';
const MAX_DETAILS_LENGTH = 1000;

/** @type {Record<string, string>} */
const REASON_LABELS = {
  cheating: 'Cheating or exploiting',
  abusive_language: 'Abusive language',
  inappropriate_name: 'Inappropriate name',
  other: 'Something else'
};

// A handful per hour is plenty for genuine use and limits how much one account can spam the
// operator's inbox (or fill the reports table) if it tries to abuse the report button itself.
const reportLimit = limitRoute(createLimiter({max: 10, windowMs: 60 * 60 * 1000}), userOrIp, 'Too many reports. Try again later.');

const findUserById = db.prepare('SELECT id, username FROM users WHERE id = ?');
const findUserByUsername = db.prepare('SELECT id, username FROM users WHERE username = ?');
const insertReport = db.prepare(`
  INSERT INTO reports (reporter_id, reported_id, reporter_username, reported_username, reason, details)
  VALUES (?, ?, ?, ?, ?, ?)
`);

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

export const reportsRouter = Router();

// POST /api/reports {username, reason, details?}
reportsRouter.post('/reports', reportLimit, async (req, res) => {
  const reporterId = req.session.userId;
  if (!reporterId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  const reporter = /** @type {{id:number, username:string}|undefined} */ (findUserById.get(reporterId));
  if (!reporter) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const { username, reason, details } = req.body ?? {};
  if (typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'A player to report is required.' });
  }
  if (typeof reason !== 'string' || !(reason in REASON_LABELS)) {
    return res.status(400).json({ error: 'A valid reason is required.' });
  }
  if (details !== undefined && (typeof details !== 'string' || details.length > MAX_DETAILS_LENGTH)) {
    return res.status(400).json({ error: `Details must be ${MAX_DETAILS_LENGTH} characters or fewer.` });
  }

  const reported = /** @type {{id:number, username:string}|undefined} */ (findUserByUsername.get(username.trim()));
  if (!reported) {
    return res.status(404).json({ error: 'No player with that username.' });
  }
  if (reported.id === reporter.id) {
    return res.status(400).json({ error: "You can't report yourself." });
  }

  const cleanDetails = typeof details === 'string' ? details.trim() : '';
  insertReport.run(reporter.id, reported.id, reporter.username, reported.username, reason, cleanDetails || null);

  await sendEmail({
    to: REPORT_EMAIL,
    subject: `Quantrivia report: ${reported.username}`,
    html: `
      <p><b>${escapeHtml(reporter.username)}</b> reported <b>${escapeHtml(reported.username)}</b>.</p>
      <p><b>Reason:</b> ${escapeHtml(REASON_LABELS[reason])}</p>
      ${cleanDetails ? `<p><b>Details:</b><br>${escapeHtml(cleanDetails)}</p>` : ''}
    `
  });

  res.status(201).json({ ok: true });
});
