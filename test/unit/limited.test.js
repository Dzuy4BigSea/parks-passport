// M24: limited edition badges, numbered as they're given; Early Bird; giving from the members list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { seedBadgesIfEmpty, addMissingBadges, grantBadge, takeBackGrant } from '../../src/domain/badges/index.js';
import { validateBadgeForm } from '../../src/domain/admin.js';
import fs from 'node:fs';
import { SEED_LIMITED_BADGES_JSON, seedCities } from '../../src/db/seed.js';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// A form POST with repeated fields (several ticked members), using the client's cookies.
const postForm = async (app, c, url, pairs) => {
  await c.get('/admin/users');
  const csrf = [...c.jar].find(([k]) => k.endsWith('pp_csrf'))[1];
  return app.inject({ method: 'POST', url, payload: new URLSearchParams([['_csrf', csrf], ...pairs]).toString(),
    headers: { cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/x-www-form-urlencoded' } });
};

const PW = 'correct horse battery';

async function world(names = ['ana', 'ben', 'cat', 'boss']) {
  const made = makeApp({ now: testClock('2026-06-06T16:00:00Z') });
  const { db } = made;
  seedBadgesIfEmpty(db, [{ slug: 'first', name: 'First Stamp', kind: 'known', rule_type: 'parks_count', rule_params: { n: 1 } }]);
  addMissingBadges(db, [{ slug: 'trio', name: 'Trio', kind: 'hidden', hint: 'Three exist.', rule_type: 'manual', rule_params: {}, limited_count: 3 }]);
  const people = {};
  for (const name of names) {
    const c = client(made.app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.boss.id);
  const badge = (slug) => db.prepare('SELECT * FROM badges WHERE slug = ?').get(slug);
  const serial = (userId, slug) => db.prepare('SELECT serial FROM user_badges WHERE user_id = ? AND badge_id = ?').pluck().get(userId, badge(slug).id);
  return { ...made, people, badge, serial };
}

test('Early Bird Edition ships as a 100-copy limited edition that is only ever given', () => {
  const [eb] = readJson(SEED_LIMITED_BADGES_JSON);
  assert.equal(eb.slug, 'early-bird-100');
  assert.equal(eb.limited_count, 100);
  assert.equal(eb.rule_type, 'manual');
  const { db } = makeApp();
  seedCities(db);
  assert.equal(db.prepare("SELECT limited_count FROM badges WHERE slug = 'early-bird-100'").pluck().get(), 100);
});

test('copies are numbered 1..N, a taken-back number is given again, and none past N', async () => {
  const { db, people, badge, serial } = await world();
  const { ana, ben, cat, boss } = people;
  const admin = { id: boss.id, display_name: 'boss' };
  const id = badge('trio').id;
  assert.equal(grantBadge(db, { admin, userId: ana.id, badgeId: id }).serial, 1);
  assert.equal(grantBadge(db, { admin, userId: ben.id, badgeId: id }).serial, 2);
  assert.equal(grantBadge(db, { admin, userId: ana.id, badgeId: id }).error, 'already');
  assert.ok(takeBackGrant(db, ana.id, id));
  assert.equal(grantBadge(db, { admin, userId: cat.id, badgeId: id }).serial, 1);
  assert.equal(grantBadge(db, { admin, userId: boss.id, badgeId: id }).serial, 3);
  assert.equal(grantBadge(db, { admin, userId: ana.id, badgeId: id }).error, 'sold_out');
  assert.deepEqual([serial(cat.id, 'trio'), serial(ben.id, 'trio'), serial(boss.id, 'trio')], [1, 2, 3]);
  // Ordinary badges have no number.
  grantBadge(db, { admin, userId: ana.id, badgeId: badge('first').id });
  assert.equal(serial(ana.id, 'first'), null);

  // The member sees the number: on the next page (as a holographic announcement), in notifications and on the passport.
  const page = (await ben.c.get('/pals')).body;
  assert.match(page, /class="announce is-holo"/);
  assert.match(page, /Limited edition #2 of 3/);
  assert.match((await ben.c.get('/notifications')).body, /Parks Passport gave you the Trio badge, #2 of 3\./);
  const passport = (await ben.c.get('/st-pete/passport')).body;
  assert.match(passport, /class="badge earned is-holo"/);
  assert.match(passport, /Limited edition #2 of 3 · Earned/);
});

test('admins tick members in the list and give a badge to all of them, numbered by join date', async () => {
  const { app, people, badge, serial } = await world();
  const { ana, ben, cat, boss } = people;
  const list = (await boss.c.get('/admin/users')).body;
  assert.match(list, /Trio \(limited: 3 of 3 left\)/);
  assert.match(list, /aria-label="Give the badge to ana"/);
  assert.equal((await ana.c.post('/admin/users/give', { badge_id: String(badge('trio').id), user_id: String(ben.id) })).statusCode, 404); // members can't
  assert.equal((await boss.c.post('/admin/users/give', { badge_id: String(badge('trio').id) })).statusCode, 422); // nobody ticked

  // Ticked out of order: cat, ana. Numbered by who joined first (ana, then cat).
  const give = (ids) => postForm(app, boss.c, '/admin/users/give', [['badge_id', String(badge('trio').id)], ['note', 'Welcome!'], ...ids.map((id) => ['user_id', String(id)])]);
  const res = await give([cat.id, ana.id]);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/admin/users?done=gave&n=2&had=0&out=0#members');
  assert.deepEqual([serial(ana.id, 'trio'), serial(cat.id, 'trio')], [1, 2]);
  assert.match((await boss.c.get(res.headers.location)).body, /Gave the badge to 2 members\./);

  // Again with everyone: ana and cat already have it, ben gets #3, boss finds them all given.
  const again = await give([cat.id, ana.id, ben.id, boss.id]);
  assert.equal(again.headers.location, '/admin/users?done=gave&n=1&had=2&out=1#members');
  assert.equal(serial(ben.id, 'trio'), 3);
  assert.match((await boss.c.get(again.headers.location)).body, /Gave the badge to 1 member\. 2 already had it\. 1 didn(&#39;|&#x27;|')t get one: all the numbered copies are given\./);
});

test('the badge form: limited editions use the given-only rule and can\'t shrink below the copies given', async () => {
  const base = { name: 'X', slug: 'x', kind: 'known', enabled: '1' };
  assert.match(validateBadgeForm({ ...base, rule_type: 'parks_count', param_n: '1', limited_count: '10' }, { isNew: true }).errors.limited_count, /given by hand/);
  assert.match(validateBadgeForm({ ...base, rule_type: 'manual', limited_count: '0' }, { isNew: true }).errors.limited_count, /1 to 1000/);
  assert.equal(validateBadgeForm({ ...base, rule_type: 'manual', limited_count: '25' }, { isNew: true }).badge.limited_count, 25);
  assert.equal(validateBadgeForm({ ...base, rule_type: 'manual', limited_count: '' }, { isNew: true }).badge.limited_count, null);

  const { db, people, badge } = await world(['ana', 'ben', 'boss']);
  const admin = { id: people.boss.id, display_name: 'boss' };
  grantBadge(db, { admin, userId: people.ana.id, badgeId: badge('trio').id });
  grantBadge(db, { admin, userId: people.ben.id, badgeId: badge('trio').id });
  const edit = (limited) => people.boss.c.postMultipart(`/admin/badges/${badge('trio').id}`, {
    name: 'Trio', description: '', hint: 'Three exist.', art: '🏅', rule_type: 'manual', kind: 'hidden', enabled: '1', limited_count: limited,
  });
  const res = await edit('1');
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /Copy #2 is already given, so keep at least 2 copies\./);
  // The highest number held counts, not how many: take back #1, and #2 still needs 2.
  takeBackGrant(db, people.ana.id, badge('trio').id);
  assert.match((await edit('1')).body, /Copy #2 is already given/);
  // A given-only badge members already hold without a number can't become limited.
  db.prepare("UPDATE badges SET limited_count = NULL WHERE slug = 'trio'").run();
  db.prepare('UPDATE user_badges SET serial = NULL').run();
  const plain = await edit('5');
  assert.equal(plain.statusCode, 422);
  assert.match(plain.body, /1 member already has this badge without a number/);
  db.prepare("UPDATE badges SET limited_count = 3 WHERE slug = 'trio'").run();
  db.prepare('UPDATE user_badges SET serial = 2').run();
  grantBadge(db, { admin, userId: people.ana.id, badgeId: badge('trio').id });
  assert.equal((await edit('')).statusCode, 422);
  assert.equal((await edit('50')).statusCode, 303);
  assert.equal(badge('trio').limited_count, 50);
  assert.match((await people.boss.c.get('/admin/badges')).body, /Limited: 2 of 50 given/);
});
