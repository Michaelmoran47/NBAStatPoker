// @ts-check
// Thin wrapper around Resend's HTTP API for transactional email (password resets, reports).
// No SDK dependency — Resend's API is a single POST, and Node's built-in fetch covers it.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Quantrivia <no-reply@playquantrivia.com>';

/**
 * @param {{to: string, subject: string, html: string}} msg
 * @returns {Promise<boolean>} True if Resend accepted the message.
 */
export async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not set — would have emailed "${subject}" to ${to}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
    });
    if (!res.ok) {
      console.error('Resend rejected an email:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Sending email via Resend failed:', err);
    return false;
  }
}
