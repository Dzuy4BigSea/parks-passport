import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';

const PW = 'correct horse battery';

async function setup() {
  const now = testClock('2026-06-01T12:00:00Z');
  const made = makeApp({ now });
  const dee = client(made.app);
  await dee.post('/signup', { display_name: 'Dee', email: 'dee@example.com', password: PW });
  made.db.prepare("UPDATE users SET is_admin = 1 WHERE email = 'dee@example.com'").run();
  return { ...made, dee };
}

test('admin invites by email: branded invitation, /join link fills in sign-up, invite marked joined', async () => {
  const { app, db, mailer, dee } = await setup();
  const res = await dee.post('/admin/invites', { invite_email: ' Ana@Example.com ', invite_name: 'Ana' });
  assert.equal(res.statusCode, 303);
  const msg = mailer.sent.at(-1);
  assert.equal(msg.to, 'ana@example.com');
  assert.equal(msg.subject, "You're invited to Parks Passport");
  assert.match(msg.html, /Hi Ana,/);
  assert.match(msg.html, /Dee invited you to Parks Passport/);
  const link = mailer.linkIn(msg);
  assert.match(link, /^http:\/\/test\.local\/join\/[A-Za-z0-9_-]{30,}$/);
  assert.equal(db.prepare('SELECT token_hash FROM invites').pluck().get().length, 64); // only the hash is stored

  const members = (await dee.get('/admin/users')).body;
  assert.match(members, /ana@example\.com/);
  assert.match(members, /Pending/);

  const ana = client(app);
  const join = await ana.get(link.replace('http://test.local', ''));
  assert.equal(join.statusCode, 200);
  assert.match(join.body, /You're invited/);
  assert.match(join.body, /Dee invited you/);
  assert.match(join.body, /value="ana@example\.com"/);
  assert.match(join.body, /value="Ana"/);
  assert.doesNotMatch(join.body, /\/stats\/script\.js|gtm\.js/); // no analytics on token URLs

  await ana.post('/signup', { display_name: 'Ana', email: 'ana@example.com', password: PW });
  assert.ok(db.prepare("SELECT accepted_at FROM invites WHERE email = 'ana@example.com'").pluck().get());
  assert.match((await dee.get('/admin/users')).body, /Joined/);
  // A used link no longer fills anything in, but sign-up is still offered.
  const used = await client(app).get(link.replace('http://test.local', ''));
  assert.match(used.body, /expired or was already used/);
  assert.doesNotMatch(used.body, /value="ana@example\.com"/);
});

test('invites: members get 404; bad, existing and repeat addresses are refused; failed sends can retry', async () => {
  const { app, db, mailer, dee } = await setup();
  const sam = client(app);
  await sam.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: PW });
  assert.equal((await sam.post('/admin/invites', { invite_email: 'x@example.com' })).statusCode, 404);

  assert.match((await dee.post('/admin/invites', { invite_email: 'nope' })).body, /Enter a valid email address/);
  assert.match((await dee.post('/admin/invites', { invite_email: 'sam@example.com' })).body, /already has an account/);
  assert.equal((await dee.post('/admin/invites', { invite_email: 'bo@example.com' })).statusCode, 303);
  const again = await dee.post('/admin/invites', { invite_email: 'bo@example.com' });
  assert.equal(again.statusCode, 422);
  assert.match(again.body, /invited in the last day/);

  mailer.fail = true;
  const failed = await dee.post('/admin/invites', { invite_email: 'cy@example.com', invite_name: 'Cy' });
  assert.equal(failed.statusCode, 502);
  assert.match(failed.body, /couldn&#39;t be sent/);
  assert.equal(db.prepare("SELECT COUNT(*) FROM invites WHERE email = 'cy@example.com'").pluck().get(), 0);
  mailer.fail = false;
  assert.equal((await dee.post('/admin/invites', { invite_email: 'cy@example.com' })).statusCode, 303);
});

test('invite links expire after 30 days, and the invitation wording is editable', async () => {
  const { app, mailer, dee, now } = await setup();
  await dee.post('/admin/email/messages/invite', {
    subject: '{inviter} saved you a passport', preheader: '', heading: 'Come explore, {name}',
    body: 'Hi {name}, {inviter} thinks you\'d love this.', button: 'Join now', note: '',
  });
  await dee.post('/admin/invites', { invite_email: 'ana@example.com', invite_name: 'Ana' });
  const msg = mailer.sent.at(-1);
  assert.equal(msg.subject, 'Dee saved you a passport');
  assert.match(msg.html, /Come explore, Ana/);
  const path = mailer.linkIn(msg).replace('http://test.local', '');
  now.advanceMinutes(31 * 24 * 60);
  assert.match((await client(app).get(path)).body, /expired or was already used/);
});
