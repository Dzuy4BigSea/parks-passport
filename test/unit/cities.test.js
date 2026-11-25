// Multi-city (SPEC Flow 13): city packs, city URLs, per-city time zones, city and travel badges,
// the nearest-city suggestion and the admin city bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { makeApp, client, testClock } from './helpers.js';
import { migrate } from '../../src/db/index.js';
import { seedBadges, seedCities, cityPackKeys, CITIES_DIR } from '../../src/db/seed.js';
import { seedCityPack, cityByKey, listCities, nearestCity, RESERVED_CITY_KEYS } from '../../src/domain/city.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { isPublicIp, createGeoIp } from '../../src/lib/geoip.js';
import { parseCsv } from '../../src/lib/csv.js';
import { sanitizeSvg } from '../../src/lib/svg-sanitize.js';

const PW = 'correct horse battery';
const SIGLER = { lat: 33.757335, lng: -118.002137 }; // Westminster
const ABERCROMBIE = { lat: 27.8065, lng: -82.75531 }; // St. Pete

function citiesApp(opts = {}) {
  const made = makeApp(opts);
  seedBadges(made.db);
  seedCities(made.db);
  return made;
}

async function member(app, email = 'sam@example.com') {
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email, password: PW });
  return c;
}

test('city packs: every pack is valid, keys are free, parks are inside the city, motifs pass the sanitizer', () => {
  const keys = cityPackKeys();
  assert.ok(['st-pete', 'westminster', 'asheville'].every((k) => keys.includes(k)));
  for (const key of keys) {
    const pack = JSON.parse(fs.readFileSync(path.join(CITIES_DIR, key, 'city.json'), 'utf8'));
    assert.equal(pack.key, key);
    assert.ok(!RESERVED_CITY_KEYS.has(key), key);
    for (const m of pack.motifs) assert.ok(sanitizeSvg(m.svg), `${key}/${m.slug}`);
    const rows = parseCsv(fs.readFileSync(path.join(CITIES_DIR, key, 'parks.csv'), 'utf8'));
    const b = pack.bounds;
    for (const r of rows.filter((x) => x.lat)) {
      assert.ok(+r.lat >= b.minLat && +r.lat <= b.maxLat && +r.lng >= b.minLng && +r.lng <= b.maxLng, `${key}/${r.slug}`);
    }
  }
  assert.throws(() => seedCityPack(makeApp().db, { key: 'parks', name: 'Nope' }), /already uses/);
  assert.throws(() => seedCityPack(makeApp().db, { key: 'x', name: 'X', time_zone: 'Mars/Olympus' }), /time zone/);
});

test('seedCities loads both cities once; admin theme edits stay, the pack\'s copy and time zone follow the file', () => {
  const { db } = citiesApp();
  const count = (sql, ...a) => db.prepare(sql).pluck().get(...a);
  const wm = cityByKey(db, 'westminster');
  assert.equal(wm.time_zone, 'America/Los_Angeles');
  assert.equal(count('SELECT COUNT(*) FROM parks WHERE city_id = ?', wm.id), 25);
  assert.equal(count('SELECT COUNT(*) FROM parks WHERE city_id = ?', cityByKey(db, 'st-pete').id), 102);
  assert.deepEqual(listCities(db).map((c) => c.key), ['st-pete', 'westminster', 'asheville']); // by sort
  assert.equal(count('SELECT COUNT(*) FROM parks WHERE city_id = ?', cityByKey(db, 'asheville').id), 68);
  db.prepare("UPDATE city_themes SET tagline = 'Edited', copy = '{}' WHERE key = 'westminster'").run();
  const again = seedCities(db);
  assert.ok(again.every((c) => !c.motifs && !c.parks && !c.badges));
  const reloaded = cityByKey(db, 'westminster');
  assert.equal(reloaded.tagline, 'Edited');
  assert.equal(reloaded.copy.short, 'Westminster');
  assert.equal(count("SELECT COUNT(*) FROM badges WHERE slug = 'two-cities'"), 1);
});

