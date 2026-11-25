// M19: the reward schedule. Surprise badges for first-time actions, lucky drops that are frequent
// early and rarer later (at most one per stamp), and the longer climb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { makeApp, client, testClock } from './helpers.js';
import { seedBadges, seedCities } from '../../src/db/seed.js';
import { luckyChance } from '../../src/domain/badges/rules.js';
import { validateBadgeForm } from '../../src/domain/admin.js';

const PW = 'correct horse battery';

async function world({ now = testClock('2026-06-06T16:00:00Z'), random = () => 0.99 } = {}) {
  const made = makeApp({ now, random });
  seedBadges(made.db);
  seedCities(made.db);
  const join = async (name) => {
    const c = client(made.app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    return { c, id: made.db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  };
  const earned = (id) => made.db.prepare(`SELECT b.slug FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? ORDER BY b.slug`).pluck().all(id);
  return { ...made, join, earned };
}

test('lucky drop odds: high on the first stamps, halving every 3 stamps, never below the floor', () => {
  const s = { chance: 0.45, floor: 0.03, half_life: 3 };
  assert.equal(luckyChance(1, s), 0.45);
  assert.equal(luckyChance(4, s), 0.225);
  assert.ok(Math.abs(luckyChance(7, s) - 0.1125) < 1e-9);
  assert.equal(luckyChance(40, s), 0.03);
});

test('surprise badges: first park page, profile photo, pal, rating and photo; each once, announced right away', async () => {
  const { db, join, earned } = await world();
  const ana = await join('ana');
  const first = (await ana.c.get('/st-pete/parks/abercrombie-park')).body;
  assert.match(first, /New badge: Trail Planner/);
  assert.doesNotMatch((await ana.c.get('/st-pete/parks/crescent-lake-park')).body, /New badge: Trail Planner/);
  assert.deepEqual(earned(ana.id), ['trail-planner']);

  const photo = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#e4572e' } }).jpeg().toBuffer();
  await ana.c.postMultipart('/account/avatar', {}, { photo: { buffer: photo, filename: 'me.jpg', type: 'image/jpeg' } });
  assert.match((await ana.c.get('/account')).body, /New badge: Say Cheese/);

  const ben = await join('ben');
  const link = (await ana.c.get('/pals')).body.match(/\/pals\/invite\/[A-Za-z0-9_-]+/)[0];
  await ben.c.post(`${link}/accept`);
  assert.ok(earned(ana.id).includes('better-with-friends') && earned(ben.id).includes('better-with-friends'));

  await ana.c.post('/st-pete/parks/abercrombie-park/rating', { stars: '5', comment: '' });
  await ana.c.postMultipart('/st-pete/parks/abercrombie-park/photos', {}, { photo: { buffer: photo, filename: 'p.jpg', type: 'image/jpeg' } });
  assert.ok(['critics-corner', 'shutterbug'].every((s) => earned(ana.id).includes(s)));
  assert.equal(db.prepare('SELECT COUNT(*) FROM user_milestones WHERE user_id = ?').pluck().get(ana.id), 5);
  assert.ok(!earned(ana.id).includes('night-owl')); // 12 pm in St. Pete
});

test('Night Owl: looking at parks between 9 pm and 4 am, in the city\'s own time', async () => {
  // 06:00 UTC = 2 am in St. Pete, 11 pm in Westminster.
  const { join, earned } = await world({ now: testClock('2026-06-06T06:00:00Z') });
  const ana = await join('ana');
  assert.match((await ana.c.get('/westminster/parks')).body, /New badge: Night Owl/);
  assert.ok(earned(ana.id).includes('night-owl'));
  // 14:00 UTC = 10 am in St. Pete: nothing.
  const day = await world({ now: testClock('2026-06-06T14:00:00Z') });
  const ben = await day.join('ben');
  await ben.c.get('/st-pete/parks');
  assert.ok(!day.earned(ben.id).includes('night-owl'));
});

test('lucky drops: at most one per stamp, in order; a high roll drops nothing; they are never taken back', async () => {
  const { db, join, earned } = await world({ random: () => 0.1 }); // 0.1 < 45% on early stamps
  const ana = await join('ana');
  const lucky = () => earned(ana.id).filter((s) => ['golden-acorn', 'shooting-star', 'rainbow-find', 'lucky-penny'].includes(s));
  await ana.c.post('/st-pete/parks/abercrombie-park/stamp', {});
  assert.deepEqual(lucky(), ['golden-acorn']);
  await ana.c.post('/st-pete/parks/crescent-lake-park/stamp', {});
  assert.deepEqual(lucky(), ['golden-acorn', 'shooting-star']);
  // Delete both visits: lucky drops stay.
  for (const id of db.prepare('SELECT id FROM visits WHERE user_id = ?').pluck().all(ana.id)) await ana.c.post(`/visits/${id}/delete`, {});
  assert.deepEqual(lucky(), ['golden-acorn', 'shooting-star']);

  const unlucky = await world({ random: () => 0.99 });
  const ben = await unlucky.join('ben');
  await ben.c.post('/st-pete/parks/abercrombie-park/stamp', {});
  assert.ok(!unlucky.earned(ben.id).some((s) => ['golden-acorn', 'shooting-star'].includes(s)));
});

test('admin badge form: the milestone and lucky drop rules validate their settings', () => {
  const ok = validateBadgeForm({ name: 'Snap', slug: 'snap', kind: 'hidden', hint: 'h', art: '📷', rule_type: 'milestone', param_action: 'photo' }, { isNew: true });
  assert.deepEqual(JSON.parse(ok.badge.rule_params), { action: 'photo' });
  assert.ok(validateBadgeForm({ name: 'X', slug: 'x', kind: 'hidden', hint: 'h', art: '⭐', rule_type: 'milestone', param_action: 'nope' }, { isNew: true }).errors.param_action);
  const drop = validateBadgeForm({ name: 'D', slug: 'd', kind: 'lucky', hint: 'h', art: '🍀', rule_type: 'lucky_drop',
    param_order: '5', param_chance: '0.4', param_floor: '0.02', param_half_life: '3' }, { isNew: true });
  assert.deepEqual(JSON.parse(drop.badge.rule_params), { order: 5, chance: 0.4, floor: 0.02, half_life: 3 });
  assert.ok(validateBadgeForm({ name: 'D', slug: 'd', kind: 'lucky', hint: 'h', art: '🍀', rule_type: 'lucky_drop',
    param_order: '5', param_chance: '2', param_floor: '0.02', param_half_life: '3' }, { isNew: true }).errors.param_chance);
});
