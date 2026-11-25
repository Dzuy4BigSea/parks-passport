import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client } from './helpers.js';
import { hashPassword, verifyPassword } from '../../src/lib/crypto.js';
import { safeNext } from '../../src/lib/auth.js';
import { createMailer } from '../../src/lib/mail.js';

const PW = 'correct horse battery';

async function signUp(c, { email = 'sam@example.com', password = PW, display_name = 'Sam' } = {}) {
  return c.post('/signup', { display_name, email, password });
}

test('passwords are scrypt-hashed and verified; wrong ones fail', async () => {
  const h = await hashPassword(PW);
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!h.includes(PW));
  assert.equal(await verifyPassword(PW, h), true);
  assert.equal(await verifyPassword('nope nope nope', h), false);
  assert.equal(await verifyPassword(PW, null), false);
});

test('sign up creates the user, signs in, and redirects to /passport', async () => {
  const { app, db } = makeApp();
  const c = client(app);
  const res = await signUp(c, { email: '  Sam@Example.COM ' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/passport');
  assert.equal(db.prepare('SELECT email FROM users').pluck().get(), 'sam@example.com');
  const passport = await c.get('/st-pete/passport');
  assert.equal(passport.statusCode, 200);
  assert.match(passport.body, /Sam's passport/);
});

test('duplicate email shows an inline error and creates no second user', async () => {
  const { app, db } = makeApp();
  await signUp(client(app));
  const res = await signUp(client(app), { email: 'SAM@example.com' });
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /An account with this email already exists/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 1);
});

test('invalid email and short password show field errors and save nothing', async () => {
  const { app, db } = makeApp();
  const res = await signUp(client(app), { email: 'not-an-email', password: 'short' });
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /id="email-error"[^>]*>Enter a valid email address/);
  assert.match(res.body, /id="password-error"[^>]*>Use at least 10 characters/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 0);
});

test('login: right password signs in; wrong password and unknown email get the same generic error', async () => {
  const { app } = makeApp();
  await signUp(client(app));
  const ok = await client(app).post('/login', { email: 'sam@example.com', password: PW });
  assert.equal(ok.statusCode, 303);
  const wrong = await client(app).post('/login', { email: 'sam@example.com', password: 'wrong password!' });
  const unknown = await client(app).post('/login', { email: 'nobody@example.com', password: 'wrong password!' });
  for (const res of [wrong, unknown]) {
    assert.equal(res.statusCode, 401);
    assert.match(res.body, /Email or password is incorrect\./);
  }
});

test('10 failed logins in 15 minutes lock the email (429) until they age out', async () => {
  const { app, now } = makeApp();
  await signUp(client(app));
  const c = client(app);
  for (let i = 0; i < 10; i++) {
    assert.equal((await c.post('/login', { email: 'sam@example.com', password: `bad password ${i}` })).statusCode, 401);
  }
  const locked = await c.post('/login', { email: 'sam@example.com', password: PW });
  assert.equal(locked.statusCode, 429);
  now.advanceMinutes(14);
  assert.equal((await c.post('/login', { email: 'sam@example.com', password: PW })).statusCode, 429);
  now.advanceMinutes(2);
  assert.equal((await c.post('/login', { email: 'sam@example.com', password: PW })).statusCode, 303);
});

test('the lock lasts 15 minutes from the 10th failure, even when failures are spread out', async () => {
  const { app, now } = makeApp();
  await signUp(client(app));
  const c = client(app);
  for (let i = 0; i < 9; i++) await c.post('/login', { email: 'sam@example.com', password: 'bad password!' });
  now.advanceMinutes(14);
  await c.post('/login', { email: 'sam@example.com', password: 'bad password!' }); // 10th
  now.advanceMinutes(2); // the first 9 are now older than 15 minutes
  assert.equal((await c.post('/login', { email: 'sam@example.com', password: PW })).statusCode, 429);
  now.advanceMinutes(14);
  assert.equal((await c.post('/login', { email: 'sam@example.com', password: PW })).statusCode, 303);
});

test('parallel wrong guesses cannot get past the limit', async () => {
  const { app } = makeApp();
  await signUp(client(app));
  const c = client(app);
  await c.get('/');
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    c.post('/login', { email: 'sam@example.com', password: `guess number ${i}` })));
  const codes = results.map((r) => r.statusCode);
  assert.equal(codes.filter((x) => x === 401).length, 10);
  assert.equal(codes.filter((x) => x === 429).length, 20);
});

