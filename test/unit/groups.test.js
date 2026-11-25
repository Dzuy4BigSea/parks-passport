// M35: groups (SPEC Flow 23): unlocking, starting, joining three ways, limits, privacy, owners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { addMissingBadges, awardBadges } from '../../src/domain/badges/index.js';
import { SEED_GROUP_BADGES_JSON } from '../../src/db/seed.js';
import { friendCodeFor } from '../../src/domain/pals.js';

const PW = 'correct horse battery';

async function world(names = ['ana', 'ben', 'cat', 'dee', 'boss']) {
  const made = makeApp({ now: testClock('2026-06-06T16:00:00Z') });
  const { db, app } = made;
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','), 'a-park,A Park,,,27.80,-82.70,,,,0', 'b-park,B Park,,,27.81,-82.71,,,,0'].join('\n'));
  addMissingBadges(db, JSON.parse(fs.readFileSync(SEED_GROUP_BADGES_JSON, 'utf8')));
  const people = {};
  for (const name of names) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  // n GPS check-ins for a member (different days at A Park; the location is private and unused here).
  const gps = (who, n) => {
    const park = db.prepare("SELECT id FROM parks WHERE slug = 'a-park'").pluck().get();
    const ins = db.prepare("INSERT INTO visits (user_id, park_id, visited_on, visited_at, method, lat, lng, created_at) VALUES (?, ?, ?, ?, 'gps', 27.8, -82.7, 'x')");
    for (let i = 0; i < n; i++) {
      const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
      ins.run(people[who].id, park, day.slice(0, 10), day);
    }
  };
  const groupId = (name) => db.prepare('SELECT id FROM member_groups WHERE name = ?').pluck().get(name);
  const code = (name) => db.prepare('SELECT code FROM member_groups WHERE name = ?').pluck().get(name);
  const members = (name) => db.prepare('SELECT u.display_name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.display_name').pluck().all(groupId(name));
  const kinds = (who) => db.prepare('SELECT kind FROM notifications WHERE user_id = ? ORDER BY id').pluck().all(people[who].id);
  return { ...made, people, gps, groupId, code, members, kinds };
}

test('starting a group is unlocked by 10 GPS check-ins (Troop Leader) or an admin', async () => {
  const { db, people, gps, groupId, members } = await world();
  const { ana, boss } = people;
  let page = (await ana.c.get('/groups')).body;
  assert.match(page, /Become a Troop Leader to start your own groups\./);
  assert.match(page, /0 so far/);
  assert.equal((await ana.c.post('/groups', { name: 'Run Club', emoji: '🏃' })).statusCode, 404);

  gps('ana', 10);
  // The badge is earned like any other.
  assert.ok(awardBadges(db, ana.id, { type: 'visit', id: 1 }).some((b) => b.slug === 'troop-leader'));
  page = (await ana.c.get('/groups')).body;
  assert.match(page, /You can start 3 more\./);
  assert.equal((await ana.c.post('/groups', { name: '', emoji: '🏃' })).statusCode, 422);
  assert.equal((await ana.c.post('/groups', { name: 'x'.repeat(41), emoji: '🏃' })).statusCode, 422);
  assert.equal((await ana.c.post('/groups', { name: 'Text', emoji: 'abcd' })).statusCode, 422);
  assert.equal((await ana.c.post('/groups', { name: 'Two emoji', emoji: '🏃🏃' })).statusCode, 422);
  const res = await ana.c.post('/groups', { name: 'Run Club', emoji: '🏃', description: 'Saturday mornings.' });
  assert.equal(res.headers.location, `/groups/${groupId('Run Club')}?done=created`);
  assert.deepEqual(members('Run Club'), ['ana']);
  for (const n of ['Two', 'Three']) await ana.c.post('/groups', { name: n, emoji: '🌳' });
  assert.equal((await ana.c.post('/groups', { name: 'Four', emoji: '🌳' })).statusCode, 404); // 3 is the limit
  assert.match((await ana.c.get('/groups')).body, /You run 3 groups/);

  // An admin lets Ben start one without check-ins; members can't reach that page.
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(boss.id);
  assert.equal((await ana.c.get(`/admin/users/${people.ben.id}/groups`)).statusCode, 404);
  assert.equal((await boss.c.post(`/admin/users/${people.ben.id}/groups`, { group_create_limit: '99', group_join_limit: '' })).statusCode, 422);
  assert.equal((await boss.c.post(`/admin/users/${people.ben.id}/groups`, { group_create_limit: '1', group_join_limit: '' })).headers.location, `/admin/users/${people.ben.id}/groups?done=saved`);
  assert.equal((await people.ben.c.post('/groups', { name: 'Gym', emoji: '🏋️' })).statusCode, 303);
});

