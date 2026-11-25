import { html } from '../html.js';
import { avatar } from '../avatar.js';
import { csrfField, errorSummary, field } from '../forms.js';
import { visibilityForm } from './pals.js';

const nextField = (next) => (next ? html`<input type="hidden" name="next" value="${next}">` : '');
const withNext = (path, next) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

export function signupPage({ csrf, values = {}, errors = {}, next, invite = null, inviteNotice = null, cityName = 'St. Pete', palInviter = null, inviteToken = '' }) {
  return {
    title: 'Create your passport',
    body: html`<div class="narrow">
${invite || palInviter ? html`<p class="eyebrow">You're invited</p>` : ''}
<h1>Create your passport</h1>
${invite?.inviter_name ? html`<p class="lede">${invite.inviter_name} invited you. Stamp every ${cityName} park you visit, earn badges and explore with friends. You'll be Park Pals with ${invite.inviter_name} as soon as you join.</p>` : ''}
${palInviter ? html`<p class="lede">Sign up and you'll be Park Pals with ${palInviter.display_name} straight away, so you can see each other's stamps and badges.</p>` : ''}
${inviteNotice ? html`<p class="notice" role="status">${inviteNotice}</p>` : ''}
${errorSummary(errors, { display_name: 'Display name', email: 'Email', password: 'Password' })}
<form method="post" action="/signup" class="card-form" novalidate>
  ${csrfField(csrf)}${nextField(next)}${inviteToken ? html`<input type="hidden" name="invite_token" value="${inviteToken}">` : ''}
  ${field({ name: 'display_name', label: 'Display name', value: values.display_name, error: errors.display_name, autocomplete: 'nickname', hint: "What others see. It doesn't have to be your real name: a nickname works. You can change it later in Account.", maxlength: 40 })}
  ${field({ name: 'email', label: 'Email', type: 'email', value: values.email, error: errors.email, autocomplete: 'email' })}
  ${field({ name: 'password', label: 'Password', type: 'password', error: errors.password, autocomplete: 'new-password', hint: 'At least 10 characters.' })}
  <div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  <button type="submit" class="btn btn-primary">Create account</button>
</form>
<p>Already have one? <a href="${withNext('/login', next)}">Log in</a></p>
</div>`,
  };
}

export function loginPage({ csrf, values = {}, errors = {}, next }) {
  return {
    title: 'Log in',
    body: html`<div class="narrow">
<h1>Log in</h1>
${errorSummary(errors)}
<form method="post" action="/login" class="card-form" novalidate>
  ${csrfField(csrf)}${nextField(next)}
  ${field({ name: 'email', label: 'Email', type: 'email', value: values.email, autocomplete: 'email' })}
  ${field({ name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}
  <button type="submit" class="btn btn-primary">Log in</button>
  <p><a href="/forgot">Forgot your password?</a></p>
</form>

<h2>Or get a sign-in link</h2>
<form method="post" action="/login/magic" class="card-form" novalidate>
  ${csrfField(csrf)}${nextField(next)}
  ${field({ name: 'magic_email', label: 'Email', type: 'email', value: values.email, autocomplete: 'email' })}
  <button type="submit" class="btn">Email me a sign-in link</button>
</form>
<p>New here? <a href="${withNext('/signup', next)}">Create your passport</a></p>
</div>`,
  };
}

export function checkEmailPage({ what = 'a sign-in link' } = {}) {
  return {
    title: 'Check your email',
    body: html`<div class="narrow">
<h1>Check your email</h1>
<p role="status">If an account exists for that address, we've sent ${what}. It works once and expires in 15 minutes.</p>
<p><a href="/login">Back to log in</a></p>
</div>`,
  };
}

export function sendFailedPage() {
  return {
    status: 502,
    title: "Couldn't send email",
    body: html`<div class="narrow">
<h1>Couldn't send email</h1>
<p role="alert">Couldn't send email, try again in a minute.</p>
<p><a href="/login">Back to log in</a></p>
</div>`,
  };
}

export function linkExpiredPage() {
  return {
    status: 400,
    title: 'This link has expired',
    body: html`<div class="narrow">
<h1>This link has expired</h1>
<p>Links work once and expire after 15 minutes. You can ask for a new one.</p>
<p><a class="btn btn-primary" href="/login">Back to log in</a></p>
</div>`,
  };
}

// GET on an emailed link only shows this page; the POST uses the token, so link scanners can't.
export function magicConfirmPage({ csrf, token, next }) {
  return {
    title: 'Sign in',
    body: html`<div class="narrow">
<h1>Sign in to Parks Passport</h1>
<form method="post" action="/auth/magic" class="card-form">
  ${csrfField(csrf)}${nextField(next)}
  <input type="hidden" name="token" value="${token}">
  <button type="submit" class="btn btn-primary">Sign in</button>
</form>
</div>`,
  };
}

export function forgotPage({ csrf, values = {}, errors = {} }) {
  return {
    title: 'Reset your password',
    body: html`<div class="narrow">
<h1>Reset your password</h1>
${errorSummary(errors)}
<form method="post" action="/forgot" class="card-form" novalidate>
  ${csrfField(csrf)}
  ${field({ name: 'email', label: 'Email', type: 'email', value: values.email, error: errors.email, autocomplete: 'email' })}
  <button type="submit" class="btn btn-primary">Email me a reset link</button>
</form>
</div>`,
  };
}

export function resetPage({ csrf, token, errors = {} }) {
  return {
    title: 'Choose a new password',
    body: html`<div class="narrow">
<h1>Choose a new password</h1>
${errorSummary(errors, { password: 'New password' })}
<form method="post" action="/reset" class="card-form" novalidate>
  ${csrfField(csrf)}
  <input type="hidden" name="token" value="${token}">
  ${field({ name: 'password', label: 'New password', type: 'password', error: errors.password, autocomplete: 'new-password', hint: 'At least 10 characters. This signs you out everywhere else.' })}
  <button type="submit" class="btn btn-primary">Save password</button>
</form>
</div>`,
  };
}

// Profile photo: upload, replace or remove. Seen by whoever can see the passport.
const PHOTO_WHO = { private: 'only you', pals: 'you and your Park Pals', public: 'anyone with your passport link' };
function profilePhoto({ csrf, user, error }) {
  return html`<section id="photo" class="profile-photo" aria-labelledby="photo-h">
  ${avatar(user, { size: 96, cls: 'avatar-lg' })}
  <div>
  <h2 id="photo-h">Profile photo</h2>
  <p class="muted">Seen by ${PHOTO_WHO[user.default_visibility] || 'only you'}, like your passport (<a href="#visibility">change who</a>).${user.kids ? ' Kids edition is on: use a photo of yourself, not your kids.' : ''}</p>
  ${error ? html`<p class="error-text" id="photo-error" role="alert">${error}</p>` : ''}
  <form method="post" action="/account/avatar" class="inline-form photo-form" enctype="multipart/form-data">
    ${csrfField(csrf)}
    <label for="avatar-file" class="visually-hidden">Choose a profile photo</label>
    <input type="file" id="avatar-file" name="photo" accept="image/jpeg,image/png,image/webp" required${error ? html` aria-describedby="photo-error" aria-invalid="true"` : ''}>
    <button type="submit" class="btn btn-small">${user.avatar_key ? 'Replace photo' : 'Upload photo'}</button>
  </form>
  ${user.avatar_key ? html`<form method="post" action="/account/avatar/delete" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-quiet btn-small">Remove photo</button></form>` : ''}
  </div>
</section>`;
}

export function accountPage({ csrf, user, errors = {}, notice, ideas = false, values = {} }) {
  return {
    title: 'Account',
    current: 'account',
    scripts: ['/js/prefs.js'],
    body: html`<div class="narrow">
<h1>Account</h1>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
${profilePhoto({ csrf, user, error: errors.photo })}
${errors.display_name ? errorSummary({ display_name: errors.display_name }, { display_name: 'Display name' }) : ''}
<form method="post" action="/account/name" class="card-form" id="name" novalidate>
  ${csrfField(csrf)}
  ${field({ name: 'display_name', label: 'Display name', value: values.display_name ?? user.display_name, error: errors.display_name, autocomplete: 'nickname', maxlength: 40,
    hint: `What Park Pals and groups see. It doesn't have to be your real name. Changing it also changes your passport link (now @${user.handle}); old links stop working.` })}
  <button type="submit" class="btn">Save name</button>
</form>
<dl class="facts">
  <dt>Email</dt><dd>${user.email}</dd>
  <dt>Handle</dt><dd>@${user.handle}</dd>
</dl>
<p><a href="/sunshine"><span aria-hidden="true">☀️</span> Send a drop of sunshine</a> to the people who look after your parks.</p>
${ideas ? html`<p><a href="/ideas">Share a badge idea</a></p>` : ''}
<form method="post" action="/logout" class="inline-form">
  ${csrfField(csrf)}
  <button type="submit" class="btn">Log out</button>
</form>

${visibilityForm({ csrf, user })}

<section id="device" class="js-only" aria-labelledby="device-h">
<h2 id="device-h">On this device</h2>
<label class="check"><input type="checkbox" id="celebrations"> Show celebrations: badge reveals, the passport opening and badge cards that tilt. Never any sound.</label>
<p id="celebrations-status" class="muted" role="status"></p>
</section>

<section id="editions" aria-labelledby="ed-h">
<h2 id="ed-h">Editions</h2>
<p>Add extra things to do at parks, with their own badges.</p>
<form method="post" action="/account/editions" class="card-form">
  ${csrfField(csrf)}
  <label class="check"><input type="checkbox" name="paws" value="1"${user.paws ? html` checked` : ''}> 🐾 Paws: I bring a pet</label>
  <label class="check"><input type="checkbox" name="kids" value="1"${user.kids ? html` checked` : ''}> 🧒 Kids: I bring kids. New photos start as "Only me", and we never ask for children's names or ages.</label>
  <button type="submit" class="btn btn-primary">Update editions</button>
</form>
</section>

<h2>Delete my account</h2>
<p>This permanently removes your account and everything in it: visits, photos, ratings, badges and Park Pals.</p>
${errorSummary(errors.delete_password ? { delete_password: errors.delete_password } : {}, { delete_password: 'Password' })}
<form method="post" action="/account/delete" class="card-form danger" novalidate>
  ${csrfField(csrf)}
  ${field({ name: 'delete_password', label: 'Confirm with your password', type: 'password', error: errors.delete_password, autocomplete: 'current-password' })}
  <button type="submit" class="btn btn-danger">Delete my account</button>
</form>
<form method="post" action="/account/delete/email" class="inline-form">
  ${csrfField(csrf)}
  <button type="submit" class="btn btn-quiet">Signed in with a link? Email me a confirmation link instead</button>
</form>
</div>`,
  };
}

export function deleteConfirmPage({ csrf, token }) {
  return {
    title: 'Delete your account',
    body: html`<div class="narrow">
<h1>Delete your account?</h1>
<p>This permanently removes your account and everything in it. It can't be undone.</p>
<form method="post" action="/account/delete/confirm" class="card-form danger">
  ${csrfField(csrf)}
  <input type="hidden" name="token" value="${token}">
  <button type="submit" class="btn btn-danger">Delete my account</button>
</form>
<p><a href="/passport">Keep my account</a></p>
</div>`,
  };
}

export function accountDeletedPage() {
  return {
    title: 'Account deleted',
    body: html`<div class="narrow">
<h1>Your account is deleted</h1>
<p role="status">Everything in your passport has been removed. Thanks for exploring.</p>
<p><a href="/parks">Browse parks</a></p>
</div>`,
  };
}