test('logging in replaces the browser\'s previous session', async () => {
  const { app, db } = makeApp();
  const c = client(app);
  await signUp(c);
  await c.post('/login', { email: 'sam@example.com', password: PW });
  await c.post('/login', { email: 'sam@example.com', password: PW });
  assert.equal(db.prepare('SELECT COUNT(*) FROM sessions').pluck().get(), 1);
});

test('magic link: emailed, confirm page does not use it, sign-in works once', async () => {
  const { app, mailer } = makeApp();
  await signUp(client(app));
  const c = client(app);
  const res = await c.post('/login/magic', { magic_email: 'sam@example.com' });
  assert.match(res.body, /Check your email/);
  await app.mailIdle();
  assert.equal(mailer.sent.length, 1);
  const url = new URL(mailer.linkIn(mailer.sent[0]));
  assert.equal(url.pathname, '/auth/magic');
  const token = url.searchParams.get('token');

  // Opening the link twice (e.g. a link scanner) doesn't use it up.
  assert.match((await c.get(url.pathname + url.search)).body, /Sign in to Parks Passport/);
  assert.match((await c.get(url.pathname + url.search)).body, /Sign in to Parks Passport/);

  const signIn = await c.post('/auth/magic', { token });
  assert.equal(signIn.statusCode, 303);
  assert.equal((await c.get('/st-pete/passport')).statusCode, 200);

  const again = await client(app).post('/auth/magic', { token });
  assert.equal(again.statusCode, 400);
  assert.match(again.body, /This link has expired/);
  assert.match((await client(app).get(url.pathname + url.search)).body, /This link has expired/);
});

test('magic link expires after 15 minutes', async () => {
  const { app, mailer, now } = makeApp();
  await signUp(client(app));
  await client(app).post('/login/magic', { magic_email: 'sam@example.com' });
  await app.mailIdle();
  const token = new URL(mailer.linkIn(mailer.sent[0])).searchParams.get('token');
  now.advanceMinutes(15);
  const c = client(app);
  const res = await c.post('/auth/magic', { token });
  assert.match(res.body, /This link has expired/);
  assert.equal((await c.get('/st-pete/passport')).statusCode, 302);
});

test('magic link for an unknown email shows the same message and sends nothing', async () => {
  const { app, mailer } = makeApp();
  const res = await client(app).post('/login/magic', { magic_email: 'nobody@example.com' });
  assert.match(res.body, /Check your email/);
  await app.mailIdle();
  assert.equal(mailer.sent.length, 0);
});

test('signed-out link requests look the same whether or not the account exists, even when email is down', async () => {
  const { app, mailer } = makeApp();
  await signUp(client(app));
  mailer.fail = true;
  const known = await client(app).post('/login/magic', { magic_email: 'sam@example.com' });
  const unknown = await client(app).post('/login/magic', { magic_email: 'nobody@example.com' });
  await app.mailIdle();
  assert.equal(known.statusCode, unknown.statusCode);
  assert.equal(known.body.replace(/value="[^"]+"/g, ''), unknown.body.replace(/value="[^"]+"/g, ''));
});

