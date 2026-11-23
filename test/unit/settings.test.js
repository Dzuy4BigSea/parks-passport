import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, client } from './helpers.js';
import { createSecretBox } from '../../src/lib/secret-box.js';
import { sendgridKey, saveSendgridKey } from '../../src/domain/settings.js';

const PW = 'correct horse battery';
const KEY = 'SG.abcdefghijklmnop.qrstuvwxyz0123456789_ABCD';

async function world() {
  const { app, db, mailer } = makeApp();
  const people = {};
  for (const name of ['admin', 'member']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = c;
  }
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = 'admin@example.com'").run();
  return { app, db, mailer, admin: people.admin, member: people.member };
}

test('secret box: round-trips, refuses tampering, and a different key cannot open it', () => {
  const box = createSecretBox({ envKey: 'one' });
  const sealed = box.seal(KEY);
  assert.ok(!sealed.includes('abcdefghij'));
  assert.equal(box.open(sealed), KEY);
  assert.equal(createSecretBox({ envKey: 'two' }).open(sealed), null);
  const parts = sealed.split(':');
  parts[3] = Buffer.from('tampered').toString('base64');
  assert.equal(box.open(parts.join(':')), null);
  // Without SETTINGS_KEY, a key file is created once (mode 600) and reused.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-box-'));
  const file = path.join(dir, 'settings.key');
  const a = createSecretBox({ keyFile: file });
  assert.equal((fs.statSync(file).mode & 0o777), 0o600);
  assert.equal(createSecretBox({ keyFile: file }).open(a.seal('x')), 'x');
});

test('the Email page is admin-only', async () => {
  const { member, app } = await world();
  for (const url of ['/admin/email']) {
    assert.equal((await member.get(url)).statusCode, 404);
    assert.equal((await client(app).get(url)).statusCode, 404);
  }
  assert.equal((await member.post('/admin/email/key', { sendgrid_key: KEY })).statusCode, 404);
});

test('save sender and subjects; emails use them', async () => {
  const { admin, app, mailer } = await world();
  const res = await admin.post('/admin/email', {
    mail_from_name: 'St. Pete Parks Passport', mail_from_address: 'Hello@ParksPassport.example', mail_reply_to: '',
    subject_magic_link: 'Your link, explorer', subject_password_reset: 'Reset it', subject_delete_account: 'Goodbye?',
  });
  assert.equal(res.statusCode, 303);
  const s = app.emailSettings();
  assert.equal(s.mail_from_address, 'hello@parkspassport.example');
  await client(app).post('/login/magic', { magic_email: 'member@example.com' });
  await app.mailIdle();
  assert.equal(mailer.sent.at(-1).subject, 'Your link, explorer');
});

test('email settings validation, and header injection is impossible', async () => {
  const { admin, app } = await world();
  const res = await admin.post('/admin/email', {
    mail_from_name: '', mail_from_address: 'not-an-email', mail_reply_to: 'nope',
    subject_magic_link: '', subject_password_reset: 'x'.repeat(121), subject_delete_account: 'ok',
  });
  assert.equal(res.statusCode, 422);
  for (const msg of ['Enter a sender name', 'verified in SendGrid', 'valid email address, or leave it empty', 'Enter a subject line', '120 characters']) {
    assert.ok(res.body.includes(msg), msg);
  }
  await admin.post('/admin/email', {
    mail_from_name: 'Parks\r\nBcc: evil@example.com', mail_from_address: 'a@b.co', mail_reply_to: '',
    subject_magic_link: 'Hi\nBcc: evil@example.com', subject_password_reset: 'r', subject_delete_account: 'd',
  });
  const s = app.emailSettings();
  assert.ok(!/[\r\n]/.test(s.mail_from_name + s.subject_magic_link));
});

test('SendGrid key: saved encrypted, shown only as its last 4, replaced, removed', async () => {
  const { admin, db, app } = await world();
  const bad = await admin.post('/admin/email/key', { sendgrid_key: 'not-a-key' });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.body, /starts with &quot;SG\.&quot;/);
  await admin.post('/admin/email/key', { sendgrid_key: KEY });
  const stored = db.prepare("SELECT value FROM settings WHERE key = 'sendgrid_key'").pluck().get();
  assert.ok(stored && !stored.includes('abcdefghij'), 'stored encrypted');
  assert.equal(sendgridKey(db, app.secretBox).key, KEY);
  const page = (await admin.get('/admin/email')).body;
  assert.match(page, /ending in <strong>…ABCD<\/strong>/);
  assert.ok(!page.includes('abcdefghij'), 'never shown back');
  await admin.post('/admin/email/key/delete', {});
  assert.equal(sendgridKey(db, app.secretBox).source, null);
  // A key in .env is used when none is saved here; a saved key wins.
  assert.equal(sendgridKey(db, app.secretBox, { envKey: 'SG.env.key' }).source, 'env');
  saveSendgridKey(db, app.secretBox, KEY);
  assert.equal(sendgridKey(db, app.secretBox, { envKey: 'SG.env.key' }).source, 'admin');
});

test('test email goes to the admin, and a failure is shown', async () => {
  const { admin, mailer } = await world();
  const ok = await admin.post('/admin/email/test', {});
  assert.match(ok.body, /Test email sent to admin@example\.com/);
  assert.equal(mailer.sent.at(-1).to, 'admin@example.com');
  mailer.fail = true;
  const bad = await admin.post('/admin/email/test', {});
  assert.equal(bad.statusCode, 502);
  assert.match(bad.body, /Sending failed: mail down/);
});
