import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RULES, RULE_TYPES } from '../../src/domain/badges/rules.js';
import { awardBadges, revokeUnmetBadges, badgeBoard, takeUnseenBadges, seedBadgesIfEmpty } from '../../src/domain/badges/index.js';
import { LEVELS, levelFor } from '../../src/domain/levels.js';
import { stampVisit, deleteVisit } from '../../src/domain/visits.js';
import { createUser } from '../../src/domain/users.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { openDb } from '../../src/db/index.js';
import { SEED_BADGES_JSON } from '../../src/db/seed.js';
import { makeApp, client, testClock } from './helpers.js';

// Fixture visits: v(park, 'YYYY-MM-DD', 'HH:MM' local EDT or null for backdated)
let seq = 0;
function v(park_id, visited_on, time = null) {
  const created = time ? new Date(`${visited_on}T${time}:00-04:00`).toISOString() : '2026-09-01T12:00:00.000Z';
  return { id: ++seq, park_id, visited_on, visited_at: time ? created : `${visited_on}T16:00:00.000Z`, created_at: created, method: 'honor' };
}
const ctx = (visits, extra = {}) => ({
  visits,
  parkCategories: new Map([[1, new Set(['dog-park', 'lake'])], [2, new Set(['dog-park'])], [3, new Set(['playground'])]]),
  activeParkIds: new Set([1, 2, 3]),
  palSameDay: false,
  trigger: null,
  random: () => 0.5,
  ...extra,
});
const run = (type, params, c) => RULES[type].evaluate(params, c);

test('every spec rule type exists', () => {
  assert.deepEqual(RULE_TYPES.sort(), ['all_parks', 'category_count', 'lucky', 'pal_same_day', 'parks_count',
    'same_park_count', 'time_of_day', 'weekend_parks', 'weekly_streak', 'cities_count', 'milestone', 'lucky_drop', 'manual', 'gps_checkins',
    // Healthy activities (docs/healthy-activities.md)
    'activity_count', 'activity_parks', 'activity_sum', 'weekly_sum', 'weekly_days', 'pillar_variety', 'activity_categories'].sort());
});

test('parks_count counts distinct parks with progress', () => {
  const c = ctx([v(1, '2026-06-01'), v(1, '2026-06-02'), v(2, '2026-06-03')]);
  assert.deepEqual(run('parks_count', { n: 3 }, c), { earned: false, progress: 2, target: 3, unit: 'parks' });
  assert.equal(run('parks_count', { n: 2 }, c).earned, true);
});

test('category_count counts distinct parks having the category', () => {
  const c = ctx([v(1, '2026-06-01'), v(1, '2026-06-08'), v(3, '2026-06-02')]);
  assert.equal(run('category_count', { category: 'dog-park', n: 2 }, c).progress, 1);
  c.visits.push(v(2, '2026-06-03'));
  assert.equal(run('category_count', { category: 'dog-park', n: 2 }, c).earned, true);
  assert.equal(run('category_count', { category: 'beach', n: 1 }, c).earned, false);
});

test('same_park_count uses the most-visited park', () => {
  const c = ctx([v(1, '2026-06-01'), v(1, '2026-06-02'), v(1, '2026-06-03'), v(2, '2026-06-04')]);
  assert.deepEqual(run('same_park_count', { n: 3 }, c), { earned: true, progress: 3, target: 3, unit: 'visits' });
  assert.equal(run('same_park_count', { n: 3 }, ctx([])).progress, 0);
});

