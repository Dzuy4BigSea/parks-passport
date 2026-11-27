// Multi-city (SPEC Flow 14): city packs, city URLs, per-city time zones, city and travel badges,
// the nearest-city suggestion and the admin city bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { makeApp, client, testClock } from './helpers.js';
import { migrate } from '../../src/db/index.js';
import { seedBadges, seedCities, cityPackKeys, CITIES_DIR } from '../../src/db/seed.js';
import { seedCityPack, cityByKey, listCities, nearestCity, RESERVED_CITY_KEYS, clearThemeCache } from '../../src/domain/city.js';
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
  assert.ok(['st-pete', 'westminster', 'asheville', 'cookeville', 'marple', 'bend', 'indianapolis', 'trinidad', 'clearwater', 'pinellas'].every((k) => keys.includes(k)));
  for (const key of keys) {
    const pack = JSON.parse(fs.readFileSync(path.join(CITIES_DIR, key, 'city.json'), 'utf8'));
    assert.equal(pack.key, key);
    assert.ok(!RESERVED_CITY_KEYS.has(key), key);
    for (const m of pack.motifs) assert.ok(sanitizeSvg(m.svg), `${key}/${m.slug}`);
    // parks.csv and any extra park files (county parks inside the city) must sit inside its bounds.
    const files = fs.readdirSync(path.join(CITIES_DIR, key)).filter((f) => /^([a-z0-9-]+-)?parks\.csv$/.test(f));
    const rows = files.flatMap((f) => parseCsv(fs.readFileSync(path.join(CITIES_DIR, key, f), 'utf8')));
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
  assert.equal(count('SELECT COUNT(*) FROM parks WHERE city_id = ?', cityByKey(db, 'st-pete').id), 109); // 102 city parks + 7 Pinellas County parks inside St. Pete
  assert.deepEqual(listCities(db).map((c) => c.key), // by sort
    ['st-pete', 'westminster', 'asheville', 'cookeville', 'marple', 'bend', 'indianapolis', 'trinidad', 'clearwater', 'pinellas']);
  const parksIn = (key) => count('SELECT COUNT(*) FROM parks WHERE city_id = ?', cityByKey(db, key).id);
  assert.deepEqual(['asheville', 'cookeville', 'marple', 'bend', 'indianapolis', 'trinidad', 'clearwater', 'pinellas'].map(parksIn), [68, 10, 10, 75, 166, 10, 86, 11]);
  assert.equal(cityByKey(db, 'indianapolis').time_zone, 'America/Indianapolis');
  db.prepare("UPDATE city_themes SET tagline = 'Edited', copy = '{}' WHERE key = 'westminster'").run();
  const again = seedCities(db);
  assert.ok(again.every((c) => !c.motifs && !c.parks && !c.extraParks && !c.badges));
  const reloaded = cityByKey(db, 'westminster');
  assert.equal(reloaded.tagline, 'Edited');
  assert.equal(reloaded.copy.short, 'Westminster');
  assert.equal(count("SELECT COUNT(*) FROM badges WHERE slug = 'two-cities'"), 1);
});

test('migration 016 keeps every visit, photo and rating, and puts the existing parks in St. Pete', () => {
  const dir = path.join(import.meta.dirname, '..', '..', 'src', 'db', 'migrations');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && x < '016').sort()) {
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
  assert.match(sp, /1 of 109 parks stamped/);
  assert.match(sp, /class="city-tabs"/);
  assert.match(sp, /href="\/westminster\/passport"/);
  // Tabs only for cities with stamps (plus the one being viewed): not Asheville, Bend, ...
  const tabs = sp.match(/<nav class="city-tabs"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...tabs.matchAll(/class="city-tab-name">([^<]+)</g)].map((m) => m[1]), ['St. Pete', 'Westminster']);
  const bend = (await sam.get('/bend/passport')).body.match(/<nav class="city-tabs"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...bend.matchAll(/class="city-tab-name">([^<]+)</g)].map((m) => m[1]), ['St. Pete', 'Westminster', 'Bend']);
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

