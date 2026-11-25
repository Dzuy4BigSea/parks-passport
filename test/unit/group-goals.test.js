// M36: group goals and team badges (SPEC Flow 24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { addMissingBadges, revokeUnmetBadges, badgeBoard } from '../../src/domain/badges/index.js';
import { SEED_TEAM_BADGES_JSON } from '../../src/db/seed.js';
import { checkGroupGoals, GOAL_TEMPLATES } from '../../src/domain/group-goals.js';
import { validateBadgeForm } from '../../src/domain/admin.js';

const PW = 'correct horse battery';

async function world() {
  const now = testClock('2026-06-06T16:00:00Z');
  const made = makeApp({ now });
  const { db, app } = made;
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','), 'a-park,A Park,,,27.80,-82.70,,,,0', 'b-park,B Park,,,27.81,-82.71,,,,0', 'c-park,C Park,,,27.82,-82.72,,,,0'].join('\n'));
  addMissingBadges(db, JSON.parse(fs.readFileSync(SEED_TEAM_BADGES_JSON, 'utf8')));
  const people = {};
  for (const name of ['ana', 'ben', 'cat', 'boss']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  db.prepare('UPDATE users SET group_create_limit = 3 WHERE id = ?').run(people.ana.id);
  await people.ana.c.post('/groups', { name: 'Run Club', emoji: '🏃' });
  const gid = db.prepare("SELECT id FROM member_groups WHERE name = 'Run Club'").pluck().get();
  db.prepare("UPDATE member_groups SET join_mode = 'open' WHERE id = ?").run(gid);
  const code = db.prepare('SELECT code FROM member_groups WHERE id = ?').pluck().get(gid);
  await people.ben.c.post('/groups/join', { code });
  const stamp = (who, park) => people[who].c.post(`/st-pete/parks/${park}/stamp`, {});
  const teamBadge = (who) => db.prepare(`SELECT b.slug, ub.note FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? AND b.is_group = 1`).all(people[who].id);
  return { ...made, now, people, gid, code, stamp, teamBadge };
}

test('ready-made goals and team badges ship, each goal with its badge', () => {
  const slugs = JSON.parse(fs.readFileSync(SEED_TEAM_BADGES_JSON, 'utf8')).map((b) => b.slug);
  assert.ok(slugs.includes('team-effort'));
  assert.ok(GOAL_TEMPLATES.length >= 5);
  for (const t of GOAL_TEMPLATES) assert.ok(slugs.includes(t.badge), `${t.key} has a team badge`);
});

test('a goal under way counts what members do; reaching it gives everyone the team badge, kept after leaving', async () => {
  const { db, people, gid, stamp, teamBadge } = await world();
  const { ana, ben } = people;
  // Only the owner sets goals; one at a time.
  assert.equal((await ben.c.post(`/groups/${gid}/goal`, { template: 'kickoff' })).statusCode, 404);
  assert.equal((await ana.c.post(`/groups/${gid}/goal`, { template: 'custom', metric: 'checkins', target: '0', days: '7' })).statusCode, 422);
  const badge = db.prepare("SELECT id FROM badges WHERE slug = 'team-effort'").pluck().get();
  assert.equal((await ana.c.post(`/groups/${gid}/goal`, { template: 'custom', metric: 'checkins', target: '3', days: '7', badge_id: String(badge) })).headers.location, `/groups/${gid}?done=goal#goal`);
  assert.equal((await ana.c.post(`/groups/${gid}/goal`, { template: 'kickoff' })).statusCode, 422); // busy
  let page = (await ben.c.get(`/groups/${gid}`)).body;
  assert.match(page, /3 check-ins together in 7 days/);
  assert.match(page, /<strong>0<\/strong> of 3 check-ins/);

  // A non-member's stamps don't count.
  await stamp('cat', 'a-park');
  await stamp('ana', 'a-park');
  await stamp('ben', 'a-park');
  page = (await ben.c.get(`/groups/${gid}`)).body;
  assert.match(page, /<strong>2<\/strong> of 3 check-ins/);
  assert.match((await ana.c.get('/')).body, /3 check-ins together in 7 days: 2 of 3/); // home card
  await stamp('ben', 'b-park');
  assert.deepEqual(teamBadge('ana'), [{ slug: 'team-effort', note: 'Run Club' }]);
  assert.deepEqual(teamBadge('ben'), [{ slug: 'team-effort', note: 'Run Club' }]);
  assert.deepEqual(teamBadge('cat'), []);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'goal_reached'").get(ana.id));
  // Announced with the group, then in its own passport section, not among the regular badges.
  const next = (await ana.c.get('/pals')).body;
  assert.match(next, /data-kind="team"/);
  assert.match(next, /Earned together with Run Club/);
  const passport = (await ana.c.get('/st-pete/passport')).body;
  assert.match(passport, /Team badges <span class="count">\(1\)<\/span>/);
  assert.match(passport, /With Run Club/);
  assert.ok(!badgeBoard(db, ana.id).some((b) => b.slug === 'team-effort'));
  assert.match((await ben.c.get(`/groups/${gid}`)).body, /Reached/);

  // Kept: the rules never take it back, nor does leaving or the group ending.
  revokeUnmetBadges(db, ben.id);
  await ben.c.post(`/groups/${gid}/leave`);
  await ana.c.post(`/groups/${gid}/end`);
  assert.deepEqual(teamBadge('ben'), [{ slug: 'team-effort', note: 'Run Club' }]);
  assert.deepEqual(teamBadge('ana'), [{ slug: 'team-effort', note: 'Run Club' }]);
});

