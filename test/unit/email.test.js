import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client } from './helpers.js';
import { createMailer } from '../../src/lib/mail.js';
import { magicLinkEmail, passwordResetEmail, deleteAccountEmail, testEmail } from '../../src/views/email.js';

const BASE = 'https://parks.example';
const URL_ = `${BASE}/auth/magic?token=abc&next=%2Fpassport`;

test('every email has branded HTML plus plain text whose first URL is the link', () => {
  for (const build of [magicLinkEmail, passwordResetEmail, deleteAccountEmail]) {
    const m = build({ baseUrl: BASE, subject: 'Subj', name: 'Sam', url: URL_, tagline: 'Sunshine City' });
    assert.equal(m.subject, 'Subj');
    assert.equal(m.text.match(/https?:\/\/\S+/)[0], URL_);
    assert.match(m.html, /^<!doctype html>/);
    assert.match(m.html, /Parks Passport/);
    assert.match(m.html, new RegExp(`src="${BASE}/icons/icon-192.png"`));
    assert.ok(m.html.includes(`href="${URL_.replace(/&/g, '&amp;')}"`), 'button links to the token URL');
    assert.match(m.html, /Made for the Sunshine City/);
    assert.match(m.html, /Not affiliated with any city government/);
    assert.match(m.html, /expires in 15 minutes/);
  }
  const t = testEmail({ baseUrl: BASE, fromName: 'Parks Passport', fromAddress: 'hi@parks.example', tagline: '' });
  assert.match(t.html, /Email sending works/);
  assert.doesNotMatch(t.html, /Made for the/);
});

