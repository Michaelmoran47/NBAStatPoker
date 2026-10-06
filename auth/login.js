// @ts-check
// Minimal signup/login page — just enough to prove accounts work end-to-end before
// the lobby (phase 2) gives this a real reason to exist. Same template-string render
// pattern as the game's own ui.js: rebuild the #app HTML from a small state object.

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

// A friend's invite link (?invite=CODE) opens straight to the sign-up form and carries the code along.
const inviteCode = new URLSearchParams(location.search).get('invite');
/** @type {'login'|'signup'} */
let mode = inviteCode || new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'login';
/** @type {string} */
let error = '';
/** @type {{username:string}|null} */
let me = null;
/** @type {string|null} Set once /api/config responds; null means Google sign-in is off. */
let googleClientId = null;

async function checkSession(){
  const res = await fetch('/api/me');
  me = res.ok ? await res.json() : null;
  render();
}

async function loadConfig(){
  const res = await fetch('/api/config');
  const config = await res.json();
  googleClientId = config.googleClientId;
  if(!me) render(); // only re-render the logged-out screen; the "signed in" screen has no button to add
}

/**
 * Where to go after signing in: the ?next= page (an invite link, say), or the main menu. Only paths
 * on this site are allowed, so the link can't send the player to another site.
 */
function nextPath(){
  const next = new URLSearchParams(location.search).get('next') ?? '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function render(){
  // Signed-in players go to the main menu, so this page only ever shows the sign-in form.
  if(me){
    location.replace(nextPath());
    return;
  }

  app.innerHTML = `
    <form class="start-card auth-card" id="authForm">
      <svg class="auth-logo" viewBox="0 0 120 120" role="img" aria-label="Quantrivia logo">
        <circle cx="56" cy="56" r="30" fill="none" stroke="#fffa0b" stroke-width="13"/>
        <path d="M76 78 L94 98" stroke="#fffa0b" stroke-width="13" stroke-linecap="round"/>
        <circle cx="56" cy="56" r="6" fill="#7acaf6"/>
      </svg>
      <h1 class="auth-title">Quantrivia</h1>
      <div class="auth-tabs">
        <div class="auth-tab ${mode==='login'?'active':''}" data-mode="login">Log In</div>
        <div class="auth-tab ${mode==='signup'?'active':''}" data-mode="signup">Sign Up</div>
      </div>
      <div class="auth-field">
        <label for="username">Username</label>
        <input id="username" name="username" autocomplete="username" required minlength="1">
      </div>
      <div class="auth-field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password"
          autocomplete="${mode==='login'?'current-password':'new-password'}"
          required minlength="8">
      </div>
      <div class="auth-error">${escapeHtml(error)}</div>
      <button type="submit" class="btn primary">${mode==='login'?'Log In':'Create Account'}</button>
      ${mode==='signup' ? '<div class="auth-hint">Passwords need at least 8 characters.</div>' : ''}
      ${mode==='signup' && inviteCode ? '<div class="auth-hint">A friend invited you. You\'ll be friends as soon as you sign up.</div>' : ''}
      ${googleClientId ? `
        <div class="auth-divider">or</div>
        <div id="googleSignInDiv"></div>
      ` : ''}
    </form>`;

  app.querySelectorAll('.auth-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      mode = /** @type {'login'|'signup'} */ (/** @type {HTMLElement} */(tab).dataset.mode);
      error = '';
      render();
    });
  });

  const form = /** @type {HTMLFormElement} */ (document.getElementById('authForm'));
  form.addEventListener('submit', handleSubmit);

  if(googleClientId) renderGoogleButton();
}

/** @param {SubmitEvent} e */
async function handleSubmit(e){
  e.preventDefault();
  const form = /** @type {HTMLFormElement} */ (e.target);
  const username = /** @type {HTMLInputElement} */ (form.elements.namedItem('username')).value;
  const password = /** @type {HTMLInputElement} */ (form.elements.namedItem('password')).value;

  const res = await fetch(`/api/${mode==='login' ? 'login' : 'signup'}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(mode === 'signup' && inviteCode ? {username, password, invite: inviteCode} : {username, password})
  });
  const body = await res.json();

  if(!res.ok){
    error = body.error || 'Something went wrong.';
    render();
    return;
  }

  error = '';
  me = body;
  render();
}

// The Google script tag loads async, so it may not be ready the instant we want to
// use it — wait for window.google to actually show up rather than assuming it has.
function waitForGoogleScript(){
  return new Promise(resolve=>{
    if(/** @type {any} */ (window).google?.accounts?.id) return resolve(undefined);
    const check = setInterval(()=>{
      if(/** @type {any} */ (window).google?.accounts?.id){
        clearInterval(check);
        resolve(undefined);
      }
    }, 100);
  });
}

async function renderGoogleButton(){
  await waitForGoogleScript();
  const google = /** @type {any} */ (window).google;
  const target = document.getElementById('googleSignInDiv');
  if(!target) return; // the form may have re-rendered (mode switch) while we were waiting

  google.accounts.id.initialize({
    client_id: googleClientId,
    callback: handleGoogleCredential
  });
  google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', width: 260 });
}

/** @param {{credential: string}} response */
async function handleGoogleCredential(response){
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({credential: response.credential})
  });
  const body = await res.json();

  if(!res.ok){
    error = body.error || 'Google sign-in failed.';
    render();
    return;
  }

  error = '';
  me = body;
  render();
}

/** @param {string} s */
function escapeHtml(s){
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

checkSession();
loadConfig();