test('different parks count once for the group; minutes come from activity logs; owners can stop a goal', async () => {
  const { db, now, people, gid, stamp } = await world();
  const { ana, ben } = people;
  await ana.c.post(`/groups/${gid}/goal`, { template: 'custom', metric: 'parks', target: '3', days: '30' });
  await stamp('ana', 'a-park');
  await stamp('ben', 'a-park'); // the same park: still 1
  assert.match((await ana.c.get(`/groups/${gid}`)).body, /<strong>1<\/strong> of 3 different parks/);
  await stamp('ben', 'b-park');
  assert.match((await ana.c.get(`/groups/${gid}`)).body, /<strong>2<\/strong> of 3 different parks/);
  assert.equal((await ben.c.post(`/groups/${gid}/goal/stop`)).statusCode, 404);
  await ana.c.post(`/groups/${gid}/goal/stop`);
  assert.match((await ana.c.get(`/groups/${gid}`)).body, /Ended/);

  // Minutes: an activity logged after the goal starts.
  await ana.c.post(`/groups/${gid}/goal`, { template: 'custom', metric: 'minutes', target: '30', days: '7' });
  now.advanceMinutes(5);
  const visit = db.prepare('SELECT id FROM visits WHERE user_id = ? LIMIT 1').pluck().get(ben.id);
  const act = db.prepare("INSERT INTO activities (slug, name, pillar, measure, points) VALUES ('walk', 'Walk', 'move', 'minutes', 5)").run().lastInsertRowid;
  db.prepare("INSERT INTO activity_logs (user_id, visit_id, activity_id, amount, minutes, logged_on, created_at) VALUES (?, ?, ?, 30, 30, '2026-06-06', ?)")
    .run(ben.id, visit, act, now().toISOString());
  assert.equal(checkGroupGoals(db, ben.id, { now: now() }).length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE b.slug = 'team-effort'").pluck().get(), 2);
});

test('owners suggest goals and team badges for the ideas queue; Admin › Badges keeps team badges apart', async () => {
  const { db, people, gid } = await world();
  const { ana, ben, boss } = people;
  assert.equal((await ben.c.post(`/groups/${gid}/suggest`, { kind: 'group_goal', pitch: 'x' })).statusCode, 404);
  assert.equal((await ana.c.post(`/groups/${gid}/suggest`, { kind: 'group_goal', pitch: '' })).statusCode, 422);
  await ana.c.post(`/groups/${gid}/suggest`, { kind: 'group_goal', idea_name: 'Dog Days', pitch: 'visit every dog park in town together' });
  await ana.c.post(`/groups/${gid}/suggest`, { kind: 'group_badge', pitch: 'a badge for a sunrise group walk' });
  assert.deepEqual(db.prepare('SELECT kind FROM badge_ideas ORDER BY id').pluck().all(), ['group_goal', 'group_badge']);

  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(boss.id);
  const list = (await boss.c.get('/admin/badges')).body;
  assert.match(list, /Group badges \(6\)/);
  assert.match((await boss.c.get('/admin/badges/new?team=1')).body, /name="is_group" value="1" checked/);
  const base = { name: 'X', slug: 'x', kind: 'known', enabled: '1', is_group: '1' };
  assert.match(validateBadgeForm({ ...base, rule_type: 'parks_count', param_n: '1' }, { isNew: true }).errors.is_group, /Given by an admin only/);
  assert.equal(validateBadgeForm({ ...base, rule_type: 'manual' }, { isNew: true }).badge.is_group, 1);
});