test('names and other values are escaped in the HTML', () => {
  const m = magicLinkEmail({ baseUrl: BASE, subject: 's', name: '<img src=x onerror=alert(1)>', url: `${BASE}/x?token="><script>`, tagline: '<b>' });
  assert.doesNotMatch(m.html, /<img src=x|<script>|<b>/);
  assert.match(m.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('SendGrid gets text/plain first and the HTML part second', async () => {
  let body;
  const mailer = createMailer({
    transport: 'sendgrid',
    resolve: () => ({ apiKey: 'SG.test', fromAddress: 'hi@parks.example', fromName: 'Parks Passport', replyTo: '' }),
    fetchImpl: async (_url, opts) => { body = JSON.parse(opts.body); return { ok: true }; },
  });
  await mailer.send({ to: 'a@b.co', subject: 's', text: 'plain', html: '<p>rich</p>' });
  assert.deepEqual(body.content, [{ type: 'text/plain', value: 'plain' }, { type: 'text/html', value: '<p>rich</p>' }]);
  await mailer.send({ to: 'a@b.co', subject: 's', text: 'plain' });
  assert.deepEqual(body.content, [{ type: 'text/plain', value: 'plain' }]);
});

test('the magic-link email sent by the app is the branded one', async () => {
  const { app, mailer } = makeApp();
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: 'correct horse battery' });
  await client(app).post('/login/magic', { magic_email: 'sam@example.com' });
  await app.mailIdle();
  const msg = mailer.sent.at(-1);
  assert.match(msg.html, /Your sign-in link/);
  assert.match(mailer.linkIn(msg), /\/auth\/magic\?token=/);
});

test('email and site footers carry the copyright and the Big Sea credit', async () => {
  const m = testEmail({ baseUrl: BASE, fromName: 'P', fromAddress: 'p@parks.example', tagline: '' });
  assert.match(m.html, /&copy; \d{4} Parks Passport &middot; <a href="https:\/\/bigsea\.co"[^>]*>Purpose built by&nbsp;<img src="https:\/\/parks\.example\/brand\/bigsea-logo\.png"[^>]*alt="Big Sea"/);
  const { app } = makeApp();
  const home = (await client(app).get('/')).body;
  assert.match(home, /© \d{4} Parks Passport<\/span>/);
  assert.match(home, /<a class="bigsea" href="https:\/\/bigsea\.co"[^>]*><span>Purpose built by<\/span><img src="\/brand\/bigsea-logo\.svg" alt="Big Sea"/);
  // Big Sea's B Corp and 1% for the Planet marks under the credit line.
  assert.match(home, /Big Sea is a Certified B Corporation and a member of 1% for the Planet\./);
  assert.match(home, /<img src="\/brand\/b-corp\.png" alt="Certified B Corporation"/);
  assert.match(home, /<img src="\/brand\/one-percent-for-the-planet\.png" alt="1% for the Planet member"/);
  assert.equal((await client(app).get('/brand/bigsea-logo.png')).statusCode, 200);
  for (const logo of ['b-corp.png', 'one-percent-for-the-planet.png']) {
    assert.equal((await client(app).get(`/brand/${logo}`)).statusCode, 200);
  }
});

test('production pins the public address, so email links and the logo never point at localhost', async () => {
  const fs = await import('node:fs');
  const compose = fs.readFileSync(new URL('../../docker-compose.aster.yml', import.meta.url), 'utf8');
  assert.match(compose, /^\s+BASE_URL: https:\/\/parkspassport\.dzuynguyen\.com$/m);
});

// ---- Admin › Email › Messages ----

async function adminClient(app, db) {
  const c = client(app);
  await c.post('/signup', { display_name: 'Dee', email: 'dee@example.com', password: 'correct horse battery' });
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = 'dee@example.com'").run();
  return c;
}

test('admin edits an email\'s wording; members get it, with {name} filled in and escaped', async () => {
  const { app, db, mailer } = makeApp();
  const sam = client(app);
  await sam.post('/signup', { display_name: '<b>Sam</b>', email: 'sam@example.com', password: 'correct horse battery' });
  assert.equal((await sam.get('/admin/email/messages/magic_link')).statusCode, 404);

  const dee = await adminClient(app, db);
  assert.equal((await dee.get('/admin/email/messages/nope')).statusCode, 404);
  const page = await dee.get('/admin/email/messages/magic_link');
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<iframe title="Preview of the sign-in link email" srcdoc="/);

  const bad = await dee.post('/admin/email/messages/magic_link', { subject: '', heading: 'x'.repeat(81), body: 'b', button: 'Go' });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.body, /Enter the subject line/);

  const ok = await dee.post('/admin/email/messages/magic_link', {
    subject: 'Your key to the parks, {name}', preheader: 'Tap to get back in', heading: 'Welcome back, {name}!',
    body: 'Hey {name},\n\nOne tap and you\'re in.\nSee you outside.', button: 'Open my passport', note: '',
  });
  assert.equal(ok.statusCode, 303);
  await client(app).post('/login/magic', { magic_email: 'sam@example.com' });
  await app.mailIdle();
  const msg = mailer.sent.at(-1);
  assert.equal(msg.subject, 'Your key to the parks, <b>Sam</b>');
  assert.match(msg.html, /Welcome back, &lt;b&gt;Sam&lt;\/b&gt;!/);
  assert.match(msg.html, /One tap and you&#39;re in\.<br>See you outside\./);
  assert.match(msg.html, /Open my passport/);
  assert.doesNotMatch(msg.html, /<b>Sam<\/b>/);
  assert.match(mailer.linkIn(msg), /\/auth\/magic\?token=/);
  assert.match((await dee.get('/admin/email')).body, /Custom wording/);

  // Reset puts the wording back (the subject stays as saved).
  assert.equal((await dee.post('/admin/email/messages/magic_link/reset')).statusCode, 303);
  await client(app).post('/login/magic', { magic_email: 'sam@example.com' });
  await app.mailIdle();
  assert.match(mailer.sent.at(-1).html, /Your sign-in link/);
});

test('admin can send themselves a preview; the sender form no longer needs subjects', async () => {
  const { app, db, mailer } = makeApp();
  const dee = await adminClient(app, db);
  const res = await dee.post('/admin/email/messages/delete_account/send');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Preview sent to dee@example\.com/);
  const msg = mailer.sent.at(-1);
  assert.equal(msg.to, 'dee@example.com');
  assert.match(msg.subject, /^\[Preview\] /);
  assert.match(msg.html, /Yes, delete my account/);
  const saved = await dee.post('/admin/email', { mail_from_name: 'Parks Passport', mail_from_address: 'hi@example.com', mail_reply_to: '' });
  assert.equal(saved.statusCode, 303);
});
