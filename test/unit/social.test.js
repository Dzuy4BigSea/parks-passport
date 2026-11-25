// M18: bot protection on sign-up, profile photos, "your pals were here" and Admin › Stats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { createRateLimiter } from '../../src/lib/rate-limit.js';
import { avatarPath } from '../../src/lib/images.js';

const PW = 'correct horse battery';

async function world() {
  const now = testClock('2026-06-06T16:00:00Z');
  const made = makeApp({ now });
  importParksCsv(made.db, [PARK_CSV_COLUMNS.join(','),
    'a-park,A Park,,,27.80,-82.70,,,,0', 'b-park,B Park,,,27.81,-82.71,,,,0'].join('\n'));
  const people = {};
  for (const name of ['ana', 'ben', 'cat']) {
    const c = client(made.app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: made.db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  const befriend = async (a, b) => {
    const link = (await people[a].c.get('/pals')).body.match(/\/pals\/invite\/[A-Za-z0-9_-]+/)[0];
    return people[b].c.post(`${link}/accept`);
  };
  const setVis = (who, v) => people[who].c.post('/account/visibility', { default_visibility: v });
  return { ...made, now, people, befriend, setVis };
}

// A JPEG with GPS EXIF, like a phone photo.
const phonePhoto = () => sharp({ create: { width: 900, height: 600, channels: 3, background: '#3a7d44' } }).jpeg()
  .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '27/1 48/1 2340/100' } }).toBuffer();

const from = (app, ip, c, url, fields) => app.inject({
  method: 'POST', url, payload: new URLSearchParams({ _csrf: [...c.jar].find(([k]) => k.endsWith('pp_csrf'))[1], ...fields }).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip, cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
});

test('sign-up: the hidden trap field creates no account; 5 sign-ups an hour per connection; sign-in and reset emails too', async () => {
  const { app, db, mailer } = makeApp();
  const c = client(app);
  await c.get('/signup');
  assert.match((await c.get('/signup')).body, /<div class="hp" aria-hidden="true">.*name="website"[^>]*tabindex="-1"/s);
  const bot = await c.post('/signup', { display_name: 'Bot', email: 'bot@example.com', password: PW, website: 'http://spam.example' });
  assert.equal(bot.statusCode, 303);
  assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 0);

  for (let i = 0; i < 5; i++) {
    const r = await from(app, '203.0.113.9', c, '/signup', { display_name: `P${i}`, email: `p${i}@example.com`, password: PW });
    assert.equal(r.statusCode, 303, `sign-up ${i}`);
  }
  const sixth = await from(app, '203.0.113.9', c, '/signup', { display_name: 'P6', email: 'p6@example.com', password: PW });
  assert.equal(sixth.statusCode, 429);
  assert.match(sixth.body, /Too many sign-ups from this connection/);
  assert.equal((await from(app, '198.51.100.4', c, '/signup', { display_name: 'Q', email: 'q@example.com', password: PW })).statusCode, 303);
  assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 6);

  for (let i = 0; i < 5; i++) await from(app, '203.0.113.20', c, '/login/magic', { magic_email: 'p0@example.com' });
  const sent = mailer.sent.length;
  assert.equal((await from(app, '203.0.113.20', c, '/forgot', { email: 'p0@example.com' })).statusCode, 429);
  assert.equal(mailer.sent.length, sent);
  // Local and private addresses (dev, tests) are never limited.
  const local = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.ok(local.hit('127.0.0.1') && local.hit('127.0.0.1') && local.hit('10.0.0.2') && local.hit('10.0.0.2'));
  const clock = { t: 0 };
  const lim = createRateLimiter({ limit: 1, windowMs: 1000, now: () => clock.t });
  assert.ok(lim.hit('8.8.8.8'));
  assert.ok(!lim.hit('8.8.8.8'));
  clock.t = 1001;
  assert.ok(lim.hit('8.8.8.8'));
});

