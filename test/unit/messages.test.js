// M30: messages from the team (SPEC Flow 20).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { seedCities } from '../../src/db/seed.js';
import { addMissingBadges } from '../../src/domain/badges/index.js';
import { zonedToUtc, utcToZoned, validateMessage, reachCount, messageById, takeMessages } from '../../src/domain/messages.js';

const PW = 'correct horse battery';

async function world() {
  const made = makeApp({ now: testClock('2026-11-20T15:00:00Z') });
  const { db, app } = made;
  seedCities(db);
  addMissingBadges(db, [{ slug: 'thanks-2026', name: 'Early Adopter', art: '🌱', kind: 'hidden', rule_type: 'manual', rule_params: {} }]);
  const people = {};
  for (const name of ['boss', 'ana', 'ben']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.boss.id);
  const badgeId = (slug) => db.prepare('SELECT id FROM badges WHERE slug = ?').pluck().get(slug);
  return { ...made, people, badgeId };
}

// Composes and publishes a message as the admin; returns its id.
async function send({ people }, fields) {
  const { boss } = people;
  const res = await boss.c.post('/admin/messages', { title: 'Thank you!', body: 'Hi there', effect: 'celebrate', audience: 'everyone', existing_only: '1', ...fields });
  assert.equal(res.statusCode, 303, res.body);
  const id = Number(res.headers.location.split('/').pop());
  const pub = await boss.c.post(`/admin/messages/${id}/publish`, { confirm: '1' });
  assert.equal(pub.headers.location, `/admin/messages/${id}?done=published`);
  return id;
}

test('time zones: the form\'s local date-times round-trip through UTC, across DST', () => {
  assert.equal(zonedToUtc('2026-11-26T09:00', 'America/New_York'), '2026-11-26T14:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-04T09:00', 'America/Los_Angeles'), '2026-07-04T16:00:00.000Z');
  assert.equal(utcToZoned('2026-11-26T14:00:00.000Z', 'America/New_York'), '2026-11-26T09:00');
  assert.equal(zonedToUtc('2026-02-30T09:00', 'America/New_York'), null);
  assert.equal(zonedToUtc('soon', 'America/New_York'), null);
});

test('Admin › Messages is for admins only: members and visitors get 404', async () => {
  const { app, people } = await world();
  assert.equal((await people.ana.c.get('/admin/messages')).statusCode, 404);
  assert.equal((await people.ana.c.post('/admin/messages', { title: 'x' })).statusCode, 404);
  assert.equal((await client(app).get('/admin/messages/new')).statusCode, 404);
  const page = await people.boss.c.get('/admin/messages/new');
  assert.equal(page.statusCode, 200);
  for (const label of ['Celebration', 'Thank you', 'Autumn', 'Winter', 'Giveaway', 'Heads-up']) assert.match(page.body, new RegExp(label));
  assert.match(page.body, /data-play-effect="gift"/);
});

test('the compose form checks its fields and keeps what was typed', async () => {
  const { db, people } = await world();
  const bad = await people.boss.c.post('/admin/messages', { title: '', body: 'x'.repeat(501), audience: 'city', city: 'atlantis', starts_at: '2026-11-27T10:00', ends_at: '2026-11-26T10:00' });
  assert.equal(bad.statusCode, 422);
  for (const msg of ['Give it a title.', 'Keep the message to 500 characters.', 'Choose a city.', 'End it after it starts.']) assert.ok(bad.body.includes(msg), msg);
  assert.equal(db.prepare('SELECT COUNT(*) FROM team_messages').pluck().get(), 0);
  const picked = validateMessage(db, { title: 'Hi', audience: 'picked' }, { timeZone: 'America/New_York' });
  assert.ok(picked.errors.audience);
});

