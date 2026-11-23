import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { seedBadgesIfEmpty, awardBadges } from '../../src/domain/badges/index.js';
import { badgeArtPath } from '../../src/lib/images.js';

const PW = 'correct horse battery';
const CSV = [PARK_CSV_COLUMNS.join(','),
  'a-park,A Park,1 Main St,,27.80,-82.70,,playground,,0',
  'b-park,B Park,,,,,,,,1'].join('\n') + '\n';

async function world() {
  const now = testClock('2026-06-06T16:00:00Z');
  const { app, db, uploadsDir } = makeApp({ now });
  importParksCsv(db, CSV);
  seedBadgesIfEmpty(db, [{ slug: 'first', name: 'First Stamp', kind: 'known', rule_type: 'parks_count', rule_params: { n: 1 } }]);
  const people = {};
  for (const name of ['admin', 'member']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.admin.id);
  return { app, db, now, uploadsDir, people, admin: people.admin.c, member: people.member.c };
}

const ADMIN_PAGES = ['/admin', '/admin/parks', '/admin/parks/new', '/admin/parks/1', '/admin/import',
  '/admin/badges', '/admin/badges/new', '/admin/badges/1', '/admin/moderation', '/admin/users'];

test('admin pages are 404 for members and signed-out visitors, 200 for admins', async () => {
  const { app, admin, member } = await world();
  for (const url of ADMIN_PAGES) {
    assert.equal((await member.get(url)).statusCode, 404, `member ${url}`);
    assert.equal((await client(app).get(url)).statusCode, 404, `anon ${url}`);
    assert.equal((await admin.get(url)).statusCode, 200, `admin ${url}`);
  }
  // POSTs too (with a valid CSRF token).
  assert.equal((await member.post('/admin/parks/1', { name: 'Hacked', slug: 'a-park' })).statusCode, 404);
  assert.equal((await member.post('/admin/users/1/admin', { admin: '1' })).statusCode, 404);
  assert.equal((await member.postMultipart('/admin/import', {}, { csv: { buffer: Buffer.from(CSV), filename: 'p.csv' } })).statusCode, 404);
  assert.match((await admin.get('/parks')).body, /href="\/admin"/);
  assert.ok(!(await member.get('/parks')).body.includes('href="/admin"'));
});

test('edit a park: pin, radius, categories; saving coordinates can clear "needs a pin check"', async () => {
  const { db, admin } = await world();
  const id = db.prepare("SELECT id FROM parks WHERE slug = 'b-park'").pluck().get();
  const res = await admin.post(`/admin/parks/${id}`, {
    name: 'B Park', slug: 'b-park', address: '2 Side St', phone: '', lat: '27.81', lng: '-82.71',
    checkin_radius_m: '300', categories: 'dog-park', city_url: 'https://example.org/b', active: '1',
  });
  assert.equal(res.statusCode, 303);
  const p = db.prepare('SELECT * FROM parks WHERE id = ?').get(id);
  assert.deepEqual({ lat: p.lat, lng: p.lng, r: p.checkin_radius_m, pin: p.needs_pin, addr: p.address },
    { lat: 27.81, lng: -82.71, r: 300, pin: 0, addr: '2 Side St' });
  assert.deepEqual(db.prepare('SELECT category FROM park_categories WHERE park_id = ?').pluck().all(id), ['dog-park']);
});

test('park form validation: bad coordinates, duplicate slug, bad URL are refused with the typed values kept', async () => {
  const { db, admin } = await world();
  const id = db.prepare("SELECT id FROM parks WHERE slug = 'a-park'").pluck().get();
  const cases = [
    [{ lat: '40.7', lng: '-74.0' }, /outside St\. Petersburg/],
    [{ slug: 'b-park' }, /Another park already uses that slug/],
    [{ city_url: 'http://insecure.example' }, /must start with https/],
    [{ checkin_radius_m: '5' }, /25 to 2000/],
  ];
  for (const [change, msg] of cases) {
    const res = await admin.post(`/admin/parks/${id}`, { name: 'A Park Typed', slug: 'a-park', lat: '27.80', lng: '-82.70', active: '1', ...change });
    assert.equal(res.statusCode, 422, JSON.stringify(change));
    assert.match(res.body, msg);
    assert.match(res.body, /value="A Park Typed"/);
  }
  assert.equal(db.prepare('SELECT name FROM parks WHERE id = ?').pluck().get(id), 'A Park');
});

