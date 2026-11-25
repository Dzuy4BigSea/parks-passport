// M28: Nonprofit spotlights (SPEC Flow 18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { seedCities } from '../../src/db/seed.js';
import { cleanUrl, spotlightFor, saveNonprofit } from '../../src/domain/nonprofits.js';

const PW = 'correct horse battery';

async function world() {
  const now = testClock('2026-06-06T16:00:00Z');
  const made = makeApp({ now });
  const { db, app } = made;
  seedCities(db);
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','),
    'a-park,A Park,,,27.800,-82.700,,,,0', 'b-park,B Park,,,27.801,-82.701,,,,0'].join('\n'));
  const people = {};
  for (const name of ['ana', 'boss']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.boss.id);
  const city = (key) => db.prepare('SELECT id FROM city_themes WHERE key = ?').pluck().get(key);
  const park = (slug) => db.prepare("SELECT p.* FROM parks p WHERE p.slug = ? AND p.city_id = (SELECT id FROM city_themes WHERE key = 'st-pete')").get(slug);
  const add = (form) => saveNonprofit(db, null, { reason: 'steward', mission: 'We care.', city_id: city('st-pete'), status: 'active', ...form }).id;
  return { ...made, now, people, city, park, add };
}

test('cleanUrl takes https websites only', () => {
  assert.equal(cleanUrl('https://friends.example.org/about'), 'https://friends.example.org/about');
  for (const bad of ['http://x.org', 'javascript:alert(1)', 'https://localhost', 'https://u:p@x.org', 'nope']) assert.equal(cleanUrl(bad), null, bad);
});

test('suggest: signed in, validated, limited to 5 a day, waits for an admin', async () => {
  const { app, db, people } = await world();
  const { c } = people.ana;
  assert.match((await client(app).get('/nonprofits/suggest')).headers.location, /^\/login/);
  await c.get('/nonprofits/suggest?city=st-pete');
  const bad = await c.post('/nonprofits/suggest', { name: '', url: 'http://x.org', mission: '', serves: '', reason: 'x' });
  assert.equal(bad.statusCode, 422);
  for (const msg of [/Enter the nonprofit/, /starting with https/, /one sentence/, /which parks or waterways/, /Choose why/]) assert.match(bad.body, msg);
  const good = { name: 'Friends of A Park', url: 'https://friends.example.org', mission: 'Volunteers who plant and clean A Park.', serves: 'A Park and its pond', reason: 'steward' };
  assert.equal((await c.post('/nonprofits/suggest', good)).headers.location, '/nonprofits/suggest?done=sent');
  const row = db.prepare('SELECT * FROM nonprofits').get();
  assert.equal(row.status, 'suggested');
  assert.equal(row.suggested_by, people.ana.id);
  for (let i = 0; i < 4; i++) await c.post('/nonprofits/suggest', good);
  assert.match((await c.post('/nonprofits/suggest', good)).body, /5 suggestions today/);
  // Suggested ones never show on park pages.
  assert.doesNotMatch((await c.get('/st-pete/parks/a-park')).body, /class="spotlight"/);
});

test('park page: park-specific beats city-wide; ties rotate by day; paused hidden; views counted', async () => {
  const { db, people, park, add, now, city } = await world();
  const a = park('a-park');
  const cityWide = add({ name: 'City Trees', url: 'https://trees.example.org', reason: 'one_percent' });
  const s1 = add({ name: 'Friends of A', url: 'https://a1.example.org', parks: [a.id] });
  const s2 = add({ name: 'A Pond Keepers', url: 'https://a2.example.org', parks: [a.id] });
  const page = (await people.ana.c.get('/st-pete/parks/a-park')).body;
  assert.match(page, /<p class="spotlight-label">Local nonprofit · Cares for this park<\/p>/);
  assert.match(page, /href="\/go\/nonprofit\/\d+\?park=\d+" rel="noopener sponsored"/);
  // Rotation by day between the two park-specific ones.
  const day0 = spotlightFor(db, a, { now: now() }).id;
  const day1 = spotlightFor(db, a, { now: new Date(now().getTime() + 86400e3) }).id;
  assert.deepEqual(new Set([day0, day1]), new Set([s1, s2]));
  // B Park has none of its own: the city-wide one shows.
  assert.match((await people.ana.c.get('/st-pete/parks/b-park')).body, /City Trees[\s\S]*1% for the Planet partner|1% for the Planet partner[\s\S]*City Trees/);
  // A city-wide nonprofit in another city never shows here.
  saveNonprofit(db, cityWide, { name: 'City Trees', url: 'https://trees.example.org', reason: 'one_percent', mission: 'x', city_id: city('westminster'), status: 'active' });
  assert.doesNotMatch((await people.ana.c.get('/st-pete/parks/b-park')).body, /City Trees/);
  // Paused: hidden.
  for (const id of [s1, s2]) db.prepare("UPDATE nonprofits SET status = 'paused' WHERE id = ?").run(id);
  assert.doesNotMatch((await people.ana.c.get('/st-pete/parks/a-park')).body, /class="spotlight"/);
  assert.match((await people.ana.c.get('/st-pete/parks/a-park')).body, /Know a nonprofit that cares for this park\?/);
  // Views were counted per park and day, with nothing about the viewer.
  const stats = db.prepare('SELECT * FROM nonprofit_stats ORDER BY nonprofit_id').all();
  assert.ok(stats.length >= 1);
  assert.deepEqual(Object.keys(stats[0]).sort(), ['clicks', 'day', 'nonprofit_id', 'park_id', 'views']);
});