test('a published message opens once on each member\'s next page, with its effect, and lands in notifications', async () => {
  const w = await world();
  const { db, people } = w;
  const id = await send(w, { title: 'Happy Thanksgiving!', body: 'Grateful for you.\n\nGo for a walk!', effect: 'autumn' });
  const first = await people.ana.c.get('/st-pete/parks');
  assert.match(first.body, /<section class="team-messages" data-messages/);
  assert.match(first.body, /data-effect="autumn"/);
  assert.match(first.body, /Happy Thanksgiving!/);
  assert.match(first.body, /<p>Grateful for you\.<\/p><p>Go for a walk!<\/p>/);
  assert.match(first.body, /\/js\/message\.js/);
  assert.doesNotMatch((await people.ana.c.get('/st-pete/parks')).body, /data-messages/); // once
  assert.match((await people.ana.c.get('/notifications')).body, /💌[\s\S]*Happy Thanksgiving!/);
  // Admin pages don't use it up; the admin sees it on a member page.
  assert.doesNotMatch((await people.boss.c.get('/admin')).body, /data-messages/);
  assert.match((await people.boss.c.get('/st-pete/parks')).body, /data-messages/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM team_message_views WHERE message_id = ?').pluck().get(id), 2);
  // Visitors never see it.
  assert.doesNotMatch((await client(w.app).get('/st-pete/parks')).body, /data-messages/);
});

test('badges come with the message: given once, as a gift (the path the rules never take back), announced after it', async () => {
  const w = await world();
  const { db, people, badgeId } = w;
  const eb = badgeId('thanks-2026');
  await send(w, { title: 'Thank you for being an early adopter', badge_ids: String(eb) });
  const page = (await people.ana.c.get('/st-pete/parks')).body;
  assert.match(page, /team-message-badges[\s\S]*Early Adopter/);
  assert.match(page, /data-kind="gift"[\s\S]*New badge: Early Adopter/);
  assert.match(page, /From boss: “Thank you for being an early adopter”/);
  const row = db.prepare('SELECT source_type, note FROM user_badges WHERE user_id = ? AND badge_id = ?').get(people.ana.id, eb);
  assert.deepEqual({ ...row }, { source_type: 'grant', note: 'Thank you for being an early adopter' });
  // Someone who already has it isn't given it twice.
  db.prepare("INSERT INTO user_badges (user_id, badge_id, awarded_at, source_type, seen_at) VALUES (?, ?, ?, 'grant', ?)").run(people.ben.id, eb, 'x', 'x');
  const benPage = (await people.ben.c.get('/st-pete/parks')).body;
  assert.match(benPage, /data-messages/);
  assert.doesNotMatch(benPage, /team-message-badges/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM user_badges WHERE user_id = ? AND badge_id = ?').pluck().get(people.ben.id, eb), 1);
});

test('audiences: one city, a badge\'s holders, picked members, and "joined before it went live"', async () => {
  const w = await world();
  const { db, app, people, badgeId, now } = w;
  const park = db.prepare("SELECT p.id FROM parks p JOIN city_themes c ON c.id = p.city_id WHERE c.key = 'bend' LIMIT 1").pluck().get();
  db.prepare("INSERT INTO visits (user_id, park_id, visited_on, visited_at, method, created_at) VALUES (?, ?, '2026-11-01', 'x', 'honor', 'x')").run(people.ana.id, park);
  const cityMsg = await send(w, { title: 'Bend cleanup day', audience: 'city', city: 'bend', existing_only: '0' });
  assert.equal(reachCount(db, messageById(db, cityMsg)), 1);

  db.prepare("INSERT INTO user_badges (user_id, badge_id, awarded_at, source_type, seen_at) VALUES (?, ?, 'x', 'grant', 'x')").run(people.ben.id, badgeId('early-bird-100'));
  await send(w, { title: 'For our early birds', audience: 'badge', badge: 'early-bird-100' });

  // Picked: from Admin › Members' ticks.
  const compose = await people.boss.c.post('/admin/messages/compose', { user_id: String(people.ben.id) });
  assert.match(compose.body, /Picked members: ben/);
  await send(w, { title: 'Just for Ben', audience: 'picked', user_ids: String(people.ben.id) });

  const anaPage = (await people.ana.c.get('/st-pete/parks')).body;
  const benPage = (await people.ben.c.get('/st-pete/parks')).body;
  assert.match(anaPage, /Bend cleanup day/);
  assert.doesNotMatch(anaPage, /For our early birds|Just for Ben/);
  assert.match(benPage, /For our early birds/);
  assert.match(benPage, /Just for Ben/);
  assert.doesNotMatch(benPage, /Bend cleanup day/);

  // Joined later: not reached by an "existing members" message, reached by one without it.
  await send(w, { title: 'Early adopters only' });
  await send(w, { title: 'For everyone, always', existing_only: '0' });
  now.advanceMinutes(5);
  const late = client(app);
  await late.post('/signup', { display_name: 'Late', email: 'late@example.com', password: PW });
  const latePage = (await late.get('/st-pete/parks')).body;
  assert.doesNotMatch(latePage, /Early adopters only/);
  assert.match(latePage, /For everyone, always/);
});

test('a window: nothing before it starts or after it ends; ended and draft messages never show', async () => {
  const w = await world();
  const { people, now } = w;
  // 2026-11-20 15:00 UTC is 10:00 in St. Pete. Window: Nov 26 9:00 to Nov 27 9:00 local.
  await send(w, { title: 'Thanksgiving freebie', effect: 'gift', starts_at: '2026-11-26T09:00', ends_at: '2026-11-27T09:00' });
  assert.match((await people.boss.c.get('/admin/messages')).body, /Scheduled/);
  assert.doesNotMatch((await people.ana.c.get('/st-pete/parks')).body, /Thanksgiving freebie/);
  now.advanceMinutes(60 * 24 * 6); // Nov 26 15:00 UTC
  assert.match((await people.ana.c.get('/st-pete/parks')).body, /Thanksgiving freebie/);
  now.advanceMinutes(60 * 24); // Nov 27 15:00 UTC: past the end
  assert.doesNotMatch((await people.ben.c.get('/st-pete/parks')).body, /Thanksgiving freebie/);

  const draft = await people.boss.c.post('/admin/messages', { title: 'Not yet', audience: 'everyone' });
  const draftId = draft.headers.location.split('/').pop();
  const ended = await send(w, { title: 'Too late' });
  await people.boss.c.post(`/admin/messages/${ended}/end`, {});
  const page = (await people.ben.c.get('/st-pete/parks')).body;
  assert.doesNotMatch(page, /Not yet|Too late/);
  // A live message can't be edited; a draft can.
  assert.equal((await people.boss.c.get(`/admin/messages/${ended}/edit`)).statusCode, 404);
  assert.equal((await people.boss.c.get(`/admin/messages/${draftId}/edit`)).statusCode, 200);
});

test('the review page shows the reach, and publishing needs the confirm field', async () => {
  const w = await world();
  const { db, people } = w;
  const res = await people.boss.c.post('/admin/messages', { title: 'Hello', audience: 'everyone', existing_only: '1' });
  const id = res.headers.location.split('/').pop();
  const review = await people.boss.c.get(`/admin/messages/${id}`);
  assert.match(review.body, /Publish to 3 members/);
  await people.boss.c.post(`/admin/messages/${id}/publish`, {});
  assert.equal(db.prepare('SELECT status FROM team_messages WHERE id = ?').pluck().get(id), 'draft');
  await people.boss.c.post(`/admin/messages/${id}/publish`, { confirm: '1' });
  assert.equal(db.prepare('SELECT status FROM team_messages WHERE id = ?').pluck().get(id), 'live');
  assert.deepEqual(takeMessages(db, { id: 999999 }), []);
});