test('time_of_day uses local time, supports windows past midnight, and ignores backdated stamps', () => {
  assert.equal(run('time_of_day', { start: '05:00', end: '07:30' }, ctx([v(1, '2026-06-01', '06:45')])).earned, true);
  assert.equal(run('time_of_day', { start: '05:00', end: '07:30' }, ctx([v(1, '2026-06-01', '07:30')])).earned, false);
  assert.equal(run('time_of_day', { start: '22:00', end: '02:00' }, ctx([v(1, '2026-06-01', '23:15')])).earned, true);
  assert.equal(run('time_of_day', { start: '22:00', end: '02:00' }, ctx([v(1, '2026-06-01', '01:15')])).earned, true);
  // Backdated stamps are stored at 16:00Z (noon EDT): must not count for 11:00–13:00.
  assert.equal(run('time_of_day', { start: '11:00', end: '13:00' }, ctx([v(1, '2026-05-01')])).earned, false);
});

test('weekend_parks counts distinct parks within one Saturday–Sunday', () => {
  // 2026-06-06 is a Saturday, 2026-06-07 Sunday, 2026-06-08 Monday.
  const c = ctx([v(1, '2026-06-06'), v(2, '2026-06-07'), v(3, '2026-06-08')]);
  assert.deepEqual(run('weekend_parks', { n: 3 }, c), { earned: false, progress: 2, target: 3, unit: 'parks in a weekend' });
  c.visits.push(v(3, '2026-06-07'));
  assert.equal(run('weekend_parks', { n: 3 }, c).earned, true);
  // Sunday + next Saturday are different weekends.
  assert.equal(run('weekend_parks', { n: 2 }, ctx([v(1, '2026-06-07'), v(2, '2026-06-13')])).progress, 1);
});

test('weekly_streak finds the longest run of consecutive Monday-start weeks', () => {
  const c = ctx([v(1, '2026-06-01'), v(1, '2026-06-14'), v(2, '2026-06-15'), v(3, '2026-06-27'), v(1, '2026-07-20')]);
  // Weeks of Jun 1, Jun 8 (Sun 14th), Jun 15, Jun 22 (Sat 27th) = 4 in a row; Jul 20 breaks.
  assert.deepEqual(run('weekly_streak', { n: 4 }, c), { earned: true, progress: 4, target: 4, unit: 'weeks' });
  assert.equal(run('weekly_streak', { n: 2 }, ctx([v(1, '2026-06-01'), v(1, '2026-06-15')])).progress, 1);
});

test('pal_same_day reads the context flag', () => {
  assert.equal(run('pal_same_day', {}, ctx([])).earned, false);
  assert.equal(run('pal_same_day', {}, ctx([], { palSameDay: true })).earned, true);
});

test('all_parks needs every active park', () => {
  assert.deepEqual(run('all_parks', {}, ctx([v(1, '2026-06-01'), v(2, '2026-06-01')])), { earned: false, progress: 2, target: 3, unit: 'parks' });
  assert.equal(run('all_parks', {}, ctx([v(1, '2026-06-01'), v(2, '2026-06-01'), v(3, '2026-06-01')])).earned, true);
  assert.equal(run('all_parks', {}, ctx([], { activeParkIds: new Set() })).earned, false);
});

test('lucky rolls only on a stamp, with the injected random source', () => {
  assert.equal(run('lucky', { probability: 0.05 }, ctx([], { trigger: { type: 'visit' }, random: () => 0.01 })).earned, true);
  assert.equal(run('lucky', { probability: 0.05 }, ctx([], { trigger: { type: 'visit' }, random: () => 0.06 })).earned, false);
  assert.equal(run('lucky', { probability: 1 }, ctx([], { trigger: { type: 'rating' }, random: () => 0 })).earned, false);
});

test('levels are derived from points with progress to the next', () => {
  assert.deepEqual(LEVELS.map((l) => l.min), [0, 50, 150, 400, 1000, 1600, 2500, 3800, 5600, 8000]);
  assert.equal(levelFor(0).name, 'Day Tripper');
  assert.equal(levelFor(49).name, 'Day Tripper');
  const tf = levelFor(100);
  assert.deepEqual({ name: tf.name, toNext: tf.toNext, progress: tf.progress }, { name: 'Trail Finder', toNext: 50, progress: 0.5 });
  assert.equal(levelFor(1200).name, 'Park Legend');
  const top = levelFor(20000);
  assert.deepEqual({ name: top.name, next: top.next, progress: top.progress }, { name: 'Grand Ranger', next: null, progress: 1 });
});

