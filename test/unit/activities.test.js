import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeApp, client, testClock } from './helpers.js';
import { openDb } from '../../src/db/index.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { stampVisit, deleteVisit } from '../../src/domain/visits.js';
import { totalPoints } from '../../src/domain/points.js';
import { createUser } from '../../src/domain/users.js';
import { RULES, matchesTarget } from '../../src/domain/badges/rules.js';
import { awardBadges, badgeBoard, seedBadgesIfEmpty, addMissingBadges } from '../../src/domain/badges/index.js';
import { CATEGORIES } from '../../src/domain/categories.js';
import {
  PILLARS, MEASURES, LIMITS, seedActivities, activitiesForPark, logActivity, deleteActivityLog, weekSummary, parseAmount,
  setActivityActive,
} from '../../src/domain/activities.js';
import { seedActivityData, SEED_ACTIVITIES_JSON, SEED_ACTIVITY_BADGES_JSON, SEED_BADGES_JSON } from '../../src/db/seed.js';
import { getParkBySlug } from '../../src/domain/parks.js';

const ACTIVITIES = JSON.parse(fs.readFileSync(SEED_ACTIVITIES_JSON, 'utf8'));
const ACTIVITY_BADGES = JSON.parse(fs.readFileSync(SEED_ACTIVITY_BADGES_JSON, 'utf8'));

// ---------- Seed files ----------