test('signed-in email failure shows "Couldn\'t send email, try again"', async () => {
  const { app, mailer } = makeApp();
  const c = client(app);
  await signUp(c);
  mailer.fail = true;
  const res = await c.post('/account/delete/email');
  assert.equal(res.statusCode, 502);
  assert.match(res.body, /Couldn't send email, try again/);
});

test('at most 3 links per purpose per 15 minutes are emailed', async () => {
  const { app, mailer, now } = makeApp();
  await signUp(client(app));
  for (let i = 0; i < 6; i++) await client(app).post('/forgot', { email: 'sam@example.com' });
  await app.mailIdle();
  assert.equal(mailer.sent.length, 3);
  now.advanceMinutes(16);
  await client(app).post('/forgot', { email: 'sam@example.com' });
  await app.mailIdle();
  assert.equal(mailer.sent.length, 4);
});

test('a password reset cancels other outstanding reset and sign-in links', async () => {
  const { app, mailer } = makeApp();
  await signUp(client(app));
  const c = client(app);
  await c.post('/forgot', { email: 'sam@example.com' });
  await c.post('/forgot', { email: 'sam@example.com' });
  await c.post('/login/magic', { magic_email: 'sam@example.com' });
  await app.mailIdle();
  const [first, second, magic] = mailer.sent.map((m) => new URL(mailer.linkIn(m)).searchParams.get('token'));
  assert.equal((await c.post('/reset', { token: second, password: 'a brand new password' })).statusCode, 303);
  assert.match((await client(app).post('/reset', { token: first, password: 'attacker password!' })).body, /This link has expired/);
  assert.match((await client(app).post('/auth/magic', { token: magic })).body, /This link has expired/);
});

test('password reset: single use, 15 minutes, signs out every other session', async () => {
  const { app, mailer, now } = makeApp();
  const other = client(app);
  await signUp(other); // this session should be signed out by the reset
  assert.equal((await other.get('/st-pete/passport')).statusCode, 200);

  const c = client(app);
  await c.post('/forgot', { email: 'sam@example.com' });
  await app.mailIdle();
  const token = new URL(mailer.linkIn(mailer.sent[0])).searchParams.get('token');
  assert.equal((await c.post('/reset', { token, password: 'short' })).statusCode, 422); // doesn't use the token
  const res = await c.post('/reset', { token, password: 'a brand new password' });
  assert.equal(res.statusCode, 303);
  assert.equal((await c.get('/st-pete/passport')).statusCode, 200);
  assert.equal((await other.get('/st-pete/passport')).statusCode, 302);
  assert.match((await c.post('/reset', { token, password: 'another new password' })).body, /This link has expired/);

  const fresh = client(app);
  assert.equal((await fresh.post('/login', { email: 'sam@example.com', password: 'a brand new password' })).statusCode, 303);

  await c.post('/forgot', { email: 'sam@example.com' });
  await app.mailIdle();
  const late = new URL(mailer.linkIn(mailer.sent[1])).searchParams.get('token');
  now.advanceMinutes(16);
  assert.match((await c.get(`/reset?token=${late}`)).body, /This link has expired/);
});

test('log out ends the session and /passport redirects to /login', async () => {
  const { app } = makeApp();
  const c = client(app);
  await signUp(c);
  const out = await c.post('/logout');
  assert.equal(out.statusCode, 303);
  const res = await c.get('/st-pete/passport');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/login?next=%2Fst-pete%2Fpassport');
});

test('delete account with password removes the user, sessions and tokens', async () => {
  const { app, db } = makeApp();
  const c = client(app);
  await signUp(c);
  await c.post('/login/magic', { magic_email: 'sam@example.com' });
  assert.equal((await c.post('/account/delete', { delete_password: 'wrong password!' })).statusCode, 422);
  assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 1);
  const res = await c.post('/account/delete', { delete_password: PW });
  assert.match(res.body, /Your account is deleted/);
  for (const t of ['users', 'sessions', 'auth_tokens']) {
    assert.equal(db.prepare(`SELECT COUNT(*) FROM ${t}`).pluck().get(), 0, t);
  }
  assert.equal((await c.get('/st-pete/passport')).statusCode, 302);
});

test('delete account by emailed confirmation link', async () => {
  const { app, db, mailer } = makeApp();
  const c = client(app);
  await signUp(c);
  await c.post('/account/delete/email');
  const url = new URL(mailer.linkIn(mailer.sent[0]));
  assert.match((await c.get(url.pathname + url.search)).body, /Delete your account\?/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 1);
  await c.post('/account/delete/confirm', { token: url.searchParams.get('token') });
  assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 0);
});