test('create a park, and deactivating hides it from lists and N but keeps stamps', async () => {
  const { db, admin, member } = await world();
  const res = await admin.post('/admin/parks/new', { name: 'New Park', slug: 'new-park', lat: '27.79', lng: '-82.66', active: '1' });
  assert.equal(res.statusCode, 303);
  assert.match((await member.get('/parks')).body, /New Park/);
  await member.post('/parks/new-park/stamp', {});
  const id = db.prepare("SELECT id FROM parks WHERE slug = 'new-park'").pluck().get();
  await admin.post(`/admin/parks/${id}`, { name: 'New Park', slug: 'new-park', lat: '27.79', lng: '-82.66' }); // active unticked
  assert.ok(!(await member.get('/parks')).body.includes('New Park'));
  assert.equal((await member.get('/parks/new-park')).statusCode, 404);
  assert.match((await member.get('/passport')).body, /0 of 2 parks stamped/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM visits WHERE park_id = ?').pluck().get(id), 1);
});

test('CSV import: counts and invalid rows; importing the same file twice changes nothing', async () => {
  const { db, admin } = await world();
  const file = [PARK_CSV_COLUMNS.join(','),
    'a-park,A Park Renamed,1 Main St,,27.80,-82.70,,playground,,0',
    'c-park,C Park,,,27.79,-82.65,,,,0',
    'Bad Slug,Oops,,,27.79,-82.65,,,,0'].join('\n');
  const up = () => admin.postMultipart('/admin/import', {}, { csv: { buffer: Buffer.from(file), filename: 'parks.csv', type: 'text/csv' } });
  const first = await up();
  assert.match(first.body, /1 added, 1 updated, 0 unchanged, 1 invalid\./);
  assert.match(first.body, /Line 4 \(Bad Slug\): slug must be lowercase/);
  const before = db.prepare('SELECT * FROM parks ORDER BY id').all();
  const second = await up();
  assert.match(second.body, /0 added, 0 updated, 2 unchanged, 1 invalid\./);
  assert.deepEqual(db.prepare('SELECT * FROM parks ORDER BY id').all(), before);
  const seed = await admin.post('/admin/import/seed', {});
  assert.match(seed.body, /102 added/);
});

test('badge create, edit and disable: disabled badges stop new awards and stay earned', async () => {
  const { db, admin, people, now } = await world();
  const res = await admin.postMultipart('/admin/badges/new', {
    name: 'Two Parks', slug: 'two-parks', description: 'Stamp 2 parks', hint: '', art: '✌️',
    rule_type: 'parks_count', param_n: '2', param_category: 'beach', kind: 'known', enabled: '1',
  });
  assert.equal(res.statusCode, 303);
  const badge = db.prepare("SELECT * FROM badges WHERE slug = 'two-parks'").get();
  assert.deepEqual(JSON.parse(badge.rule_params), { n: 2 }); // unused params are dropped

  // Disable "First Stamp": stamping no longer awards it.
  const first = db.prepare("SELECT * FROM badges WHERE slug = 'first'").get();
  await admin.postMultipart(`/admin/badges/${first.id}`, { name: first.name, description: '', hint: '', art: '🌱', rule_type: 'parks_count', param_n: '1', kind: 'known' });
  assert.equal(db.prepare('SELECT enabled FROM badges WHERE id = ?').pluck().get(first.id), 0);
  await people.member.c.post('/parks/a-park/stamp', {});
  await people.member.c.post('/parks/b-park/stamp', {});
  const earned = () => db.prepare('SELECT b.slug FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ? ORDER BY b.slug')
    .pluck().all(people.member.id);
  assert.deepEqual(earned(), ['two-parks']);

  // Re-enable, award, then disable again: the member keeps it.
  db.prepare('UPDATE badges SET enabled = 1 WHERE id = ?').run(first.id);
  awardBadges(db, people.member.id, { type: 'recheck' }, { now: now() });
  db.prepare('UPDATE badges SET enabled = 0 WHERE id = ?').run(first.id);
  assert.deepEqual(earned(), ['first', 'two-parks']);
  assert.match((await people.member.c.get('/passport')).body, /First Stamp/);
});

test('badge validation: params per rule, lucky pairing, hints, duplicate slug', async () => {
  const { db, admin } = await world();
  const base = { name: 'X', slug: 'x-badge', art: '⭐', kind: 'known', enabled: '1' };
  const cases = [
    [{ rule_type: 'parks_count', param_n: '0' }, /whole number from 1 to 1000/],
    [{ rule_type: 'category_count', param_n: '2', param_category: 'moon' }, /Choose an amenity/],
    [{ rule_type: 'time_of_day', param_start: '25:00', param_end: '07:00' }, /time like 06:30/],
    [{ rule_type: 'lucky', param_probability: '0.1' }, /Lucky badges use the/],
    [{ rule_type: 'parks_count', param_n: '2', kind: 'hidden' }, /need a hint/],
    [{ rule_type: 'parks_count', param_n: '2', slug: 'first' }, /Another badge already uses that slug/],
    [{ rule_type: 'nope' }, /Choose a rule/],
  ];
  for (const [change, msg] of cases) {
    const res = await admin.postMultipart('/admin/badges/new', { ...base, ...change });
    assert.equal(res.statusCode, 422, JSON.stringify(change));
    assert.match(res.body, msg, JSON.stringify(change));
  }
  assert.equal(db.prepare('SELECT COUNT(*) FROM badges').pluck().get(), 1);
  const lucky = await admin.postMultipart('/admin/badges/new', { ...base, slug: 'lucky-x', kind: 'lucky', hint: 'Luck', rule_type: 'lucky', param_probability: '0.1' });
  assert.equal(lucky.statusCode, 303);
});

test('uploaded badge art (SVG with script) is rasterized to PNG and served as an image', async () => {
  const { db, admin, uploadsDir, member } = await world();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><circle cx="32" cy="32" r="30" fill="#f2c14e"/></svg>');
  const res = await admin.postMultipart('/admin/badges/new',
    { name: 'Sun', slug: 'sun', art: '', rule_type: 'parks_count', param_n: '3', kind: 'known', enabled: '1' },
    { art_file: { buffer: svg, filename: 'sun.svg', type: 'image/svg+xml' } });
  assert.equal(res.statusCode, 303);
  const art = db.prepare("SELECT art FROM badges WHERE slug = 'sun'").pluck().get();
  const key = /^upload:([a-f0-9]{24})$/.exec(art)[1];
  const file = fs.readFileSync(badgeArtPath(uploadsDir, key));
  const meta = await sharp(file).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 128, 128]);
  assert.ok(!file.includes(Buffer.from('script')));
  const served = await member.get(`/badge-art/${key}.png`);
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers['content-type'], 'image/png');
  assert.equal((await member.get('/badge-art/../../etc/passwd')).statusCode, 404);
  // Editing without a new emoji or file keeps the uploaded art.
  const id = db.prepare("SELECT id FROM badges WHERE slug = 'sun'").pluck().get();
  await admin.postMultipart(`/admin/badges/${id}`, { name: 'Sunny', art: '', rule_type: 'parks_count', param_n: '3', kind: 'known', enabled: '1' });
  assert.equal(db.prepare('SELECT art FROM badges WHERE id = ?').pluck().get(id), art);
  assert.match((await member.get('/passport')).body, new RegExp(`/badge-art/${key}\\.png`));
  // Non-image files are refused.
  const bad = await admin.postMultipart('/admin/badges/new', { name: 'B', slug: 'b-art', rule_type: 'parks_count', param_n: '3', kind: 'known' },
    { art_file: { buffer: Buffer.from('GIF89a nope'), filename: 'a.gif' } });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.body, /Use an SVG or PNG image/);
});

