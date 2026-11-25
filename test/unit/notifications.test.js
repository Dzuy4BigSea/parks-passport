// M21: an admin gives a member a badge (pops up next time, with a note) and the notification center.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { friendCodeFor } from '../../src/domain/pals.js';
import { notify, listNotifications } from '../../src/domain/notifications.js';
import { seedBadgesIfEmpty, awardBadges, revokeUnmetBadges } from '../../src/domain/badges/index.js';

const PW = 'correct horse battery';

async function world() {
  const made = makeApp({ now: testClock('2026-06-06T16:00:00Z') });
  const { db } = made;
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','), 'a-park,A Park,,,27.80,-82.70,,,,0'].join('\n'));
  seedBadgesIfEmpty(db, [
    { slug: 'first', name: 'First Stamp', kind: 'known', rule_type: 'parks_count', rule_params: { n: 1 } },
    { slug: 'founder', name: 'Founding Member', kind: 'hidden', hint: 'Given, not earned.', rule_type: 'manual', rule_params: {} },
  ]);
  const people = {};
  for (const name of ['ana', 'ben', 'boss']) {
    const c = client(made.app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.boss.id);
  const badge = (slug) => db.prepare('SELECT id FROM badges WHERE slug = ?').pluck().get(slug);
  const kinds = (id) => db.prepare('SELECT kind FROM notifications WHERE user_id = ? ORDER BY id').pluck().all(id);
  return { ...made, people, badge, kinds };
}

test('an admin gives a badge with a note: it pops up on the member\'s next page and in their notifications', async () => {
  const { app, db, people, badge, kinds } = await world();
  const { ana, boss } = people;
  assert.equal((await ana.c.get(`/admin/users/${ana.id}/badges`)).statusCode, 404); // members can't
  const form = await boss.c.get(`/admin/users/${ana.id}/badges`);
  assert.match(form.body, /Founding Member \(given only\)/);
  const give = await boss.c.post(`/admin/users/${ana.id}/badges`, { badge_id: String(badge('founder')), note: 'Thanks for testing the app!' });
  assert.equal(give.headers.location, `/admin/users/${ana.id}/badges?done=given`);
  assert.equal((await boss.c.post(`/admin/users/${ana.id}/badges`, { badge_id: String(badge('first')) }, { csrf: false })).statusCode, 403);
  assert.equal((await boss.c.post(`/admin/users/${ana.id}/badges/${badge('founder')}/delete`, {}, { csrf: false })).statusCode, 403);
  assert.equal((await boss.c.post(`/admin/users/${ana.id}/badges`, { badge_id: String(badge('founder')) })).statusCode, 422); // already has it
  assert.equal((await boss.c.post(`/admin/users/${ana.id}/badges`, { badge_id: String(badge('first')), note: 'x'.repeat(141) })).statusCode, 422);

  const page = (await ana.c.get('/pals')).body;
  assert.match(page, /New badge: Founding Member/);
  assert.match(page, /From boss: “Thanks for testing the app!”/);
  assert.match(page, /aria-label="Notifications, 1 unread"/);
  assert.equal((await app.inject({ method: 'HEAD', url: '/notifications', headers: { cookie: [...ana.c.jar].map(([k, v]) => `${k}=${v}`).join('; ') } })).statusCode, 200);
  assert.match((await ana.c.get('/pals')).body, /aria-label="Notifications, 1 unread"/); // HEAD doesn't mark read
  const list = (await ana.c.get('/notifications')).body;
  assert.match(list, /<span class="new-pill">New<\/span> <a href="\/passport#badges">boss gave you the Founding Member badge: “Thanks for testing the app!”<\/a>/);
  assert.match((await ana.c.get('/pals')).body, /aria-label="Notifications"/); // all read now
  assert.deepEqual(kinds(ana.id), ['gift']);

  // A given badge is never taken back by the rules (here: a rule-based badge given without a stamp).
  await boss.c.post(`/admin/users/${ana.id}/badges`, { badge_id: String(badge('first')) });
  revokeUnmetBadges(db, ana.id);
  assert.ok(db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?').get(ana.id, badge('first')));
  // The admin can take back what was given.
  await boss.c.post(`/admin/users/${ana.id}/badges/${badge('first')}/delete`);
  assert.ok(!db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?').get(ana.id, badge('first')));
  // If the admin deletes their account, the gift stays but no longer names them.
  await boss.c.post('/account/delete', { delete_password: PW });
  assert.deepEqual(kinds(ana.id), []);
  assert.equal(db.prepare('SELECT source_id FROM user_badges WHERE user_id = ? AND badge_id = ?').pluck().get(ana.id, badge('founder')), null);
});

test('badges earned and pal news reach the notification center; a manual badge is never earned by the rules', async () => {
  const { app, db, people, badge, kinds } = await world();
  const { ana, ben } = people;
  await ana.c.post('/st-pete/parks/a-park/stamp', {});
  assert.deepEqual(kinds(ana.id), ['badge']);
  assert.equal(awardBadges(db, ana.id, { type: 'visit', id: 1 }).length, 0);
  assert.ok(!db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?').get(ana.id, badge('founder')));

  // Ben asks Ana by friend code; Ana accepts. Both hear about it.
  const code = friendCodeFor(db, ana.id);
  await ben.c.post('/pals/code', { code });
  assert.ok(kinds(ana.id).includes('pal_request'));
  const rid = db.prepare('SELECT id FROM pal_requests').pluck().get();
  await ana.c.post(`/pals/requests/${rid}/accept`);
  assert.ok(kinds(ana.id).includes('pal_new') && kinds(ben.id).includes('pal_new'));
  assert.match((await ana.c.get('/notifications')).body, /You and ben are now Park Pals\./);

  // Only your own; signed out goes to log in; notifications naming a deleted member go with them.
  assert.doesNotMatch((await ben.c.get('/notifications')).body, /You earned First Stamp/);
  assert.equal((await client(app).get('/notifications')).statusCode, 302);
  await ben.c.post('/account/delete', { delete_password: PW });
  assert.ok(!kinds(ana.id).includes('pal_new') && !kinds(ana.id).includes('pal_request'));
  assert.ok(kinds(ana.id).includes('badge'));
});

test('the notification center keeps the latest 200 and pages them 30 at a time', async () => {
  const { db, people } = await world();
  const { ana } = people;
  for (let i = 1; i <= 205; i += 1) notify(db, ana.id, { kind: 'badge', text: `Note ${i}.`, link: '/passport' });
  assert.equal(db.prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ?').pluck().get(ana.id), 200);
  const first = listNotifications(db, ana.id, { page: 1 });
  assert.equal(first.items.length, 30);
  assert.equal(first.items[0].text, 'Note 205.');
  assert.ok(first.hasMore);
  const last = listNotifications(db, ana.id, { page: 7 });
  assert.equal(last.items.length, 20);
  assert.equal(last.items.at(-1).text, 'Note 6.');
  assert.ok(!last.hasMore);
  assert.match((await ana.c.get('/notifications?page=2')).body, /Note 175\./);
});