test('migration 014 keeps every visit, photo and rating, and puts the existing parks in St. Pete', () => {
  const dir = path.join(import.meta.dirname, '..', '..', 'src', 'db', 'migrations');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && x < '014').sort()) {
    db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(f, 'x');
  }
  db.prepare("INSERT INTO city_themes (key, name, active, updated_at) VALUES ('st-pete', 'St. Petersburg', 1, 'x')").run();
  for (const s of ['a-park', 'b-park']) db.prepare("INSERT INTO parks (slug, name, created_at, updated_at) VALUES (?, ?, 'x', 'x')").run(s, s);
  db.prepare("INSERT INTO users (email, display_name, handle, created_at) VALUES ('a@b.c', 'A', 'a', 'x')").run();
  db.prepare("INSERT INTO visits (user_id, park_id, visited_on, visited_at, method, created_at) VALUES (1, 2, '2026-01-02', 'x', 'honor', 'x')").run();
  db.prepare("INSERT INTO photos (user_id, park_id, visit_id, file_key, width, height, visibility, created_at) VALUES (1, 2, 1, 'k', 1, 1, 'private', 'x')").run();
  db.prepare("INSERT INTO ratings (user_id, park_id, stars, visibility, created_at, updated_at) VALUES (1, 2, 4, 'private', 'x', 'x')").run();
  db.prepare("INSERT INTO badges (slug, name, rule_type, kind, created_at) VALUES ('every-park', 'E', 'all_parks', 'known', 'x'), ('first-stamp', 'F', 'parks_count', 'known', 'x')").run();
  migrate(db);
  const one = (sql) => db.prepare(sql).pluck().get();
  assert.equal(one('SELECT COUNT(*) FROM visits') + one('SELECT COUNT(*) FROM photos') + one('SELECT COUNT(*) FROM ratings'), 3);
  assert.equal(one('SELECT p.slug FROM visits v JOIN parks p ON p.id = v.park_id'), 'b-park');
  assert.equal(one("SELECT COUNT(*) FROM parks WHERE city_id = (SELECT id FROM city_themes WHERE key = 'st-pete')"), 2);
  assert.equal(one("SELECT city_id IS NOT NULL FROM badges WHERE slug = 'every-park'"), 1);
  assert.equal(one("SELECT city_id IS NULL FROM badges WHERE slug = 'first-stamp'"), 1);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  // Slugs are unique per city now, not across cities.
  db.prepare("INSERT INTO city_themes (key, name, active, updated_at) VALUES ('elsewhere', 'Elsewhere', 1, 'x')").run();
  db.prepare("INSERT INTO parks (city_id, slug, name, created_at, updated_at) VALUES (2, 'a-park', 'A', 'x', 'x')").run();
  assert.throws(() => db.prepare("INSERT INTO parks (city_id, slug, name, created_at, updated_at) VALUES (2, 'a-park', 'A', 'x', 'x')").run(), /UNIQUE/);
});

test('city URLs: each city lists its own parks; old URLs redirect; unknown cities and wrong-city slugs are 404', async () => {
  const { app } = citiesApp();
  const c = client(app);
  const wm = await c.get('/westminster/parks');
  assert.equal(wm.statusCode, 200);
  assert.match(wm.body, /<h1>Westminster parks<\/h1>/);
  assert.match(wm.body, /href="\/westminster\/parks\/sigler-park"/);
  assert.doesNotMatch(wm.body, /abercrombie-park/);
  assert.equal((await c.get('/westminster/parks/sigler-park')).statusCode, 200);
  assert.equal((await c.get('/st-pete/parks/sigler-park')).statusCode, 404);
  assert.equal((await c.get('/atlantis/parks')).statusCode, 404);
  assert.equal((await c.get('/atlantis')).statusCode, 404);
  const old = await client(app).get('/parks/abercrombie-park?x=1');
  assert.equal(old.statusCode, 301);
  assert.equal(old.headers.location, '/st-pete/parks/abercrombie-park?x=1');
  assert.equal((await client(app).get('/parks/sigler-park')).headers.location, '/westminster/parks/sigler-park');
  assert.equal((await client(app).get('/parks/no-such-park')).statusCode, 404);
});