test('seed badges: at least 6 known, 3 hidden, 1 lucky and 1 social, all with valid rule types', () => {
  const list = JSON.parse(fs.readFileSync(SEED_BADGES_JSON, 'utf8'));
  const by = (k) => list.filter((b) => b.kind === k).length;
  assert.ok(by('known') >= 6);
  assert.ok(by('hidden') >= 3);
  assert.ok(by('lucky') >= 1);
  assert.ok(list.some((b) => b.rule_type === 'pal_same_day'));
  for (const b of list) assert.ok(RULES[b.rule_type], b.slug);
  for (const b of list.filter((x) => x.kind !== 'known')) assert.ok(b.hint, `${b.slug} needs a hint`);
  assert.equal(new Set(list.map((b) => b.slug)).size, list.length);
});

// DB-level: awarding once, revoking, lucky kept.
async function dbSetup() {
  const db = openDb(':memory:');
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','),
    'a-park,A Park,,,27.80,-82.70,,dog-park,,0',
    'b-park,B Park,,,27.81,-82.71,,dog-park,,0'].join('\n'));
  seedBadgesIfEmpty(db, [
    { slug: 'one', name: 'One', kind: 'known', rule_type: 'parks_count', rule_params: { n: 1 } },
    { slug: 'two-dogs', name: 'Two Dogs', kind: 'hidden', hint: 'h', rule_type: 'category_count', rule_params: { category: 'dog-park', n: 2 } },
    { slug: 'luck', name: 'Luck', kind: 'lucky', hint: 'h', rule_type: 'lucky', rule_params: { probability: 0.5 } },
  ]);
  const { user } = await createUser(db, { display_name: 'Sam', email: 's@example.com', password: 'correct horse battery' });
  const parks = db.prepare('SELECT * FROM parks ORDER BY slug').all();
  return { db, user, parks };
}

test('badges are awarded once, revoked when unmet (except lucky), and announced once', async () => {
  const { db, user, parks } = await dbSetup();
  const now = new Date('2026-06-01T16:00:00Z');
  const v1 = stampVisit(db, { user, park: parks[0], method: 'honor' }, { now }).visit;
  let got = awardBadges(db, user.id, { type: 'visit', id: v1.id }, { now, random: () => 0.1 });
  assert.deepEqual(got.map((b) => b.slug), ['one', 'luck']);
  assert.deepEqual(awardBadges(db, user.id, { type: 'visit', id: v1.id }, { now, random: () => 0.1 }), []);

  const v2 = stampVisit(db, { user, park: parks[1], method: 'honor' }, { now }).visit;
  got = awardBadges(db, user.id, { type: 'visit', id: v2.id }, { now, random: () => 0.9 });
  assert.deepEqual(got.map((b) => b.slug), ['two-dogs']);

  assert.deepEqual(takeUnseenBadges(db, user.id, { now }).map((b) => b.slug).sort(), ['luck', 'one', 'two-dogs']);
  assert.deepEqual(takeUnseenBadges(db, user.id, { now }), []);

  deleteVisit(db, { user, visitId: v2.id }, { now });
  assert.deepEqual(revokeUnmetBadges(db, user.id).map((b) => b.slug), ['two-dogs']);
  deleteVisit(db, { user, visitId: v1.id }, { now });
  assert.deepEqual(revokeUnmetBadges(db, user.id).map((b) => b.slug), ['one']);
  const left = db.prepare('SELECT b.slug FROM user_badges ub JOIN badges b ON b.id = ub.badge_id').pluck().all();
  assert.deepEqual(left, ['luck']);
});

