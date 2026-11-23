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
    assert.match(m.html, /Not affiliated with the City of St\. Petersburg/);
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
  assert.match(m.html, /&copy; \d{4} Parks Passport &middot; Purpose built by <a href="https:\/\/bigsea\.co"/);
  const { app } = makeApp();
  const home = (await client(app).get('/')).body;
  assert.match(home, /© \d{4} Parks Passport · Purpose built by <a class="bigsea" href="https:\/\/bigsea\.co"/);
});

test('production pins the public address, so email links and the logo never point at localhost', async () => {
  const fs = await import('node:fs');
  const compose = fs.readFileSync(new URL('../../docker-compose.aster.yml', import.meta.url), 'utf8');
  assert.match(compose, /^\s+BASE_URL: https:\/\/parkspassport\.dzuynguyen\.com$/m);
});