test('seed activities are well formed', () => {
  const slugs = new Set();
  for (const a of ACTIVITIES) {
    assert.ok(!slugs.has(a.slug), `duplicate ${a.slug}`);
    slugs.add(a.slug);
    assert.match(a.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(Object.hasOwn(PILLARS, a.pillar), `${a.slug} pillar`);
    assert.ok(MEASURES.includes(a.measure), `${a.slug} measure`);
    assert.ok(['core', 'paws', 'kids', undefined].includes(a.edition), `${a.slug} edition`);
    assert.ok(!a.category || Object.hasOwn(CATEGORIES, a.category), `${a.slug} category ${a.category}`);
    assert.ok(Number.isInteger(a.points) && a.points >= 1 && a.points < 10, `${a.slug} points stay below a stamp's 10`);
    assert.ok(a.description.length > 0 && a.description.length <= 200, `${a.slug} description`);
  }
  // Every pillar and both editions have something to do at any park.
  for (const p of Object.keys(PILLARS)) assert.ok(ACTIVITIES.some((a) => a.pillar === p && !a.category && !a.edition), p);
  for (const e of ['paws', 'kids']) assert.ok(ACTIVITIES.some((a) => a.edition === e && !a.category), e);
});

test('seed activity badges use real rule types and real targets', () => {
  const slugs = new Set(ACTIVITIES.map((a) => a.slug));
  const existing = new Set(JSON.parse(fs.readFileSync(SEED_BADGES_JSON, 'utf8')).map((b) => b.slug));
  for (const b of ACTIVITY_BADGES) {
    assert.ok(RULES[b.rule_type], `${b.slug} rule ${b.rule_type}`);
    assert.ok(!existing.has(b.slug), `${b.slug} clashes with seed/badges.json`);
    const target = b.rule_params.target;
    if (target && target !== 'any') {
      const [kind, value] = target.split(':');
      if (kind === 'activity') assert.ok(slugs.has(value), `${b.slug} target ${target}`);
      else if (kind === 'pillar') assert.ok(PILLARS[value], `${b.slug} target ${target}`);
      else assert.ok(kind === 'edition' && ['paws', 'kids'].includes(value), `${b.slug} target ${target}`);
    }
  }
});

test('seeding activities adds new ones and rewords old ones, but keeps the admin on/off switch', () => {
  const db = openDb(':memory:');
  seedActivities(db, [{ slug: 'a', name: 'A', pillar: 'move', measure: 'check', points: 1 }]);
  const id = db.prepare("SELECT id FROM activities WHERE slug = 'a'").pluck().get();
  setActivityActive(db, id, false);
  seedActivities(db, [{ slug: 'a', name: 'A2', pillar: 'calm', measure: 'check', points: 2 }, { slug: 'b', name: 'B', pillar: 'give', measure: 'check', points: 1 }]);
  const a = db.prepare("SELECT * FROM activities WHERE slug = 'a'").get();
  assert.equal(a.name, 'A2');
  assert.equal(a.pillar, 'calm');
  assert.equal(a.active, 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM activities').pluck().get(), 2);
});

test('activity badges reach a database seeded before they existed, once', () => {
  const db = openDb(':memory:');
  seedBadgesIfEmpty(db, JSON.parse(fs.readFileSync(SEED_BADGES_JSON, 'utf8')));
  const before = db.prepare('SELECT COUNT(*) FROM badges').pluck().get();
  assert.equal(seedActivityData(db), ACTIVITY_BADGES.length);
  assert.equal(seedActivityData(db), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM badges').pluck().get(), before + ACTIVITY_BADGES.length);
  assert.equal(addMissingBadges(db, [{ slug: 'first-stamp', name: 'Dup', kind: 'known', rule_type: 'parks_count' }]), 0);
});

// ---------- Rules ----------

let lid = 0;
const log = (logged_on, extra = {}) => ({
  id: ++lid, slug: 'park-walk', pillar: 'move', edition: 'core', category: null, park_id: 1, logged_on, minutes: 20, miles: 0, ...extra,
});
const ctx = (activityLogs) => ({ visits: [], parkCategories: new Map(), activeParkIds: new Set(), activityLogs, trigger: null, random: () => 0.5 });
const run = (type, params, logs) => RULES[type].evaluate(params, ctx(logs));

test('targets match any, a pillar, an edition or one activity', () => {
  const l = log('2026-06-01', { slug: 'sniffari', pillar: 'calm', edition: 'paws' });
  assert.ok(matchesTarget('any', l));
  assert.ok(matchesTarget('pillar:calm', l));
  assert.ok(!matchesTarget('pillar:move', l));
  assert.ok(matchesTarget('edition:paws', l));
  assert.ok(matchesTarget('activity:sniffari', l));
  assert.ok(!matchesTarget('activity:pet-walk', l));
  assert.ok(!matchesTarget('bogus', l));
});

test('activity_count and activity_parks', () => {
  const logs = [log('2026-06-01'), log('2026-06-02', { park_id: 2 }), log('2026-06-03', { slug: 'breathe', pillar: 'calm' })];
  assert.deepEqual(run('activity_count', { target: 'pillar:move', n: 3 }, logs), { earned: false, progress: 2, target: 3, unit: 'activities' });
  assert.equal(run('activity_count', { target: 'any', n: 3 }, logs).earned, true);
  assert.equal(run('activity_parks', { target: 'activity:park-walk', n: 2 }, logs).earned, true);
  assert.equal(run('activity_parks', { target: 'pillar:calm', n: 2 }, logs).progress, 1);
});

test('activity_sum: 10 miles within 10 days, and all-time totals', () => {
  const mi = (d, miles) => log(d, { slug: 'walk-a-mile', miles });
  const spread = [mi('2026-06-01', 3), mi('2026-06-05', 3), mi('2026-06-12', 4)]; // 1st to 12th is 12 days
  assert.deepEqual(run('activity_sum', { target: 'any', metric: 'miles', total: 10, window_days: 10 }, spread),
    { earned: false, progress: 7, target: 10, unit: 'miles' });
  assert.equal(run('activity_sum', { target: 'any', metric: 'miles', total: 10, window_days: 12 }, spread).earned, true);
  assert.equal(run('activity_sum', { target: 'any', metric: 'miles', total: 10, window_days: 0 }, spread).earned, true);
  assert.equal(run('activity_sum', { target: 'any', metric: 'miles', total: 26.2, window_days: 0 }, spread).progress, 10);
});

test('weekly_sum: best week for a one-week goal; runs of weeks allow one missed week', () => {
  // 2026-06-01 is a Monday.
  const week = (monday, minutes) => log(monday, { minutes });
  assert.deepEqual(run('weekly_sum', { target: 'pillar:move', metric: 'minutes', total: 150, n: 1 }, [week('2026-06-01', 90), week('2026-06-03', 30)]),
    { earned: false, progress: 120, target: 150, unit: 'minutes in a week' });
  const weeks = [week('2026-06-01', 150), week('2026-06-08', 150), /* missed 15th */ week('2026-06-22', 150), week('2026-06-29', 150)];
  assert.deepEqual(run('weekly_sum', { target: 'any', metric: 'minutes', total: 120, n: 4 }, weeks), { earned: true, progress: 4, target: 4, unit: 'weeks' });
  // A second miss breaks the run.
  const twoMisses = [week('2026-06-01', 150), week('2026-06-15', 150), week('2026-06-29', 150)];
  assert.equal(run('weekly_sum', { target: 'any', metric: 'minutes', total: 120, n: 3 }, twoMisses).progress, 2);
  // The allowance moves with the run: weeks 2, 3, 5, 6 count even after an earlier miss at week 1.
  const w = (n) => week(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'][n], 150);
  assert.equal(run('weekly_sum', { target: 'any', metric: 'minutes', total: 120, n: 4 }, [0, 2, 3, 5, 6].map(w)).earned, true);
  assert.equal(run('weekly_sum', { target: 'any', metric: 'minutes', total: 120, n: 9 }, [0, 2, 3, 4, 6, 7, 8].map(w)).progress, 6);
  // Two missed weeks in a row also break it.
  assert.equal(run('weekly_sum', { target: 'any', metric: 'minutes', total: 120, n: 2 }, [week('2026-06-01', 150), week('2026-06-22', 150)]).progress, 1);
});

test('weekly_days counts distinct days per week', () => {
  const b = (d) => log(d, { slug: 'bench-five' });
  const logs = [b('2026-06-01'), b('2026-06-03'), b('2026-06-08'), b('2026-06-08'), b('2026-06-10'), b('2026-06-15')];
  assert.equal(run('weekly_days', { target: 'activity:bench-five', per_week: 2, n: 4 }, logs).progress, 2);
  logs.push(b('2026-06-17'));
  assert.equal(run('weekly_days', { target: 'activity:bench-five', per_week: 2, n: 3 }, logs).earned, true);
});

test('pillar_variety within a window, and activity_categories', () => {
  const logs = ['move', 'nature', 'calm', 'connect'].map((p, i) => log(`2026-06-0${i + 1}`, { pillar: p }));
  logs.push(log('2026-06-09', { pillar: 'give' }));
  assert.equal(run('pillar_variety', { n: 5, window_days: 7 }, logs).progress, 4);
  assert.equal(run('pillar_variety', { n: 5, window_days: 9 }, logs).earned, true);
  const cats = [log('2026-06-01', { category: 'trails' }), log('2026-06-02', { category: 'trails' }), log('2026-06-02', { category: 'pool' })];
  assert.equal(run('activity_categories', { n: 2 }, cats).earned, true);
  assert.equal(run('activity_categories', { n: 3 }, cats).progress, 2);
});

// ---------- Logging ----------

function setup(start = '2026-06-01T16:00:00Z') {
  const now = testClock(start);
  const { app, db } = makeApp({ now });
  importParksCsv(db, [
    PARK_CSV_COLUMNS.join(','),
    'trail-park,Trail Park,,,27.8065,-82.75531,,trails|dog-park,,0',
    'plain-park,Plain Park,,,27.80,-82.70,,,,0',
  ].join('\n'));
  seedActivityData(db);
  return { app, db, now, trail: getParkBySlug(db, 'trail-park'), plain: getParkBySlug(db, 'plain-park') };
}
const newUser = async (db, email = 'sam@example.com') =>
  (await createUser(db, { display_name: 'Sam', email, password: 'correct horse battery' })).user;

test('amounts are parsed per measure, within the caps', () => {
  assert.equal(parseAmount('check', 'anything'), 1);
  assert.equal(parseAmount('minutes', '20'), 20);
  assert.equal(parseAmount('minutes', '20.5'), null);
  assert.equal(parseAmount('minutes', String(LIMITS.minutesPerLog + 1)), null);
  assert.equal(parseAmount('miles', '1.26'), 1.3);
  assert.equal(parseAmount('miles', '0.01'), null);
  assert.equal(parseAmount('miles', '16'), null);
  assert.equal(parseAmount('count', '0'), null);
  assert.equal(parseAmount('count', ''), null);
});

test('the list follows the park facilities and the member editions', async () => {
  const { db, trail, plain } = setup();
  const user = await newUser(db);
  const slugs = (park, u) => activitiesForPark(db, u, park).map((a) => a.slug);
  assert.ok(slugs(trail, user).includes('trail-time'));
  assert.ok(!slugs(plain, user).includes('trail-time'));
  assert.ok(!slugs(trail, user).includes('pet-walk'));
  assert.ok(!slugs(trail, user).includes('off-leash-play'));
  const pawsUser = { ...user, paws: 1 };
  assert.ok(slugs(trail, pawsUser).includes('pet-walk'));
  assert.ok(slugs(trail, pawsUser).includes('off-leash-play'));
  assert.ok(!slugs(trail, pawsUser).includes('nature-bingo'));
  assert.ok(slugs(trail, { ...user, kids: 1 }).includes('helmet-ride'));
});

test('logging needs a stamp at that park today, and earns points once per activity per visit', async () => {
  const { db, now, trail, plain } = setup();
  const user = await newUser(db);
  assert.equal(logActivity(db, { user, park: trail, slug: 'brisk-ten' }, { now: now() }).error, 'not_stamped');
  // A backdated stamp doesn't unlock today's activities.
  stampVisit(db, { user, park: trail, method: 'honor', visitedOn: '2026-05-30' }, { now: now() });
  assert.equal(logActivity(db, { user, park: trail, slug: 'brisk-ten' }, { now: now() }).error, 'not_stamped');
  stampVisit(db, { user, park: trail, method: 'honor' }, { now: now() });
  const before = totalPoints(db, user.id);
  const ok = logActivity(db, { user, park: trail, slug: 'brisk-ten' }, { now: now() });
  assert.equal(ok.log.minutes, 10);
  assert.equal(totalPoints(db, user.id), before + 2);
  assert.equal(logActivity(db, { user, park: trail, slug: 'brisk-ten' }, { now: now() }).error, 'duplicate');
  assert.equal(logActivity(db, { user, park: trail, slug: 'pet-walk', amount: '20' }, { now: now() }).error, 'unknown');
  assert.equal(logActivity(db, { user, park: trail, slug: 'nope' }, { now: now() }).error, 'unknown');
  assert.equal(logActivity(db, { user, park: trail, slug: 'park-walk', amount: 'lots' }, { now: now() }).error, 'bad_amount');
  // A facility activity at a park without that facility.
  stampVisit(db, { user, park: plain, method: 'honor' }, { now: now() });
  assert.equal(logActivity(db, { user, park: plain, slug: 'trail-time', amount: '20' }, { now: now() }).error, 'unknown');
  // Switched off by an admin.
  setActivityActive(db, db.prepare("SELECT id FROM activities WHERE slug = 'stretch'").pluck().get(), false);
  assert.equal(logActivity(db, { user, park: trail, slug: 'stretch' }, { now: now() }).error, 'unknown');
});

test('daily caps: miles are refused past 15; minutes credited stop at 180', async () => {
  const { db, now, trail, plain } = setup();
  const user = await newUser(db);
  stampVisit(db, { user, park: trail, method: 'honor' }, { now: now() });
  stampVisit(db, { user, park: plain, method: 'honor' }, { now: now() });
  assert.equal(logActivity(db, { user, park: trail, slug: 'walk-a-mile', amount: '10' }, { now: now() }).log.minutes, 180);
  assert.equal(logActivity(db, { user, park: plain, slug: 'walk-a-mile', amount: '6' }, { now: now() }).error, 'miles_cap');
  const more = logActivity(db, { user, park: trail, slug: 'park-walk', amount: '30' }, { now: now() });
  assert.equal(more.log.minutes, 0); // still logged, with points, but no more time credited today
  assert.equal(weekSummary(db, user.id, { now: now() }).parkMinutes, 180);
  assert.equal(weekSummary(db, user.id, { now: now() }).miles, 10);
});

test('undoing a log or deleting the visit removes its points', async () => {
  const { db, now, trail } = setup();
  const user = await newUser(db);
  const { visit } = stampVisit(db, { user, park: trail, method: 'honor' }, { now: now() });
  const stampPoints = totalPoints(db, user.id);
  const a = logActivity(db, { user, park: trail, slug: 'pick-5' }, { now: now() });
  logActivity(db, { user, park: trail, slug: 'breathe' }, { now: now() });
  assert.equal(totalPoints(db, user.id), stampPoints + 5);
  assert.equal(deleteActivityLog(db, { user: { id: user.id + 1 }, logId: a.log.id }), null);
  assert.ok(deleteActivityLog(db, { user, logId: a.log.id }));
  assert.equal(totalPoints(db, user.id), stampPoints + 2);
  deleteVisit(db, { user, visitId: visit.id }, { now: now() });
  assert.equal(totalPoints(db, user.id), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM activity_logs').pluck().get(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM point_events').pluck().get(), 0);
});

test('weekSummary counts this week only (Monday to today)', async () => {
  const { db, now, trail } = setup('2026-06-07T16:00:00Z'); // Sunday
  const user = await newUser(db);
  stampVisit(db, { user, park: trail, method: 'honor' }, { now: now() });
  logActivity(db, { user, park: trail, slug: 'park-walk', amount: '40' }, { now: now() });
  logActivity(db, { user, park: trail, slug: 'breathe' }, { now: now() });
  assert.deepEqual(weekSummary(db, user.id, { now: now() }), { moveMinutes: 40, parkMinutes: 45, miles: 0, count: 2, pillars: 2 });
  now.advanceMinutes(24 * 60); // Monday: a new week
  assert.equal(weekSummary(db, user.id, { now: now() }).count, 0);
});

test('activity badges are awarded, and Paws and Kids badges only show to members with that edition', async () => {
  const { db, now, trail } = setup();
  const user = await newUser(db);
  stampVisit(db, { user, park: trail, method: 'honor' }, { now: now() });
  const l = logActivity(db, { user, park: trail, slug: 'brisk-ten' }, { now: now() });
  const awarded = awardBadges(db, user.id, { type: 'activity', id: l.log.id }, { now: now() }).map((b) => b.slug);
  assert.ok(awarded.includes('first-activity'));
  const shown = () => new Set(badgeBoard(db, user.id).map((b) => b.slug));
  assert.ok(shown().has('club-150'));
  assert.ok(!shown().has('pack-walker'));
  assert.ok(!shown().has('junior-explorer'));
  db.prepare('UPDATE users SET paws = 1 WHERE id = ?').run(user.id);
  assert.ok(shown().has('pack-walker'));
  assert.ok(!shown().has('junior-explorer'));
  const club = badgeBoard(db, user.id).find((b) => b.slug === 'club-150');
  assert.equal(club.progress, 10);
});

// ---------- HTTP ----------

test('park page: locked until stamped, then log, undo and errors; logs stay private', async () => {
  const { app, db } = setup();
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: 'correct horse battery' });
  let res = await c.get('/parks/trail-park');
  assert.match(res.body, /Stamp this park today to unlock/);
  assert.doesNotMatch(res.body, /name="activity"/);

  res = await c.postMultipart('/parks/trail-park/stamp', {});
  assert.equal(res.statusCode, 303);
  res = await c.get('/parks/trail-park');
  assert.match(res.body, /Things to do here/);
  assert.match(res.body, /value="trail-time"/);
  assert.doesNotMatch(res.body, /value="pet-walk"/);

  res = await c.post('/parks/trail-park/activities', { activity: 'park-walk', amount: '0' });
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /Enter the minutes, from 1 to 180/);

  res = await c.post('/parks/trail-park/activities', { activity: 'park-walk', amount: '25' });
  assert.equal(res.statusCode, 303);
  assert.match(res.headers.location, /^\/parks\/trail-park\?logged=\d+#activities$/);
  res = await c.get(res.headers.location.replace('#activities', ''));
  assert.match(res.body, /Logged Park walk: \+3 points\./);
  assert.match(res.body, /✓ 25 min/);
  assert.match(res.body, /Off the Bench/); // badge announcement

  res = await c.post('/parks/trail-park/activities', { activity: 'park-walk', amount: '10' });
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /already logged Park walk/);

  // Errors for activities not on the page still show: one switched off by an admin.
  db.prepare("UPDATE activities SET active = 0 WHERE slug IN ('breathe', 'park-walk')").run();
  res = await c.post('/parks/trail-park/activities', { activity: 'breathe' });
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /That activity isn&#39;t available here.|That activity isn't available here./);
  // Today's log of a switched-off activity keeps its Undo.
  assert.match((await c.get('/parks/trail-park')).body, /Undo<span class="visually-hidden"> Park walk/);
  db.prepare("UPDATE activities SET active = 1").run();

  // Another member can't undo it.
  const logId = db.prepare('SELECT id FROM activity_logs').pluck().get();
  const other = client(app);
  await other.post('/signup', { display_name: 'Alex', email: 'alex@example.com', password: 'correct horse battery' });
  assert.equal((await other.post(`/activities/${logId}/delete`)).statusCode, 404);
  assert.doesNotMatch((await other.get('/parks/trail-park')).body, /25 min/);

  res = await c.post(`/activities/${logId}/delete`);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/parks/trail-park?undone=park-walk#activities');
  assert.match((await c.get('/parks/trail-park?undone=park-walk')).body, /<details class="act-group" open id="act-move">/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM activity_logs').pluck().get(), 0);
  // Off the Bench is taken back with its only activity.
  assert.equal(db.prepare("SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE b.slug = 'first-activity'").pluck().get(), 0);
});

test('signed-out visitors see no activities, and logging needs an account', async () => {
  const { app } = setup();
  const c = client(app);
  const res = await c.get('/parks/trail-park');
  assert.doesNotMatch(res.body, /Things to do here/);
  const post = await c.post('/parks/trail-park/activities', { activity: 'brisk-ten' });
  assert.equal(post.statusCode, 302);
  assert.match(post.headers.location, /^\/login/);
});

test('editions: account switches, Kids makes new photos default to private, passport shows the week', async () => {
  const { app, db } = setup();
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: 'correct horse battery' });
  assert.match((await c.get('/account')).body, /Paws: I bring a pet/);
  let res = await c.post('/account/editions', { paws: '1', kids: '1' });
  assert.equal(res.headers.location, '/account?done=editions#editions');
  const user = db.prepare('SELECT paws, kids FROM users').get();
  assert.deepEqual({ ...user }, { paws: 1, kids: 1 });
  res = await c.get('/parks/trail-park');
  assert.match(res.body, /Kids edition is on, so new photos start as "Only me"/);
  assert.match(res.body, /<option value="private" selected>/);
  await c.postMultipart('/parks/trail-park/stamp', {});
  res = await c.get('/parks/trail-park');
  assert.match(res.body, /value="pet-walk"/);
  assert.match(res.body, /value="nature-bingo"/);
  await c.post('/account/editions', {});
  assert.deepEqual({ ...db.prepare('SELECT paws, kids FROM users').get() }, { paws: 0, kids: 0 });
  assert.match((await c.get('/passport')).body, /This week's healthy habits/);
});