test('badge board: earned, known with progress, hidden and lucky without criteria', async () => {
  const { db, user, parks } = await dbSetup();
  const now = new Date('2026-06-01T16:00:00Z');
  const vis = stampVisit(db, { user, park: parks[0], method: 'honor' }, { now }).visit;
  awardBadges(db, user.id, { type: 'visit', id: vis.id }, { now, random: () => 0.9 });
  const board = Object.fromEntries(badgeBoard(db, user.id).map((b) => [b.slug, b]));
  assert.equal(board.one.state, 'earned');
  assert.equal(board['two-dogs'].state, 'hidden');
  assert.equal(board.luck.state, 'lucky');
  db.prepare("UPDATE badges SET kind = 'known' WHERE slug = 'two-dogs'").run();
  const known = badgeBoard(db, user.id).find((b) => b.slug === 'two-dogs');
  assert.deepEqual({ state: known.state, progress: known.progress, target: known.target }, { state: 'known', progress: 1, target: 2 });
});

test('a stamp announces new badges and a level-up once, on the next page', async () => {
  const now = testClock('2026-06-01T16:00:00Z');
  const { app, db } = makeApp({ now, random: () => 0.99 });
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','), 'a-park,A Park,,,27.80,-82.70,,,,0'].join('\n'));
  seedBadgesIfEmpty(db, [{ slug: 'one', name: 'First Stamp', art: '🌱', kind: 'known', rule_type: 'parks_count', rule_params: { n: 1 } }]);
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: 'correct horse battery' });
  // 60 points for the level-up: pretend earlier activity.
  const uid = db.prepare('SELECT id FROM users').pluck().get();
  db.prepare("INSERT INTO point_events (user_id, source_type, source_id, points, reason, created_at) VALUES (?, 'test', 0, 45, 'test', ?)").run(uid, now().toISOString());
  const res = await c.post('/st-pete/parks/a-park/stamp', {});
  const page = await c.get(res.headers.location);
  assert.match(page.body, /role="status"[\s\S]*New badge: First Stamp/);
  assert.match(page.body, /Level up! You're now a Trail Finder\./);
  const again = await c.get(res.headers.location);
  assert.ok(!again.body.includes('New badge:'));
  assert.ok(!again.body.includes('Level up!'));
});

test('badge earned dates use the St. Pete date, not UTC', async () => {
  const { passportPage } = await import('../../src/views/pages/passport.js');
  const view = passportPage({
    user: { display_name: 'Sam' }, csrf: 'x', parks: [], history: [], points: 10, level: levelFor(10),
    badges: [{ state: 'earned', art: '🌱', name: 'First Stamp', description: '', awarded_at: '2026-06-02T03:30:00.000Z' }],
  });
  assert.match(String(view.body), /Earned June 1, 2026/);
});

test('deactivating a park never takes badges away; only all_parks uses active parks', async () => {
  const { db, user, parks } = await dbSetup();
  const now = new Date('2026-06-01T16:00:00Z');
  const a = stampVisit(db, { user, park: parks[0], method: 'honor' }, { now }).visit;
  const b = stampVisit(db, { user, park: parks[1], method: 'honor' }, { now }).visit;
  awardBadges(db, user.id, { type: 'visit', id: b.id }, { now, random: () => 0.9 });
  assert.equal(db.prepare('SELECT COUNT(*) FROM user_badges').pluck().get(), 2); // one, two-dogs
  db.prepare('UPDATE parks SET active = 0 WHERE id = ?').run(parks[0].id);
  deleteVisit(db, { user, visitId: b.id }, { now });
  // two-dogs is now unmet (only park 0 has a dog park visit) and is revoked; "one" is still met
  // by the visit to the deactivated park.
  assert.deepEqual(revokeUnmetBadges(db, user.id).map((x) => x.slug), ['two-dogs']);
  assert.ok(a);
  const ctx = (await import('../../src/domain/badges/index.js')).buildContext(db, user.id);
  assert.equal(RULES.all_parks.evaluate({}, ctx).target, 1);
});