test('the city you last looked at is remembered: home, /parks and /passport follow it', async () => {
  const { app } = citiesApp();
  const c = client(app);
  assert.match((await c.get('/')).body, /Your passport to St\. Pete parks/);
  const wm = await c.get('/westminster');
  assert.match(wm.body, /Your passport to Westminster parks/);
  assert.match(wm.body, /Not affiliated with the City of Westminster/);
  assert.match(wm.body, /href="\/westminster\/parks">Parks</);
  assert.ok(wm.cookies.some((k) => k.name === 'pp_city' && k.value === 'westminster' && k.httpOnly));
  assert.match((await c.get('/')).body, /Your passport to Westminster parks/);
  assert.equal((await c.get('/parks?q=sig')).headers.location, '/westminster/parks?q=sig');
  // A slug that exists in both cities: the old URL goes to the remembered city's park.
  importParksCsv(app.db, [PARK_CSV_COLUMNS.join(','), 'liberty-park,Liberty Park,,,27.79,-82.66,,,,0'].join('\n'));
  assert.equal((await c.get('/parks/liberty-park')).headers.location, '/westminster/parks/liberty-park');
  assert.equal((await client(app).get('/parks/liberty-park')).headers.location, '/st-pete/parks/liberty-park');
  const sam = await member(app);
  assert.equal((await sam.get('/passport')).headers.location, '/st-pete/passport');
  await sam.get('/westminster/parks');
  assert.equal((await sam.get('/passport')).headers.location, '/westminster/passport');
});

test('"today" for a stamp is today where the park is; Early Bird reads the park\'s local clock', async () => {
  // 2026-06-02 05:30 UTC is 10:30 pm on June 1 in Westminster and 1:30 am on June 2 in St. Pete.
  const { app, db } = citiesApp({ now: testClock('2026-06-02T05:30:00Z') });
  const sam = await member(app);
  await sam.post('/westminster/parks/sigler-park/checkin', { lat: SIGLER.lat, lng: SIGLER.lng, accuracy: '10' });
  await sam.post('/st-pete/parks/abercrombie-park/checkin', { lat: ABERCROMBIE.lat, lng: ABERCROMBIE.lng, accuracy: '10' });
  assert.deepEqual(db.prepare('SELECT p.slug, v.visited_on FROM visits v JOIN parks p ON p.id = v.park_id ORDER BY v.id').raw().all(),
    [['sigler-park', '2026-06-01'], ['abercrombie-park', '2026-06-02']]);

  // 13:00 UTC is 6 am in Westminster (Early Bird) but 9 am in St. Pete (not).
  const early = citiesApp({ now: testClock('2026-06-03T13:00:00Z') });
  const pat = await member(early.app, 'pat@example.com');
  await pat.post('/st-pete/parks/abercrombie-park/checkin', { lat: ABERCROMBIE.lat, lng: ABERCROMBIE.lng, accuracy: '10' });
  const has = (slug) => Boolean(early.db.prepare('SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE b.slug = ?').get(slug));
  assert.ok(!has('early-bird'));
  await pat.post('/westminster/parks/sigler-park/checkin', { lat: SIGLER.lat, lng: SIGLER.lng, accuracy: '10' });
  assert.ok(has('early-bird'));
});

test('city badges count only their city; Two-City Explorer needs stamps in two cities; boards show the city\'s badges', async () => {
  const { app, db } = citiesApp();
  const wm = cityByKey(db, 'westminster');
  // Leave Westminster with two active parks so "every park" is in reach.
  db.prepare("UPDATE parks SET active = 0 WHERE city_id = ? AND slug NOT IN ('sigler-park', 'liberty-park')").run(wm.id);
  const sam = await member(app);
  const earned = () => db.prepare(`SELECT b.slug FROM user_badges ub JOIN badges b ON b.id = ub.badge_id ORDER BY b.slug`).pluck().all();
  await sam.post('/westminster/parks/sigler-park/stamp', {});
  await sam.post('/westminster/parks/liberty-park/stamp', {});
  assert.ok(earned().includes('every-westminster-park'));
  assert.ok(!earned().includes('every-park') && !earned().includes('two-cities'));
  const board = (await sam.get('/westminster/passport')).body;
  assert.match(board, /Half of Westminster/);
  assert.doesNotMatch(board, /Half the City/); // St. Pete's, not earned
  assert.match(board, /Two-City Explorer/);
  await sam.post('/st-pete/parks/abercrombie-park/stamp', {});
  assert.ok(earned().includes('two-cities'));
  const sp = (await sam.get('/st-pete/passport')).body;
  assert.match(sp, /Half the City/);
  assert.match(sp, /Every Westminster Park/); // earned badges show everywhere
  assert.match(sp, /1 of 102 parks stamped/);
  assert.match(sp, /class="city-tabs"/);
  assert.match(sp, /href="\/westminster\/passport"/);
  assert.match(sp, /Westminster · /); // history says which city once there are two
});

