// @ts-check
// Step two of the reset flow: the link from the email carries ?token=..., which this page
// just passes straight to the server — it never tries to validate the token itself, since
// the server is the only place that can check it's unexpired and unused.

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

const token = new URLSearchParams(location.search).get('token') ?? '';
let error = '';
let done = false;

function render(){
  if(!token){
    app.innerHTML = `
      <div class="start-card auth-card">
        <h1 class="auth-title">Invalid link</h1>
        <div class="auth-status">This page needs a reset link from your email.</div>
        <a class="btn primary" style="text-align:center;" href="forgot.html">Request a new link</a>
      </div>`;
    return;
  }

  if(done){
    app.innerHTML = `
      <div class="start-card auth-card">
        <h1 class="auth-title">Password updated</h1>
        <div class="auth-status">You can log in with your new password now.</div>
        <a class="btn primary" style="text-align:center;" href="login.html">Log in</a>
      </div>`;
    return;
  }

  app.innerHTML = `
    <form class="start-card auth-card" id="resetForm">
      <h1 class="auth-title">Set a new password</h1>
      <div class="auth-field">
        <label for="password">New password</label>
        <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
      </div>
      <div class="auth-error">${escapeHtml(error)}</div>
      <button type="submit" class="btn primary">Set password</button>
      <div class="auth-hint">Passwords need at least 8 characters.</div>
    </form>`;

  const form = /** @type {HTMLFormElement} */ (document.getElementById('resetForm'));
  form.addEventListener('submit', handleSubmit);
}

/** @param {SubmitEvent} e */
async function handleSubmit(e){
  e.preventDefault();
  const form = /** @type {HTMLFormElement} */ (e.target);
  const password = /** @type {HTMLInputElement} */ (form.elements.namedItem('password')).value;

  const res = await fetch('/api/reset-password', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({token, password})
  });
  const body = await res.json();

  if(!res.ok){
    error = body.error || 'Something went wrong.';
    render();
    return;
  }

  done = true;
  render();
}

/** @param {string} s */
function escapeHtml(s){
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

render();
