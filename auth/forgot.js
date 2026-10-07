// @ts-check
// Step one of the reset flow: ask for an email, request a link. The response is the same
// generic text whether or not that email matches an account (see server/password-reset.js),
// so this page never reveals which emails are registered.

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

let error = '';
let sent = false;

function render(){
  if(sent){
    app.innerHTML = `
      <form class="start-card auth-card">
        <h1 class="auth-title">Check your email</h1>
        <div class="auth-status">If an account with that email has a password set, a reset link is on its way. It works for 30 minutes.</div>
        <a class="btn primary" style="text-align:center;" href="login.html">Back to log in</a>
      </form>`;
    return;
  }

  app.innerHTML = `
    <form class="start-card auth-card" id="forgotForm">
      <h1 class="auth-title">Reset password</h1>
      <div class="auth-hint">Enter the email on your account and we'll send a link to set a new password.</div>
      <div class="auth-field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required>
      </div>
      <div class="auth-error">${escapeHtml(error)}</div>
      <button type="submit" class="btn primary">Send reset link</button>
      <a class="auth-hint" href="login.html">Back to log in</a>
    </form>`;

  const form = /** @type {HTMLFormElement} */ (document.getElementById('forgotForm'));
  form.addEventListener('submit', handleSubmit);
}

/** @param {SubmitEvent} e */
async function handleSubmit(e){
  e.preventDefault();
  const form = /** @type {HTMLFormElement} */ (e.target);
  const email = /** @type {HTMLInputElement} */ (form.elements.namedItem('email')).value;

  const res = await fetch('/api/forgot-password', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email})
  });
  const body = await res.json();

  if(!res.ok){
    error = body.error || 'Something went wrong.';
    render();
    return;
  }

  sent = true;
  render();
}

/** @param {string} s */
function escapeHtml(s){
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

render();