test('every POST route rejects a missing or wrong CSRF token with 403', async () => {
  const { app } = makeApp();
  const c = client(app);
  await signUp(c);
  const posts = app.printRoutes({ commonPrefix: false }); // sanity: routes are registered
  assert.ok(posts.includes('logout'));
  const routes = ['/signup', '/login', '/login/magic', '/auth/magic', '/forgot', '/reset', '/logout',
    '/account/delete', '/account/delete/email', '/account/delete/confirm',
    '/st-pete/parks/abercrombie-park/checkin', '/st-pete/parks/abercrombie-park/stamp', '/visits/1/delete'];
  for (const url of routes) {
    assert.equal((await c.post(url, {}, { csrf: false })).statusCode, 403, `${url} without token`);
    assert.equal((await c.post(url, { _csrf: 'forged' }, { csrf: false })).statusCode, 403, `${url} with wrong token`);
  }
  assert.equal((await c.get('/st-pete/passport')).statusCode, 200, 'still signed in');
});

test('state-changing requests without a valid CSRF token get 403', async () => {
  const { app, db } = makeApp();
  const c = client(app);
  await c.get('/');
  const none = await c.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: PW }, { csrf: false });
  assert.equal(none.statusCode, 403);
  const wrong = await c.post('/signup', { _csrf: 'forged', display_name: 'Sam', email: 'sam@example.com', password: PW }, { csrf: false });
  assert.equal(wrong.statusCode, 403);
  assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 0);
});

test('cookies are HttpOnly and SameSite=Lax, and Secure in production', async () => {
  for (const secureCookies of [false, true]) {
    const { app } = makeApp({ secureCookies });
    const c = client(app);
    const res = await signUp(c);
    const prefix = secureCookies ? '__Host-' : '';
    const session = res.cookies.find((x) => x.name === `${prefix}pp_session`);
    assert.ok(session, 'session cookie set');
    assert.equal(session.httpOnly, true);
    assert.equal(session.sameSite, 'Lax');
    assert.equal(Boolean(session.secure), secureCookies);
    assert.equal(session.path, '/');
    assert.equal(session.domain, undefined);
    const csrf = (await app.inject('/')).cookies.find((x) => x.name === `${prefix}pp_csrf`);
    assert.equal(csrf.httpOnly, true);
    assert.equal(Boolean(csrf.secure), secureCookies);
  }
});

test('post-login redirects only to local paths', () => {
  assert.equal(safeNext('/st-pete/parks/abercrombie-park'), '/st-pete/parks/abercrombie-park');
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/☃', '/a b', '', undefined]) assert.equal(safeNext(bad), '/passport');
});

test('sendgrid mailer posts to the v3 API with click tracking off, and fails loudly', async () => {
  const calls = [];
  const resolve = () => ({ apiKey: 'SG.test', fromAddress: 'a@b.co', fromName: 'Parks Passport', replyTo: 'r@b.co' });
  const ok = createMailer({ transport: 'sendgrid', resolve,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 202 }; } });
  await ok.send({ to: 'x@y.co', subject: 's', text: 't' });
  assert.equal(calls[0].url, 'https://api.sendgrid.com/v3/mail/send');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer SG.test');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.tracking_settings.click_tracking.enable, false);
  assert.deepEqual(body.from, { email: 'a@b.co', name: 'Parks Passport' });
  assert.deepEqual(body.reply_to, { email: 'r@b.co' });
  const bad = createMailer({ transport: 'sendgrid', resolve, fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'bad key' }) });
  await assert.rejects(bad.send({ to: 'x@y.co', subject: 's', text: 't' }), /401/);
  const noKey = createMailer({ transport: 'sendgrid', resolve: () => ({ apiKey: null, fromAddress: 'a@b.co' }) });
  await assert.rejects(noKey.send({ to: 'x@y.co', subject: 's', text: 't' }), /No SendGrid API key/);
});