test('clicks: counted, then a redirect to the saved website only; paused or unknown 404', async () => {
  const { db, app, park, add } = await world();
  const a = park('a-park');
  const id = add({ name: 'Friends of A', url: 'https://a1.example.org/', parks: [a.id] });
  const res = await client(app).get(`/go/nonprofit/${id}?park=${a.id}&url=https://evil.example`);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, 'https://a1.example.org/');
  assert.equal(db.prepare('SELECT clicks FROM nonprofit_stats WHERE nonprofit_id = ? AND park_id = ?').pluck().get(id, a.id), 1);
  await client(app).get(`/go/nonprofit/${id}?park=99999`); // unknown park: redirect, not counted
  assert.equal(db.prepare('SELECT SUM(clicks) FROM nonprofit_stats').pluck().get(), 1);
  db.prepare("UPDATE nonprofits SET status = 'paused' WHERE id = ?").run(id);
  assert.equal((await client(app).get(`/go/nonprofit/${id}`)).statusCode, 404);
  assert.equal((await client(app).get('/go/nonprofit/99999')).statusCode, 404);
});

test('admin: members 404; add with parks in its city only; approve a suggestion; stats; delete', async () => {
  const { db, people, park, city } = await world();
  assert.equal((await people.ana.c.get('/admin/nonprofits')).statusCode, 404);
  const boss = people.boss.c;
  const a = park('a-park');
  const wmPark = db.prepare("SELECT id FROM parks WHERE city_id = (SELECT id FROM city_themes WHERE key = 'westminster') LIMIT 1").pluck().get();
  const wrong = await boss.postMultipart('/admin/nonprofits/new', { name: 'X', url: 'https://x.example.org', mission: 'm', reason: 'local', city_id: String(city('st-pete')), parks: String(wmPark), status: 'active' });
  assert.equal(wrong.statusCode, 422);
  assert.match(wrong.body, /Choose parks in this nonprofit/);
  const ok = await boss.postMultipart('/admin/nonprofits/new', { name: 'Friends of A', url: 'https://a1.example.org', mission: 'We plant.', reason: 'steward', city_id: String(city('st-pete')), parks: String(a.id), status: 'active' });
  assert.equal(ok.statusCode, 303);
  const id = Number(ok.headers.location.match(/\/admin\/nonprofits\/(\d+)/)[1]);
  assert.deepEqual(db.prepare('SELECT park_id FROM nonprofit_parks WHERE nonprofit_id = ?').pluck().all(id), [a.id]);
  await people.ana.c.get(`/st-pete/parks/a-park`);
  const list = (await boss.get('/admin/nonprofits')).body;
  assert.match(list, /Friends of A/);
  assert.match(list, /1 park in St\. Petersburg/);
  assert.match(list, /A Park <span class="muted">\(1 · 0\)<\/span>/);
  assert.match((await boss.get('/admin')).body, /1 active · 0 suggested/);
  // A member's suggestion appears as Suggested with their words, and can be made active.
  await people.ana.c.get('/nonprofits/suggest?city=st-pete');
  await people.ana.c.post('/nonprofits/suggest', { name: 'Pond Pals', url: 'https://pond.example.org', mission: 'Pond care.', serves: 'The pond at A Park', reason: 'steward' });
  const sid = db.prepare("SELECT id FROM nonprofits WHERE name = 'Pond Pals'").pluck().get();
  assert.match((await boss.get(`/admin/nonprofits/${sid}`)).body, /Suggested for: The pond at A Park/);
  await boss.postMultipart(`/admin/nonprofits/${sid}`, { name: 'Pond Pals', url: 'https://pond.example.org', mission: 'Pond care.', reason: 'steward', city_id: String(city('st-pete')), status: 'active' });
  assert.equal(db.prepare('SELECT status FROM nonprofits WHERE id = ?').pluck().get(sid), 'active');
  // Delete removes it and its counts.
  assert.equal((await boss.post(`/admin/nonprofits/${id}/delete`)).statusCode, 303);
  assert.equal(db.prepare('SELECT COUNT(*) FROM nonprofit_stats WHERE nonprofit_id = ?').pluck().get(id), 0);
  assert.equal((await boss.get(`/admin/nonprofits/${id}`)).statusCode, 404);
});