test('admin: switch activities off, edit loop length, and build activity badges', async () => {
  const { app, db } = setup();
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: 'correct horse battery' });
  assert.equal((await c.get('/admin/activities')).statusCode, 404);
  db.prepare('UPDATE users SET is_admin = 1').run();
  assert.match((await c.get('/admin/activities')).body, /Exercise Zone circuit/);
  const id = db.prepare("SELECT id FROM activities WHERE slug = 'brisk-ten'").pluck().get();
  const res = await c.post(`/admin/activities/${id}`, { active: '0' });
  assert.equal(res.statusCode, 303);
  assert.equal(db.prepare('SELECT active FROM activities WHERE id = ?').pluck().get(id), 0);
  assert.equal((await c.post('/admin/activities/99999', { active: '1' })).statusCode, 404);

  const park = db.prepare("SELECT * FROM parks WHERE slug = 'trail-park'").get();
  const form = { name: park.name, slug: park.slug, lat: '27.8065', lng: '-82.75531', checkin_radius_m: '150', active: '1', categories: 'trails' };
  assert.equal((await c.post(`/admin/parks/${park.id}`, { ...form, loop_mi: '30' })).statusCode, 422);
  assert.equal((await c.post(`/admin/parks/${park.id}`, { ...form, loop_mi: '0.84' })).statusCode, 303);
  assert.equal(db.prepare('SELECT loop_mi FROM parks WHERE id = ?').pluck().get(park.id), 0.8);

  const badgeForm = await c.get('/admin/badges/new');
  assert.match(badgeForm.body, /value="activity:sniffari"/);
  const bad = await c.postMultipart('/admin/badges/new', {
    name: 'Ten Sniffs', slug: 'ten-sniffs', kind: 'known', rule_type: 'activity_count', param_target: 'activity:nope', param_n: '10', enabled: '1',
  });
  assert.equal(bad.statusCode, 422);
  const ok = await c.postMultipart('/admin/badges/new', {
    name: 'Long Walks', slug: 'long-walks', kind: 'known', rule_type: 'activity_sum', param_target: 'pillar:move', param_metric: 'miles',
    param_total: '12.5', param_window_days: '14', enabled: '1',
  });
  assert.equal(ok.statusCode, 303);
  assert.deepEqual(JSON.parse(db.prepare("SELECT rule_params FROM badges WHERE slug = 'long-walks'").pluck().get()),
    { target: 'pillar:move', metric: 'miles', total: 12.5, window_days: 14 });
});