test('nearest-city suggestion: from the IP (looked up locally), only on "/" and only before a city is chosen', async () => {
  assert.ok(isPublicIp('8.8.8.8') && !isPublicIp('127.0.0.1') && !isPublicIp('10.1.2.3') && !isPublicIp('192.168.0.9') && !isPublicIp('nope'));
  assert.equal(await createGeoIp({ file: '' }), null);
  assert.equal(await createGeoIp({ file: '/no/such/file.mmdb' }), null);
  const fake = await createGeoIp({ file: import.meta.filename, open: async () => ({ get: (ip) => ({
    '203.0.113.7': { location: { latitude: 33.75, longitude: -117.99 } }, // near Westminster
    '203.0.113.8': { location: { latitude: 51.5, longitude: -0.12 } }, // London
  })[ip] }) });
  assert.deepEqual(fake.lookup('203.0.113.7'), { lat: 33.75, lng: -117.99 });
  assert.equal(fake.lookup('127.0.0.1'), null);

  const { app, db } = citiesApp({ geoip: fake });
  assert.equal(nearestCity(db, { lat: 33.75, lng: -117.99 }).city.key, 'westminster');
  const from = (ip, c = client(app)) => app.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': ip, cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
  const near = await from('203.0.113.7');
  assert.match(near.body, /Looks like you're near Westminster\./);
  assert.match(near.body, /<a href="\/westminster">See Westminster parks<\/a>/);
  assert.match(near.body, /Your passport to St\. Pete parks/); // a suggestion, not a switch
  assert.doesNotMatch((await from('203.0.113.8')).body, /Looks like you're near/); // too far from every city
  const chose = client(app);
  await chose.get('/st-pete');
  assert.doesNotMatch((await from('203.0.113.7', chose)).body, /Looks like you're near/);
});

test('admin: the city bar switches parks, import and theme to a city; new parks go in it and must be inside it', async () => {
  const { app, db } = citiesApp();
  const admin = await member(app, 'admin@example.com');
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = 'admin@example.com'").run();
  assert.match((await admin.get('/admin/parks')).body, /<h1>St\. Pete parks<\/h1>/);
  const sw = await admin.post('/admin/city/use', { city: 'westminster', back: '/admin/parks' });
  assert.equal(sw.headers.location, '/admin/parks');
  const list = (await admin.get('/admin/parks')).body;
  assert.match(list, /<h1>Westminster parks<\/h1>/);
  assert.match(list, /Sigler Park/);
  assert.doesNotMatch(list, /Abercrombie/);
  assert.match((await admin.get('/admin/city')).body, /Westminster's landmark icons/);
  assert.match((await admin.get('/admin/parks/new')).body, /data-center="33\.755,-117\.985"/);
  const form = { name: 'New Park', slug: 'new-park', lat: '27.8', lng: '-82.7', checkin_radius_m: '150', active: '1' };
  assert.match((await admin.post('/admin/parks/new', form)).body, /Lat\/lng is outside Westminster/);
  const ok = await admin.post('/admin/parks/new', { ...form, lat: '33.75', lng: '-118.0' });
  assert.equal(ok.statusCode, 303);
  assert.equal(db.prepare("SELECT c.key FROM parks p JOIN city_themes c ON c.id = p.city_id WHERE p.slug = 'new-park'").pluck().get(), 'westminster');
  assert.equal((await admin.post('/admin/city/use', { city: 'atlantis', back: '/admin' })).statusCode, 404);
});