test('moderation: hide and unhide a shared photo and review comment', async () => {
  const { db, admin, people, app } = await world();
  const jpeg = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#2f6f4e' } }).jpeg().toBuffer();
  await people.member.c.postMultipart('/parks/a-park/photos', { caption: 'Shared', visibility: 'public' },
    { photo: { buffer: jpeg, filename: 'a.jpg', type: 'image/jpeg' } });
  await people.member.c.post('/parks/a-park/rating', { stars: '1', comment: 'Mean comment', visibility: 'public' });
  await people.member.c.post('/parks/b-park/rating', { stars: '5', comment: 'Private note', visibility: 'private' });
  const queue = (await admin.get('/admin/moderation')).body;
  assert.match(queue, /Shared/);
  assert.match(queue, /Mean comment/);
  assert.ok(!queue.includes('Private note'), 'private reviews are not in the queue');
  const photoId = db.prepare('SELECT id FROM photos').pluck().get();
  const ratingId = db.prepare("SELECT id FROM ratings WHERE comment = 'Mean comment'").pluck().get();
  await admin.post(`/admin/photos/${photoId}/hidden`, { hidden: '1', back: '/admin/moderation' });
  await admin.post(`/admin/reviews/${ratingId}/hidden`, { hidden: '1', back: '/admin/moderation' });
  const anon = client(app);
  assert.equal((await anon.get(`/photos/${photoId}/full`)).statusCode, 404);
  const page = (await anon.get('/parks/a-park')).body;
  assert.ok(!page.includes('Mean comment'));
  assert.match(page, /<strong>1\.0<\/strong> out of 5/); // stars still count
  await admin.post(`/admin/photos/${photoId}/hidden`, { hidden: '0', back: '/admin/moderation' });
  await admin.post(`/admin/reviews/${ratingId}/hidden`, { hidden: '0', back: '/admin/moderation' });
  assert.equal((await anon.get(`/photos/${photoId}/full`)).statusCode, 200);
  assert.match((await anon.get('/parks/a-park')).body, /Mean comment/);
});

test('promote and demote members; an admin cannot demote themselves', async () => {
  const { db, admin, people } = await world();
  await admin.post(`/admin/users/${people.member.id}/admin`, { admin: '1' });
  assert.equal(db.prepare('SELECT is_admin FROM users WHERE id = ?').pluck().get(people.member.id), 1);
  assert.equal((await people.member.c.get('/admin')).statusCode, 200);
  const self = await admin.post(`/admin/users/${people.admin.id}/admin`, { admin: '0' });
  assert.equal(self.statusCode, 422);
  assert.match(self.body, /can&#39;t remove your own admin access/);
  assert.equal(db.prepare('SELECT is_admin FROM users WHERE id = ?').pluck().get(people.admin.id), 1);
  await admin.post(`/admin/users/${people.member.id}/admin`, { admin: '0' });
  assert.equal((await people.member.c.get('/admin')).statusCode, 404);
});