test('joining: the code asks the owner first (or lets you straight in), pals get invites, and there\'s a limit', async () => {
  const { db, app, people, gps, groupId, code, members, kinds } = await world();
  const { ana, ben, cat, dee } = people;
  gps('ana', 10);
  await ana.c.post('/groups', { name: 'Run Club', emoji: '🏃' });
  const id = groupId('Run Club');

  // Ask first (the default): Ben asks with the code; Ana approves.
  assert.equal((await ben.c.post('/groups/join', { code: 'NOPE-NOPE' })).statusCode, 422);
  assert.equal((await ben.c.post('/groups/join', { code: code('Run Club').toLowerCase() })).headers.location, '/groups?done=asked');
  assert.equal((await ben.c.post('/groups/join', { code: code('Run Club') })).statusCode, 422); // already asked
  assert.equal((await ben.c.get(`/groups/${id}`)).statusCode, 404); // not in yet
  assert.ok(kinds('ana').includes('group_request'));
  assert.match((await ana.c.get(`/groups/${id}`)).body, /Requests to join \(1\)/);
  assert.equal((await cat.c.post(`/groups/${id}/requests/${ben.id}/approve`)).statusCode, 404); // not the owner
  // No room on Ben's side: the request stays and Ana is told.
  db.prepare('UPDATE users SET group_join_limit = 0 WHERE id = ?').run(ben.id);
  const noRoom = await ana.c.post(`/groups/${id}/requests/${ben.id}/approve`);
  assert.equal(noRoom.statusCode, 422);
  assert.match(noRoom.body, /still here/);
  assert.deepEqual(members('Run Club'), ['ana']);
  db.prepare('UPDATE users SET group_join_limit = NULL WHERE id = ?').run(ben.id);
  await ana.c.post(`/groups/${id}/requests/${ben.id}/approve`);
  assert.deepEqual(members('Run Club'), ['ana', 'ben']);
  assert.ok(kinds('ben').includes('group_joined'));
  assert.match((await ben.c.get('/notifications')).body, /You're in Run Club\.|You&#39;re in Run Club\./);

  // Anyone with the code joins: the link, signed out first.
  await ana.c.post(`/groups/${id}/settings`, { name: 'Run Club', emoji: '🏃', description: '', join_mode: 'open' });
  const link = `/groups/join/${code('Run Club')}`;
  assert.match((await client(app).get(link)).body, /Create your passport/);
  assert.match((await cat.c.get(link)).body, /Join the group/);
  assert.equal((await cat.c.post(link)).headers.location, `/groups/${id}?done=joined`);
  assert.deepEqual(members('Run Club'), ['ana', 'ben', 'cat']);

  // A new code: the old link stops working.
  const old = code('Run Club');
  await ana.c.post(`/groups/${id}/code`);
  assert.equal((await dee.c.get(`/groups/join/${old}`)).statusCode, 404);

  // Invites go to Park Pals only.
  assert.equal((await ana.c.post('/groups/invite', { group_id: String(id), user_id: String(dee.id) })).statusCode, 404); // not a pal
  await dee.c.post('/pals/code', { code: friendCodeFor(db, ana.id) });
  const rid = db.prepare('SELECT id FROM pal_requests WHERE from_user = ?').pluck().get(dee.id);
  await ana.c.post(`/pals/requests/${rid}/accept`);
  assert.match((await ana.c.get('/pals')).body, /Invite to group<span class="visually-hidden">: dee/);
  assert.equal((await ana.c.post('/groups/invite', { group_id: String(id), user_id: String(dee.id) })).headers.location, '/pals?done=group_invited');
  assert.ok(kinds('dee').includes('group_invite'));
  assert.match((await dee.c.get('/groups')).body, /ana invited you/);
  await dee.c.post(`/groups/invites/${id}/accept`);
  assert.deepEqual(members('Run Club'), ['ana', 'ben', 'cat', 'dee']);
  assert.match((await ana.c.get('/notifications')).body, /dee joined Run Club\./);
  assert.equal((await dee.c.post(`/groups/invites/${id}/accept`)).statusCode, 404); // used

  // Five groups at first: a sixth is refused.
  db.prepare('UPDATE users SET group_create_limit = 6 WHERE id = ?').run(ben.id);
  for (const n of ['B1', 'B2', 'B3', 'B4']) await ben.c.post('/groups', { name: n, emoji: '🌳' });
  assert.match((await ben.c.get('/groups')).body, /Your groups \(5 of 5\)/);
  db.prepare("UPDATE member_groups SET join_mode = 'open' WHERE name = 'Two'").run();
  gps('cat', 10);
  await cat.c.post('/groups', { name: 'Cat Club', emoji: '🐈' });
  db.prepare("UPDATE member_groups SET join_mode = 'open' WHERE name = 'Cat Club'").run();
  const full = await ben.c.post('/groups/join', { code: code('Cat Club') });
  assert.equal(full.statusCode, 422);
  assert.match(full.body, /as many groups as you can be/);
});

test('privacy: members see names and counts only; outsiders get 404; owners manage, leave and end', async () => {
  const { db, people, gps, groupId, members, kinds } = await world();
  const { ana, ben, cat } = people;
  gps('ana', 10);
  await ana.c.post('/groups', { name: 'Gym', emoji: '🏋️' });
  const id = groupId('Gym');
  db.prepare("UPDATE member_groups SET join_mode = 'open' WHERE id = ?").run(id);
  const code = db.prepare('SELECT code FROM member_groups WHERE id = ?').pluck().get(id);
  await ben.c.post('/groups/join', { code });
  await cat.c.post('/groups/join', { code });

  const page = (await ben.c.get(`/groups/${id}`)).body;
  assert.match(page, /1 park · 10 check-ins · 0 badges/);
  assert.doesNotMatch(page, /A Park|27\.8|-82\.7/); // no parks, no locations
  assert.doesNotMatch(page, /Group settings/); // members don't manage
  assert.equal((await people.dee.c.get(`/groups/${id}`)).statusCode, 404);
  assert.equal((await ben.c.post(`/groups/${id}/end`)).statusCode, 404);
  assert.equal((await ben.c.post(`/groups/${id}/members`, { user_id: String(cat.id), action: 'remove' })).statusCode, 404);
  assert.equal((await ana.c.post(`/groups/${id}/settings`, { name: 'Gym' }, { csrf: false })).statusCode, 403);

  // The owner removes Cat, hands the group to Ben, and leaves; Ben ends it; everyone is told.
  await ana.c.post(`/groups/${id}/members`, { user_id: String(cat.id), action: 'remove' });
  assert.deepEqual(members('Gym'), ['ana', 'ben']);
  await ana.c.post(`/groups/${id}/members`, { user_id: String(ben.id), action: 'owner' });
  assert.match((await ben.c.get(`/groups/${id}`)).body, /Group settings/);
  await ana.c.post(`/groups/${id}/leave`);
  assert.deepEqual(members('Gym'), ['ben']);
  await cat.c.post('/groups/join', { code });
  await ben.c.post(`/groups/${id}/end`);
  assert.equal(groupId('Gym'), undefined);
  assert.ok(kinds('cat').includes('group_ended'));
});

test('an owner who deletes their account hands the group on; the last one out ends it; home shows your groups', async () => {
  const { db, people, gps, groupId, members } = await world();
  const { ana, ben } = people;
  gps('ana', 10);
  await ana.c.post('/groups', { name: 'Class', emoji: '🎒' });
  await ana.c.post('/groups', { name: 'Solo', emoji: '🌳' });
  db.prepare("UPDATE member_groups SET join_mode = 'open'").run();
  await ben.c.post('/groups/join', { code: db.prepare("SELECT code FROM member_groups WHERE name = 'Class'").pluck().get() });
  assert.match((await ben.c.get('/')).body, /Your groups[\s\S]*Class/);
  assert.match((await people.cat.c.get('/')).body, /more GPS check-ins and you're a Troop Leader|more GPS check-ins and you&#39;re a Troop Leader/);
  await ana.c.post('/account/delete', { delete_password: PW });
  assert.deepEqual(members('Class'), ['ben']);
  assert.equal(db.prepare('SELECT owner_id FROM member_groups WHERE id = ?').pluck().get(groupId('Class')), ben.id);
  assert.equal(groupId('Solo'), undefined);
});

test('wrong codes are limited to 20 an hour per IP, typed or by link; family emoji are fine', async () => {
  const { app, people, gps } = await world();
  const from = (method, url, c, payload) => app.inject({ method, url, payload, headers: { 'x-forwarded-for': '203.0.113.50', cookie: c ? [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ') : '', ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) } });
  for (let i = 0; i < 20; i++) assert.equal((await from('GET', '/groups/join/ZZZZZZZZ')).statusCode, 404);
  assert.equal((await from('GET', '/groups/join/ZZZZZZZZ')).statusCode, 429);
  gps('ana', 10);
  assert.equal((await people.ana.c.post('/groups', { name: 'Family', emoji: '👨‍👩‍👧' })).statusCode, 303);
});

test('group invites and join requests can be answered right in the notification center', async () => {
  const { db, people, gps, groupId, code, members } = await world();
  const { ana, ben, cat, dee } = people;
  gps('ana', 10);
  await ana.c.post('/groups', { name: 'Walkers', emoji: '🚶' });
  const g = groupId('Walkers');

  // Ben asks to join with the code; Ana approves from her notifications.
  await ben.c.post(`/groups/join/${code('Walkers')}`);
  let page = (await ana.c.get('/notifications')).body;
  assert.match(page, new RegExp(`action="/groups/${g}/requests/${ben.id}/approve"[\\s\\S]*name="from" value="notifications"`));
  assert.equal((await dee.c.post(`/groups/${g}/requests/${ben.id}/approve`, { from: 'notifications' })).statusCode, 404); // not the owner
  assert.equal((await ana.c.post(`/groups/${g}/requests/${ben.id}/approve`, { from: 'notifications' })).headers.location, '/notifications?done=group_approved');
  assert.deepEqual(members('Walkers'), ['ana', 'ben']);
  page = (await ana.c.get('/notifications?done=group_approved')).body;
  assert.match(page, /Approved\. They(’|&#39;|')re in\./);
  assert.match(page, /They(’|&#39;|')re in\.<\/span>/);
  assert.doesNotMatch(page, new RegExp(`/groups/${g}/requests/${ben.id}/approve`));

  // Dee asks; Ana declines from her notifications: it just says Answered.
  await dee.c.post(`/groups/join/${code('Walkers')}`);
  assert.equal((await ana.c.post(`/groups/${g}/requests/${dee.id}/decline`, { from: 'notifications' })).headers.location, '/notifications?done=group_declined');
  assert.match((await ana.c.get('/notifications')).body, /Answered\./);

  // Ana invites her pal Cat; Cat joins from her notifications.
  const [a, b] = ana.id < cat.id ? [ana.id, cat.id] : [cat.id, ana.id];
  db.prepare('INSERT INTO pal_links (user_a, user_b, created_at) VALUES (?, ?, ?)').run(a, b, '2026-06-01T00:00:00Z');
  await ana.c.post(`/groups/${g}/invite`, { user_id: String(cat.id) });
  page = (await cat.c.get('/notifications')).body;
  assert.match(page, new RegExp(`href="/groups\\?invite=${g}#invites"`));
  assert.match(page, new RegExp(`action="/groups/invites/${g}/accept"`));
  assert.equal((await cat.c.post(`/groups/invites/${g}/accept`, { from: 'notifications' })).headers.location, '/notifications?done=group_joined');
  assert.deepEqual(members('Walkers'), ['ana', 'ben', 'cat']);
  assert.match((await cat.c.get('/notifications')).body, /You joined\./);
  // Someone else can't answer Cat's invite.
  assert.equal((await dee.c.post(`/groups/invites/${g}/accept`, { from: 'notifications' })).statusCode, 404);
});

test('QA: an old group notification never answers a later invite or a new group that reused its id; stale states say so', async () => {
  const { app, db, people, gps, groupId, code, members } = await world();
  const { ana, ben, cat } = people;
  const now = app.now;
  gps('ana', 10);
  const [a, b] = ana.id < cat.id ? [ana.id, cat.id] : [cat.id, ana.id];
  db.prepare('INSERT INTO pal_links (user_a, user_b, created_at) VALUES (?, ?, ?)').run(a, b, '2026-06-01T00:00:00Z');
  await ana.c.post('/groups', { name: 'Walkers', emoji: '🚶' });
  const g1 = groupId('Walkers');
  await ana.c.post(`/groups/${g1}/invite`, { user_id: String(cat.id) });
  // Cat declines from the notification.
  assert.equal((await cat.c.post(`/groups/invites/${g1}/decline`, { from: 'notifications' })).headers.location, '/notifications?done=group_invite_declined');
  assert.match((await cat.c.get('/notifications')).body, /Answered\./);
  // A re-invite later: only the new notification has buttons.
  now.advanceMinutes(5);
  await ana.c.post(`/groups/${g1}/invite`, { user_id: String(cat.id) });
  let page = (await cat.c.get('/notifications')).body;
  assert.equal((page.match(new RegExp(`/groups/invites/${g1}/accept`, 'g')) || []).length, 1);
  // Ana ends Walkers and starts a new group, which may reuse the id: the old invites say No longer open.
  await ana.c.post(`/groups/${g1}/end`);
  now.advanceMinutes(5);
  await ana.c.post('/groups', { name: 'Secret Other', emoji: '🌳' });
  const g2 = groupId('Secret Other');
  page = (await cat.c.get('/notifications')).body;
  assert.doesNotMatch(page, new RegExp(`/groups/invites/${g2}/accept`));
  assert.match(page, /No longer open\./);
  assert.deepEqual(members('Secret Other'), ['ana']);

  // An older invite notification (no group in its link) is just a link.
  db.prepare("INSERT INTO notifications (user_id, kind, text, link, actor_id, created_at) VALUES (?, 'group_invite', 'old invite', '/groups#invites', ?, ?)")
    .run(cat.id, ana.id, now().toISOString());
  assert.match((await cat.c.get('/notifications')).body, /<a href="\/groups#invites">old invite<\/a>\s*<br><span class="muted">[^<]*<\/span><\/p><\/li>/);

  // A request whose group was handed on: the old owner's notification says No longer open.
  await ben.c.post(`/groups/join/${code('Secret Other')}`);
  db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?)')
    .run(g2, cat.id, now().toISOString(), g2, cat.id);
  db.prepare('UPDATE member_groups SET owner_id = ? WHERE id = ?').run(cat.id, g2);
  page = (await ana.c.get('/notifications')).body;
  assert.doesNotMatch(page, new RegExp(`/groups/${g2}/requests/${ben.id}/approve`));
  assert.match(page, /No longer open\./);
});

test('QA: accepting from a notification while in too many groups goes back to the notifications with a note', async () => {
  const { db, people, gps, groupId } = await world();
  const { ana, cat } = people;
  gps('ana', 10);
  const [a, b] = ana.id < cat.id ? [ana.id, cat.id] : [cat.id, ana.id];
  db.prepare('INSERT INTO pal_links (user_a, user_b, created_at) VALUES (?, ?, ?)').run(a, b, '2026-06-01T00:00:00Z');
  await ana.c.post('/groups', { name: 'Walkers', emoji: '🚶' });
  await ana.c.post(`/groups/${groupId('Walkers')}/invite`, { user_id: String(cat.id) });
  db.prepare('UPDATE users SET group_join_limit = 0 WHERE id = ?').run(cat.id);
  const res = await cat.c.post(`/groups/invites/${groupId('Walkers')}/accept`, { from: 'notifications' });
  assert.equal(res.headers.location, '/notifications?done=group_full');
  assert.match((await cat.c.get(res.headers.location)).body, /as many groups as you can be/);
});