test('QA: admin forms keep the city they showed; next park and the week stay in the viewed city', async () => {
  const { app, db } = citiesApp({ now: testClock('2026-06-03T16:00:00Z') });
  const admin = await member(app, 'admin@example.com');
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = 'admin@example.com'").run();
  const page = (await admin.get('/admin/city')).body; // shown for St. Pete
  assert.match(page, /action="\/admin\/city\/settings\?city=st-pete"/);
  await admin.get('/westminster'); // another tab switches the current city
  const save = await admin.post('/admin/city/settings?city=st-pete', { city_name: 'St. Petersburg', tagline: 'Sunshine City', accent: '#FF7A59', accent_2: '#7C6CF2' });
  assert.equal(save.headers.location, '/admin/city?done=saved&city=st-pete');
  assert.equal(cityByKey(db, 'westminster').tagline, 'Little Saigon'); // untouched
  assert.match((await admin.get('/admin/parks/new')).body, /action="\/admin\/parks\/new\?city=westminster"/);
  const sigler = db.prepare("SELECT id FROM parks WHERE slug = 'sigler-park'").pluck().get();
  db.prepare('UPDATE parks SET lat = NULL, lng = NULL WHERE id = ?').run(sigler);
  assert.match((await admin.get(`/admin/parks/${sigler}`)).body, /data-center="33\.755,-117\.985"/);

  // Next park: from the last stamp in the city being viewed, not a stamp in another city.
  await admin.post('/st-pete/parks/abercrombie-park/stamp', {});
  await admin.post('/westminster/parks/liberty-park/stamp', {});
  await admin.post('/st-pete/parks/crescent-lake-park/stamp', {});
  const wm = (await admin.get('/westminster/passport')).body;
  const next = wm.match(/Closest new park<\/span><strong>([^<]+)</)[1];
  assert.ok(db.prepare("SELECT 1 FROM parks p JOIN city_themes c ON c.id = p.city_id WHERE c.key = 'westminster' AND p.name = ?").get(next), next);
});

