// @ts-check
// Minimal signup/login page — just enough to prove accounts work end-to-end before
// the lobby (phase 2) gives this a real reason to exist. Same template-string render
// pattern as the game's own ui.js: rebuild the #app HTML from a small state object.

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/** @type {'login'|'signup'} */
let mode = 'login';
/** @type {string} */
let error = '';
/** @type {{username:string}|null} */
let me = null;

async function checkSession(){
  const res = await fetch('/api/me');
  me = res.ok ? await res.json() : null;
  render();
}

function render(){
  if(me){
    app.innerHTML = `
      <div class="id-card auth-card">
        <h1 class="auth-title">🏀 NBA Stat Poker</h1>
        <p class="auth-status">Signed in as <b>${escapeHtml(me.username)}</b></p>
        <a class="btn-next" href="../index.html" style="text-align:center; text-decoration:none; display:block;">Play</a>
        <button class="btn-next" id="logoutBtn" style="background:transparent; box-shadow:none; border:1.5px solid rgba(0,0,0,.3); color:var(--ink);">Log Out</button>
      </div>`;
    document.getElementById('logoutBtn')?.addEventListener('click', async ()=>{
      await fetch('/api/logout', {method:'POST'});
      me = null;
      render();
    });
    return;
  }

  app.innerHTML = `
    <form class="id-card auth-card" id="authForm">
      <h1 class="auth-title">🏀 NBA Stat Poker</h1>
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
      <button type="submit" class="btn-next">${mode==='login'?'Log In':'Create Account'}</button>
      ${mode==='signup' ? '<div class="auth-hint">Passwords need at least 8 characters.</div>' : ''}
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
    body: JSON.stringify({username, password})
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

/** @param {string} s */
function escapeHtml(s){
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

checkSession();
