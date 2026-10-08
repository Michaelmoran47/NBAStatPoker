// @ts-check
// Account settings: for now, just adding or changing the email used for password resets.
// Google-only accounts already have an email from Google and have no password to confirm
// a change with, so the current-password field only shows up for password accounts.

import { mountChrome, addPasswordToggle } from '../social/chrome.js';

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

let error = '';
let notice = '';
/** @type {{username:string, email:string|null, hasPassword:boolean}|null} */
let me = null;

async function load(){
  const res = await fetch('/api/me');
  if(!res.ok){
    location.href = `/auth/login.html?next=${encodeURIComponent(location.pathname)}`;
    return;
  }
  me = await res.json();
  await mountChrome({
    active: 'profile',
    title: 'Account settings',
    back: `/social/social.html?user=${encodeURIComponent(/** @type {any} */ (me).username)}`
  });
  render();
}

function render(){
  if(!me) return;
  app.innerHTML = `
    <div class="social-page">
      <section class="cc-panel">
        <h2 class="cc-heading">Email</h2>
        <p class="cc-sub">Used only for password resets. Never shown to other players.</p>
        ${notice ? `<div class="lobby-error" role="status" style="color:var(--accent);">${escapeHtml(notice)}</div>` : ''}
        <form id="emailForm" style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">
          <div class="cc-field">
            <label for="email">Email</label>
            <input class="cc-input" id="email" name="email" type="email" value="${escapeHtml(me.email ?? '')}" required>
          </div>
          ${me.hasPassword ? `
          <div class="cc-field">
            <label for="currentPassword">Current password</label>
            <input class="cc-input" id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>
          </div>` : ''}
          <div class="lobby-error" role="alert">${escapeHtml(error)}</div>
          <button type="submit" class="btn primary">Save email</button>
        </form>
      </section>
    </div>`;

  const form = /** @type {HTMLFormElement} */ (document.getElementById('emailForm'));
  form.addEventListener('submit', handleSubmit);
  const currentPasswordInput = document.getElementById('currentPassword');
  if(currentPasswordInput) addPasswordToggle(/** @type {HTMLInputElement} */ (currentPasswordInput));
}

/** @param {SubmitEvent} e */
async function handleSubmit(e){
  e.preventDefault();
  const form = /** @type {HTMLFormElement} */ (e.target);
  const email = /** @type {HTMLInputElement} */ (form.elements.namedItem('email')).value;
  const currentPasswordField = /** @type {HTMLInputElement|null} */ (form.elements.namedItem('currentPassword'));

  const res = await fetch('/api/account/email', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ email, currentPassword: currentPasswordField?.value })
  });
  const body = await res.json();

  if(!res.ok){
    error = body.error || 'Something went wrong.';
    notice = '';
    render();
    return;
  }

  error = '';
  notice = 'Email updated.';
  if(me) me.email = body.email;
  render();
}

/** @param {string} s */
function escapeHtml(s){
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

load();