test('QA: a migration that drops a table must say so and runs with foreign keys off', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-mig-'));
  try {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (a_id INTEGER REFERENCES a(id) ON DELETE CASCADE); INSERT INTO a VALUES (1); INSERT INTO b VALUES (1);');
    fs.writeFileSync(path.join(dir, '002_rebuild.sql'), 'CREATE TABLE a2 (id INTEGER PRIMARY KEY); INSERT INTO a2 SELECT id FROM a; DROP TABLE a; ALTER TABLE a2 RENAME TO a;');
    assert.throws(() => migrate(db, dir), /drops a table/);
    assert.equal(db.prepare('SELECT COUNT(*) FROM b').pluck().get(), 1);
    // With the marker (even behind a BOM) it runs with foreign keys off: the rows that point at a stay.
    fs.writeFileSync(path.join(dir, '002_rebuild.sql'), '\uFEFF-- migrate:foreign-keys-off\n' + fs.readFileSync(path.join(dir, '002_rebuild.sql'), 'utf8'));
    migrate(db, dir);
    assert.equal(db.prepare('SELECT COUNT(*) FROM b').pluck().get(), 1);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('share previews and invites are city-specific: image, alt text and title; ?city= links; {city} in the invitation', async () => {
  const { app, db, mailer } = citiesApp();
  const meta = (body, prop) => (body.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`)) || [])[1];
  const wm = (await client(app).get('/westminster/parks')).body;
  assert.equal(meta(wm, 'og:image'), 'http://test.local/og/westminster.jpg');
  assert.match(meta(wm, 'og:image:alt'), /stamp every Westminster park/);
  assert.equal(meta(wm, 'og:title'), 'Westminster parks · Parks Passport');
  assert.match(meta(wm, 'description'), /Westminster, California/);
  const sp = (await client(app).get('/st-pete')).body;
  assert.equal(meta(sp, 'og:image'), 'http://test.local/og/parks-passport.jpg');
  assert.match(meta(sp, 'og:image:alt'), /St\. Pete Pier/);

  // A link with ?city= opens (and remembers) that city.
  const friend = client(app);
  assert.match((await friend.get('/?city=westminster')).body, /Your passport to Westminster parks/);
  assert.match((await friend.get('/')).body, /Your passport to Westminster parks/);

  // Park Pals invite link and the admin's email invitation carry the inviter's current city.
  const sam = await member(app);
  await sam.get('/asheville');
  assert.match((await sam.get('/pals')).body, /\/pals\/invite\/[\w-]+\?city=asheville"/);
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = 'sam@example.com'").run();
  await sam.post('/admin/invites', { invite_email: 'new@example.com', invite_name: 'Nia' });
  const mail = mailer.sent.at(-1);
  assert.match(mail.text, /a free passport for Asheville parks/);
  assert.match(mail.text, /\/join\/[\w-]+\?city=asheville/);
});

test('home city: set where you join, opening the site goes there, changeable in Account; away nudge', async () => {
  const fake = await createGeoIp({ file: import.meta.filename, open: async () => ({ get: (ip) => ({
    '203.0.113.7': { location: { latitude: 33.75, longitude: -117.99 } }, // near Westminster
  })[ip] }) });
  const { app, db } = citiesApp({ geoip: fake });
  const cookie = (c) => [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const open = (c, ip = '127.0.0.1', url = '/') => app.inject({ method: 'GET', url, headers: { 'x-forwarded-for': ip, cookie: cookie(c) } });
  const homeOf = (email) => db.prepare('SELECT c.key FROM users u JOIN city_themes c ON c.id = u.home_city_id WHERE u.email = ?').pluck().get(email);

  // Signed up from Westminster: Westminster is home.
  const wes = client(app);
  await wes.get('/westminster');
  await wes.post('/signup', { display_name: 'Wes', email: 'wes@example.com', password: PW });
  assert.equal(homeOf('wes@example.com'), 'westminster');
  // Browsing St. Pete, then opening the site again: home.
  await wes.get('/st-pete/parks');
  assert.equal((await wes.get('/passport')).headers.location, '/st-pete/passport'); // stays where you browse
  assert.match((await wes.get('/')).body, /href="\/westminster\/parks"/);
  assert.equal((await wes.get('/passport')).headers.location, '/westminster/passport');
  // Members don't get the footer city list; visitors do.
  assert.doesNotMatch((await open(wes)).body, /class="footer-cities"/);
  assert.match((await client(app).get('/')).body, /class="footer-cities"/);

  // Account: change home city.
  const acct = (await wes.get('/account')).body;
  assert.match(acct, /<option value="westminster" selected>/);
  assert.equal((await wes.post('/account/home-city', { city: 'nowhere' })).statusCode, 422);
  assert.equal((await wes.post('/account/home-city', { city: 'st-pete' })).headers.location, '/account?done=home');
  assert.equal(homeOf('wes@example.com'), 'st-pete');
  assert.match((await wes.get('/account?done=home')).body, /Parks Passport now opens in St\. Pete\./);
  assert.equal((await wes.post('/account/home-city', { city: 'westminster' }, { csrf: false })).statusCode, 403);

  // Opening the site near Westminster (home St. Pete): a nudge, not a switch; "Not now" hides it for the day.
  const nudged = await open(wes, '203.0.113.7');
  assert.match(nudged.body, /You're near Westminster\. Explore its parks while you're here\?|You&#39;re near Westminster\. Explore its parks while you&#39;re here\?/);
  assert.match(nudged.body, /<a href="\/westminster">See Westminster parks<\/a>/);
  assert.match(nudged.body, /href="\/st-pete\/parks"/);
  await wes.post('/city/away/dismiss', { city: 'westminster' });
  assert.doesNotMatch((await open(wes, '203.0.113.7')).body, /near Westminster/);
  // "Use my location" near Westminster nudges too; at home, no nudge.
  const sam = await member(app, 'sam2@example.com');
  assert.match((await open(sam, '127.0.0.1', '/?lat=33.75&lng=-117.99')).body, /near Westminster/);
  assert.doesNotMatch((await open(sam)).body, /near Westminster/);
});

test('migration 028 backfills home city from where members stamped most', () => {
  const db = new Database(':memory:');
  const dir = path.join(path.dirname(import.meta.filename), '../../src/db/migrations');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-mig-'));
  for (const f of fs.readdirSync(dir).filter((f) => f < '028')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
  migrate(db, tmp);
  for (const key of ['st-pete', 'westminster', 'asheville']) seedCityPack(db, JSON.parse(fs.readFileSync(path.join(CITIES_DIR, key, 'city.json'), 'utf8')));
  const city = (k) => cityByKey(db, k).id;
  const park = (cityKey, slug) => db.prepare("INSERT INTO parks (slug, name, city_id, active, created_at, updated_at) VALUES (?, ?, ?, 1, 'x', 'x')").run(slug, slug, city(cityKey)).lastInsertRowid;
  const u = db.prepare("INSERT INTO users (email, password_hash, display_name, handle, created_at) VALUES ('a@x.com', 'h', 'A', 'a', 'x')").run().lastInsertRowid;
  const v = db.prepare("INSERT INTO visits (user_id, park_id, visited_on, visited_at, method, created_at) VALUES (?, ?, ?, ?, 'honor', 'x')");
  const [p1, p2, p3] = [park('westminster', 'w1'), park('westminster', 'w2'), park('asheville', 'a1')];
  v.run(u, p1, '2026-01-01', '2026-01-01T12:00:00Z');
  v.run(u, p2, '2026-01-02', '2026-01-02T12:00:00Z');
  v.run(u, p3, '2026-01-03', '2026-01-03T12:00:00Z');
  db.prepare("INSERT INTO users (email, password_hash, display_name, handle, created_at) VALUES ('b@x.com', 'h', 'B', 'b', 'x')").run();
  migrate(db, dir);
  assert.equal(db.prepare("SELECT home_city_id FROM users WHERE email = 'a@x.com'").pluck().get(), city('westminster'));
  assert.equal(db.prepare("SELECT home_city_id FROM users WHERE email = 'b@x.com'").pluck().get(), null);
});

test('M34 QA: signing in opens the home city; the logo keeps you in the city you browse; bogus ?city= still goes home', async () => {
  const { app, db } = citiesApp();
  const wes = client(app);
  await wes.get('/westminster');
  await wes.post('/signup', { display_name: 'Wes', email: 'wes@example.com', password: PW });
  // A fresh device: log in, and the passport opens in Westminster.
  const phone = client(app);
  await phone.post('/login', { email: 'wes@example.com', password: PW });
  assert.equal((await phone.get('/passport')).headers.location, '/westminster/passport');
  // Browsing St. Pete, the logo points at St. Pete, not "/".
  assert.match((await phone.get('/st-pete/parks')).body, /<a class="brand" href="\/st-pete">/);
  assert.match((await client(app).get('/st-pete/parks')).body, /<a class="brand" href="\/">/); // visitors: "/"
  // A made-up ?city= doesn't skip the home city.
  assert.match((await phone.get('/?city=bogus')).body, /href="\/westminster\/parks"/);
  // An unlisted city never becomes a home city.
  db.prepare("UPDATE city_themes SET listed = 0 WHERE key = 'asheville'").run();
  clearThemeCache(db);
  const ash = client(app);
  await ash.get('/asheville');
  await ash.post('/signup', { display_name: 'Ash', email: 'ash@example.com', password: PW });
  assert.equal(db.prepare("SELECT home_city_id FROM users WHERE email = 'ash@example.com'").pluck().get(), null);
});

test('a pack\'s extra park files (county parks inside a city) are imported once, even into a city with parks, never changing a park', () => {
  const { db } = citiesApp();
  const count = (key) => db.prepare('SELECT COUNT(*) FROM parks p JOIN city_themes c ON c.id = p.city_id WHERE c.key = ?').pluck().get(key);
  assert.equal(count('st-pete'), 109);
  assert.ok(db.prepare("SELECT 1 FROM parks p JOIN city_themes c ON c.id = p.city_id WHERE c.key = 'st-pete' AND p.slug = 'fort-de-soto-park'").get());
  // An admin edits one county park and removes another; a restart changes neither.
  db.prepare("UPDATE parks SET name = 'Fort De Soto (edited)' WHERE slug = 'fort-de-soto-park'").run();
  db.prepare("DELETE FROM parks WHERE slug = 'shell-key-preserve'").run();
  seedCities(db);
  assert.equal(db.prepare("SELECT name FROM parks WHERE slug = 'fort-de-soto-park'").pluck().get(), 'Fort De Soto (edited)');
  assert.equal(db.prepare("SELECT COUNT(*) FROM parks WHERE slug = 'shell-key-preserve'").pluck().get(), 0);
  // A live city that already had parks before the file shipped still gets it, once.
  db.prepare("DELETE FROM settings WHERE key = 'pack_parks:clearwater/pinellas-county-parks.csv'").run();
  db.prepare("DELETE FROM parks WHERE slug IN ('philippe-park', 'eagle-lake-park')").run();
  const [cw] = seedCities(db).filter((c) => c.key === 'clearwater');
  assert.equal(cw.extraParks, 2);
  assert.equal(count('clearwater'), 86);
});