test('profile photo: re-encoded 256 px square with no EXIF; seen by whoever can see the passport; replace and delete remove files', async () => {
  const { app, db, uploadsDir, people, befriend, setVis } = await world();
  const { ana, ben, cat } = people;
  const bad = await ana.c.postMultipart('/account/avatar', {}, { photo: { buffer: Buffer.from('not an image'), filename: 'x.jpg', type: 'image/jpeg' } });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.body, /not a photo we can read/);
  const up = await ana.c.postMultipart('/account/avatar', {}, { photo: { buffer: await phonePhoto(), filename: 'me.jpg', type: 'image/jpeg' } });
  assert.equal(up.headers.location, '/account?done=avatar#photo');
  const key = db.prepare('SELECT avatar_key FROM users WHERE id = ?').pluck().get(ana.id);
  const file = avatarPath(uploadsDir, key);
  const meta = await sharp(file).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format, meta.exif], [256, 256, 'jpeg', undefined]);
  const url = `/avatars/${ana.id}/${key}.jpg`;
  assert.match((await ana.c.get('/account')).body, new RegExp(`src="${url}"`));
  assert.equal((await ana.c.get(url)).statusCode, 200);
  // Private passport (the default): only Ana. 404 (never 403) for everyone else.
  assert.equal((await ben.c.get(url)).statusCode, 404);
  assert.equal((await client(app).get(url)).statusCode, 404);
  await befriend('ana', 'ben');
  await setVis('ana', 'pals');
  assert.equal((await ben.c.get(url)).statusCode, 200);
  assert.equal((await cat.c.get(url)).statusCode, 404);
  assert.match((await ben.c.get('/pals')).body, new RegExp(`src="${url}"`));
  await setVis('ana', 'public');
  assert.equal((await client(app).get(url)).statusCode, 200);
  assert.equal((await client(app).get(`/avatars/${ana.id}/${'0'.repeat(32)}.jpg`)).statusCode, 404); // an old key
  // Replace: the old file goes. Remove: initials again.
  await ana.c.postMultipart('/account/avatar', {}, { photo: { buffer: await phonePhoto(), filename: 'me2.jpg', type: 'image/jpeg' } });
  assert.ok(!fs.existsSync(file));
  const key2 = db.prepare('SELECT avatar_key FROM users WHERE id = ?').pluck().get(ana.id);
  await ana.c.post('/account/avatar/delete');
  assert.equal(db.prepare('SELECT avatar_key FROM users WHERE id = ?').pluck().get(ana.id), null);
  assert.ok(!fs.existsSync(avatarPath(uploadsDir, key2)));
  assert.match((await ana.c.get('/account')).body, /class="avatar avatar-lg avatar-initials"/);
  // Deleting the account removes the photo file.
  await ana.c.postMultipart('/account/avatar', {}, { photo: { buffer: await phonePhoto(), filename: 'me3.jpg', type: 'image/jpeg' } });
  const key3 = db.prepare('SELECT avatar_key FROM users WHERE id = ?').pluck().get(ana.id);
  await ana.c.post('/account/delete', { delete_password: PW });
  assert.ok(!fs.existsSync(path.join(uploadsDir, 'avatars', `${key3}.jpg`)));
});

test('"your pals were here": park cards, a filter and the park page show pals who share their passport, never private ones', async () => {
  const { app, people, befriend, setVis } = await world();
  const { ana, ben, cat } = people;
  await befriend('ana', 'ben');
  await befriend('ana', 'cat');
  await ben.c.post('/st-pete/parks/a-park/stamp', {});
  await cat.c.post('/st-pete/parks/a-park/stamp', {});
  await cat.c.post('/st-pete/parks/b-park/stamp', {});
  // Both private (the default): nothing shows.
  let list = (await ana.c.get('/st-pete/parks')).body;
  assert.doesNotMatch(list, /stamped this/);
  await setVis('ben', 'pals');
  list = (await ana.c.get('/st-pete/parks')).body;
  assert.match(list, /ben stamped this/);
  assert.doesNotMatch(list, /cat/); // cat's passport is still private
  await setVis('cat', 'public');
  list = (await ana.c.get('/st-pete/parks')).body;
  assert.match(list, /ben and cat stamped this|cat and ben stamped this/);
  assert.match(list, /name="pals" value="1"/);
  const only = (await ana.c.get('/st-pete/parks?pals=1')).body;
  assert.match(only, /A Park/);
  assert.match(only, /B Park/);
  const park = (await ana.c.get('/st-pete/parks/a-park')).body;
  assert.match(park, /class="card pals-here"/);
  assert.match(park, /href="\/u\/ben"/);
  // Not pals, signed out, or the stamper themself: no pal faces.
  assert.doesNotMatch((await client(app).get('/st-pete/parks/a-park')).body, /pals-here/);
  assert.doesNotMatch((await ben.c.get('/st-pete/parks/a-park')).body, /class="card pals-here"/);
  // Ben and Cat aren't pals: Cat's public stamps never show on Ben's cards.
  assert.doesNotMatch((await ben.c.get('/st-pete/parks')).body, /cat stamped this|cat and/);
});

test('Admin › Stats: counts for admins only (404 otherwise), with no names or emails', async () => {
  const { app, db, people } = await world();
  await people.ben.c.post('/st-pete/parks/a-park/stamp', {});
  await people.cat.c.post('/st-pete/parks/a-park/stamp', {});
  await people.cat.c.post('/st-pete/parks/b-park/stamp', {});
  assert.equal((await people.ana.c.get('/admin/stats')).statusCode, 404);
  assert.equal((await client(app).get('/admin/stats')).statusCode, 404);
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.ana.id);
  const res = await people.ana.c.get('/admin/stats');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<strong>3<\/strong><span>check-ins in the last 7 days/);
  assert.match(res.body, /<strong>2<\/strong><span>members who stamped in 7 days/);
  assert.match(res.body, /A Park \(St\. Petersburg\)<\/th>\s*<td><span class="stat-bar"[^>]*><\/span>2<\/td>/);
  assert.match(res.body, /Honor system/);
  assert.doesNotMatch(res.body, /@example\.com|>ben<|>cat</);
  assert.match((await people.ana.c.get('/admin')).body, /href="\/admin\/stats"/);
});
