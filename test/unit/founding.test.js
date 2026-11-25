// M25: Founding Members (first 75, numbered) and feedback from founding explorers (SPEC Flow 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeApp, client, testClock } from './helpers.js';
import { addMissingBadges, grantBadge, revokeUnmetBadges } from '../../src/domain/badges/index.js';
import { SEED_LIMITED_BADGES_JSON } from '../../src/db/seed.js';
import { awardFounding, awardEarlyBird, backfillFounding, FOUNDING_LIMIT } from '../../src/domain/founding.js';
import { takeUnseenBadges } from '../../src/domain/badges/index.js';
import { deleteUser } from '../../src/domain/users.js';

const PW = 'correct horse battery';
const seedLimited = (db) => addMissingBadges(db, JSON.parse(fs.readFileSync(SEED_LIMITED_BADGES_JSON, 'utf8')));

async function world({ seed = true } = {}) {
  const made = makeApp({ now: testClock('2026-06-06T16:00:00Z') });
  if (seed) seedLimited(made.db);
  const signup = async (name) => {
    const c = client(made.app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    return { c, id: made.db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  };
  const founding = made.db.prepare("SELECT id FROM badges WHERE slug = 'founding-member'").pluck().get();
  const serialOf = (userId) => made.db.prepare('SELECT serial FROM user_badges WHERE user_id = ? AND badge_id = ?').pluck().get(userId, founding);
  return { ...made, signup, founding, serialOf };
}

// Fast inserts for the 75-member cap (no password hashing).
const addUsers = (db, n, start = 0) => {
  const ins = db.prepare(`INSERT INTO users (email, display_name, handle, created_at) VALUES (?, ?, ?, ?)`);
  return Array.from({ length: n }, (_, i) => Number(ins.run(`u${start + i}@example.com`, `U${start + i}`, `u${start + i}`,
    new Date(Date.UTC(2026, 0, 1) + (start + i) * 60000).toISOString()).lastInsertRowid));
};

test('Founding Member ships as a given-only badge, not limited (admins give more after 75)', () => {
  const fm = JSON.parse(fs.readFileSync(SEED_LIMITED_BADGES_JSON, 'utf8')).find((b) => b.slug === 'founding-member');
  assert.equal(fm.rule_type, 'manual');
  assert.equal(fm.limited_count, undefined);
});

test('sign-up gives the next Founding Member number with a welcome notification; the rules never take it back', async () => {
  const { db, signup, serialOf } = await world();
  const ana = await signup('ana');
  const ben = await signup('ben');
  assert.equal(serialOf(ana.id), 1);
  assert.equal(serialOf(ben.id), 2);
  assert.match(db.prepare("SELECT text FROM notifications WHERE user_id = ? AND kind = 'gift'").pluck().get(ana.id), /Welcome, Founding Member #1!/);
  revokeUnmetBadges(db, ana.id);
  assert.equal(serialOf(ana.id), 1);
  // The passport shows it with its number.
  assert.match((await ana.c.get('/st-pete/passport')).body, /Founding Member/);
});

test('only the first 75 get it automatically; deleted accounts never hand their number on; admins give it after', async () => {
  const { db, signup, serialOf, founding } = await world();
  const ids = addUsers(db, 80);
  assert.equal(backfillFounding(db), FOUNDING_LIMIT);
  assert.equal(serialOf(ids[0]), 1); // oldest first
  assert.equal(serialOf(ids[74]), 75);
  assert.equal(serialOf(ids[75]), undefined);
  assert.equal(backfillFounding(db), 0); // idempotent
  deleteUser(db, ids[3]);
  assert.equal(awardFounding(db, ids[76]), null); // #4 isn't handed to someone else
  const late = await signup('late');
  assert.equal(serialOf(late.id), undefined);
  // An admin can still give it (without a number).
  const admin = { id: ids[0], display_name: 'U0' };
  assert.deepEqual(grantBadge(db, { admin, userId: late.id, badgeId: founding }).ok, true);
  assert.equal(serialOf(late.id), null);
});

test('backfill waits for the badge to exist (seeded at start)', async () => {
  const { db } = await world({ seed: false });
  addUsers(db, 3);
  assert.equal(backfillFounding(db), 0);
  seedLimited(db);
  assert.equal(backfillFounding(db), 3);
});

test('feedback: the button and /feedback only for Founding Members and Early Bird Edition holders; everyone else 404', async () => {
  const { db, app, signup } = await world();
  addUsers(db, 75, 100); // use up the founding numbers
  backfillFounding(db);
  for (const id of addUsers(db, 100, 300)) awardEarlyBird(db, id); // and every Early Bird copy
  const mia = await signup('mia'); // no founding or Early Bird badge left
  const plain = (await mia.c.get('/st-pete/parks')).body;
  assert.match(plain, /class="gary-fab"/); // Gary is there for everyone (Flow 21)
  assert.doesNotMatch(plain, /data-gary-talk|action="\/feedback"/); // but only founding explorers talk back
  assert.equal((await mia.c.get('/feedback')).statusCode, 404);
  assert.equal((await mia.c.post('/feedback', { text: 'hi' })).statusCode, 404);
  assert.match((await client(app).get('/feedback')).headers.location, /^\/login/); // signed out: log in

  // Early Bird Edition also unlocks it.
  const eb = db.prepare("SELECT id FROM badges WHERE slug = 'early-bird-100'").pluck().get();
  db.prepare('DELETE FROM user_badges WHERE badge_id = ? AND serial = 100').run(eb); // free one copy
  assert.ok(grantBadge(db, { admin: { id: mia.id, display_name: 'Boss' }, userId: mia.id, badgeId: eb }).ok);
  const page = (await mia.c.get('/st-pete/parks')).body;
  assert.match(page, /<form method="post" action="\/feedback" class="gary-talk feedback-form" data-gary-talk>/);
  assert.match(page, /goes to the Parks Passport team as <strong>feedback<\/strong>/);
  assert.match(page, /name="page" value="\/st-pete\/parks"/);
  assert.equal((await mia.c.get('/feedback?from=/st-pete/parks')).statusCode, 200);
});

test('feedback: send (form and JSON), validation, daily limit, admin inbox and done', async () => {
  const { db, app, signup } = await world();
  const ana = await signup('ana'); // Founding Member #1
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(ana.id);
  const ben = await signup('ben'); // #2, not an admin

  assert.match((await ben.c.post('/feedback', { kind: 'bug', text: '   ' })).body, /Write a few words first/);
  assert.match((await ben.c.post('/feedback', { kind: 'bug', text: 'x'.repeat(1001) })).body, /1,000 characters/);
  const sent = await ben.c.post('/feedback', { kind: 'bug', text: 'The map <b>jumps</b>', page: '/st-pete/parks?lat=27.7&lng=-82.6' });
  assert.equal(sent.headers.location, '/feedback?done=sent&kind=bug');
  const thanks = (await ben.c.get('/feedback?done=sent&kind=bug')).body;
  assert.match(thanks, /Thank you. We read every one./);
  assert.match(thanks, /class="gary-msg is-gary"/); // Gary's reply
  const row = db.prepare('SELECT * FROM feedback').get();
  assert.equal(row.kind, 'bug');
  assert.equal(row.page, '/st-pete/parks'); // never the query string (a position)
  // A page that isn't a path in this app is dropped.
  await ben.c.post('/feedback', { text: 'x', page: '//evil.example/x' });
  assert.equal(db.prepare('SELECT page FROM feedback ORDER BY id DESC').pluck().get(), '');

  // JSON for the dialog.
  await ben.c.get('/');
  const csrf = [...ben.c.jar].find(([k]) => k.endsWith('pp_csrf'))[1];
  const json = await app.inject({ method: 'POST', url: '/feedback', payload: `_csrf=${csrf}&kind=love&text=yay`,
    headers: { cookie: [...ben.c.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
  assert.equal(json.json().ok, true);
  const { REPLIES } = await import('../../src/views/gary-help.js');
  assert.ok(REPLIES.love.includes(json.json().reply)); // a reply that fits "Love it"

  for (let i = 0; i < 17; i++) await ben.c.post('/feedback', { text: `more ${i}` });
  const limited = await ben.c.post('/feedback', { text: 'one too many' });
  assert.match(limited.body, /a lot of feedback for one day/);

  // Admin inbox: members 404; open list; done moves it.
  assert.equal((await ben.c.get('/admin/feedback')).statusCode, 404);
  const inbox = (await ana.c.get('/admin/feedback')).body;
  assert.match(inbox, /Something(&#39;|')s broken<\/strong>: The map &lt;b&gt;jumps&lt;\/b&gt;/);
  assert.match(inbox, /ben \(@ben\)/);
  assert.match((await ana.c.get('/admin')).body, /20 open · from founding explorers/);
  assert.equal((await ana.c.post(`/admin/feedback/${row.id}`, { done: '1' })).statusCode, 303);
  assert.doesNotMatch((await ana.c.get('/admin/feedback')).body, /The map/);
  assert.match((await ana.c.get('/admin/feedback?show=done')).body, /The map/);
  assert.equal((await ana.c.post('/admin/feedback/99999', { done: '1' })).statusCode, 404);

  // Deleting the account deletes its feedback.
  deleteUser(db, ben.id);
  assert.equal(db.prepare('SELECT COUNT(*) FROM feedback').pluck().get(), 0);
});

test('QA: a taken-back Founding Member stays taken back (the backfill runs once); token pages are never saved; "No. n" label', async () => {
  const { db, signup, serialOf, founding } = await world();
  addUsers(db, 2);
  assert.equal(backfillFounding(db), 2);
  const ana = await signup('ana'); // #3 at sign-up
  assert.equal(serialOf(ana.id), 3);
  assert.match((await ana.c.get('/st-pete/passport')).body, /No\. 3 · /);
  assert.doesNotMatch((await ana.c.get('/st-pete/passport')).body, /Limited edition #3/);
  // An admin takes it back; a restart doesn't give it back.
  db.prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?').run(ana.id, founding);
  assert.equal(backfillFounding(db), 0);
  assert.equal(serialOf(ana.id), undefined);

  // Feedback from a page whose URL carries a token keeps no page.
  const ids = db.prepare('SELECT id FROM users ORDER BY id').pluck().all();
  const { sendFeedback } = await import('../../src/domain/feedback.js');
  for (const page of ['/pals/invite/abcDEF123_secret', '/join/tok', '/reset', '/auth/magic', '/account/delete/confirm']) {
    sendFeedback(db, ids[0], { text: 'x', page });
    assert.equal(db.prepare('SELECT page FROM feedback ORDER BY id DESC').pluck().get(), '', page);
  }
});

test('sign-up gives the next Early Bird number until all 100 are given; a gap left by an admin is filled', async () => {
  const { db, signup } = await world();
  const bird = db.prepare("SELECT id FROM badges WHERE slug = 'early-bird-100'").pluck().get();
  const birdOf = (id) => db.prepare('SELECT serial FROM user_badges WHERE user_id = ? AND badge_id = ?').pluck().get(id, bird);
  const ana = await signup('ana');
  assert.equal(birdOf(ana.id), 1);
  assert.match(db.prepare("SELECT text FROM notifications WHERE user_id = ? AND text LIKE '%Early Bird%'").pluck().get(ana.id), /Early Bird #1 of 100/);
  // An auto-given badge says nothing about who gave it.
  assert.equal(takeUnseenBadges(db, ana.id).find((b) => b.slug === 'early-bird-100').given_by, null);
  const ids = addUsers(db, 99);
  for (const id of ids) awardEarlyBird(db, id);
  assert.equal(birdOf(ids[98]), 100);
  const late = await signup('late');
  assert.equal(birdOf(late.id), undefined); // all 100 given
  assert.equal(awardEarlyBird(db, ana.id), null); // never twice
});

test('a given badge says it is from Parks Passport, or the name the admin typed, never the admin', async () => {
  const { db, signup } = await world();
  const admin = { id: (await signup('dzuy')).id, display_name: 'dzuy' };
  const ana = await signup('ana');
  takeUnseenBadges(db, ana.id); // clear the sign-up badges
  addMissingBadges(db, ['g1', 'g2', 'g3'].map((slug) => ({ slug, name: slug.toUpperCase(), art: '⭐', kind: 'hidden', rule_type: 'manual', rule_params: {} })));
  const [b1, b2, b3] = ['g1', 'g2', 'g3'].map((slug) => db.prepare('SELECT id FROM badges WHERE slug = ?').pluck().get(slug));
  assert.ok(grantBadge(db, { admin, userId: ana.id, badgeId: b1, note: 'Nice!' }).ok);
  assert.ok(grantBadge(db, { admin, userId: ana.id, badgeId: b2, fromName: '  The Parks  Crew ' }).ok);
  assert.equal(grantBadge(db, { admin, userId: ana.id, badgeId: b3, fromName: 'x'.repeat(41) }).error, 'from');
  const seen = takeUnseenBadges(db, ana.id);
  assert.deepEqual(seen.map((b) => b.given_by), ['Parks Passport', 'The Parks Crew']);
  const gifts = db.prepare("SELECT text FROM notifications WHERE user_id = ? AND kind = 'gift' AND text LIKE '%gave you%' ORDER BY id").pluck().all(ana.id);
  assert.match(gifts[0], /^Parks Passport gave you the .*: “Nice!”/);
  assert.match(gifts[1], /^The Parks Crew gave you/);
  assert.ok(gifts.every((t) => !t.includes('dzuy')));
});