test('Admin › Mission: the draft mission for admins only (M29)', async () => {
  const { people } = await world();
  assert.equal((await people.ana.c.get('/admin/mission')).statusCode, 404);
  const page = (await people.boss.c.get('/admin/mission')).body;
  assert.match(page, /Draft for review/);
  assert.match(page, /doughnut economics/);
  assert.match(page, /shared stewardship/);
  assert.match((await people.boss.c.get('/admin')).body, /href="\/admin\/mission"/);
});

test('QA: many parks save; the suggester\'s words survive approval; clicks only count where it shows, not for bots; the form keeps its city', async () => {
  const { app, db, people, park, city, add } = await world();
  const boss = people.boss.c;
  // Every St. Pete park ticked (100+ checkboxes) still saves.
  const all = db.prepare("SELECT id FROM parks WHERE city_id = (SELECT id FROM city_themes WHERE key = 'st-pete')").pluck().all();
  assert.ok(all.length > 60);
  await boss.get('/admin/nonprofits/new');
  const csrf = [...boss.jar].find(([k]) => k.endsWith('pp_csrf'))[1];
  const fd = new FormData();
  for (const [k, v] of Object.entries({ _csrf: csrf, name: 'Big Tent', url: 'https://tent.example.org', mission: 'm', reason: 'local', city_id: String(city('st-pete')), status: 'active' })) fd.append(k, v);
  for (const id of all) fd.append('parks', String(id));
  const req = new Request('http://test.local/', { method: 'POST', body: fd });
  const res = await app.inject({ method: 'POST', url: '/admin/nonprofits/new', payload: Buffer.from(await req.arrayBuffer()),
    headers: { cookie: [...boss.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': req.headers.get('content-type') } });
  assert.equal(res.statusCode, 303);
  const tent = db.prepare("SELECT id FROM nonprofits WHERE name = 'Big Tent'").pluck().get();
  assert.equal(db.prepare('SELECT COUNT(*) FROM nonprofit_parks WHERE nonprofit_id = ?').pluck().get(tent), all.length);
  // "Local nonprofit" isn't said twice.
  assert.match((await people.ana.c.get('/st-pete/parks/a-park')).body, /<p class="spotlight-label">Local nonprofit<\/p>/);

  // A suggestion keeps the suggester's words after an admin saves it.
  await people.ana.c.get('/nonprofits/suggest?city=st-pete');
  await people.ana.c.post('/nonprofits/suggest', { name: 'Pond Pals', url: 'https://pond.example.org', mission: 'Pond care.', serves: 'The pond at A Park', reason: 'steward', city: 'st-pete' });
  const sid = db.prepare("SELECT id FROM nonprofits WHERE name = 'Pond Pals'").pluck().get();
  await boss.postMultipart(`/admin/nonprofits/${sid}`, { name: 'Pond Pals', url: 'https://pond.example.org', mission: 'Pond care.', reason: 'steward', city_id: String(city('st-pete')), status: 'active' });
  assert.equal(db.prepare('SELECT serves FROM nonprofits WHERE id = ?').pluck().get(sid), 'The pond at A Park');

  // Clicks: only for a park it can show on; crawlers aren't counted (but still redirected).
  const a = park('a-park');
  const b = park('b-park');
  const only = add({ name: 'Only A', url: 'https://only.example.org', parks: [a.id] });
  await client(app).get(`/go/nonprofit/${only}?park=${b.id}`);
  const bot = await app.inject({ method: 'GET', url: `/go/nonprofit/${only}?park=${a.id}`, headers: { 'user-agent': 'Googlebot/2.1' } });
  assert.equal(bot.statusCode, 302);
  assert.equal(db.prepare('SELECT COALESCE(SUM(clicks), 0) FROM nonprofit_stats WHERE nonprofit_id = ?').pluck().get(only), 0);
  await client(app).get(`/go/nonprofit/${only}?park=${a.id}`);
  assert.equal(db.prepare('SELECT SUM(clicks) FROM nonprofit_stats WHERE nonprofit_id = ?').pluck().get(only), 1);

  // A suggestion goes to the city its form was for, even if another tab switched city since.
  await people.ana.c.get('/westminster/parks'); // remembers Westminster
  await people.ana.c.post('/nonprofits/suggest', { name: 'Tab Two', url: 'https://tab.example.org', mission: 'x', serves: 'y', reason: 'local', city: 'st-pete' });
  assert.equal(db.prepare("SELECT c.key FROM nonprofits n JOIN city_themes c ON c.id = n.city_id WHERE n.name = 'Tab Two'").pluck().get(), 'st-pete');
});
