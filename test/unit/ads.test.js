// M40: Nonprofit ads and activity tips (SPEC Flow 25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { seedCities } from '../../src/db/seed.js';
import { saveNonprofit } from '../../src/domain/nonprofits.js';
import { seedActivities } from '../../src/domain/activities.js';
import { saveAd, addSlide, adById, adForPark, adForPassport, tipsFor, removeSlide, moveSlide, adState } from '../../src/domain/ads.js';
import { cityById, areaForPark } from '../../src/domain/city.js';
import { storeAdImage, adImagePath } from '../../src/lib/images.js';

const PW = 'correct horse battery';

async function world() {
  const now = testClock('2026-06-06T16:00:00Z'); // 12:00 in St. Pete
  const made = makeApp({ now });
  const { db, app } = made;
  seedCities(db);
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','),
    'a-park,A Park,,,27.800,-82.700,,,,0', 'b-park,B Park,,,27.770,-82.640,,,,0'].join('\n'));
  const people = {};
  for (const name of ['ana', 'boss']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.boss.id);
  const cityId = (key) => db.prepare('SELECT id FROM city_themes WHERE key = ?').pluck().get(key);
  const stPete = cityById(db, cityId('st-pete'));
  const park = (slug) => db.prepare('SELECT * FROM parks WHERE slug = ? AND city_id = ?').get(slug, stPete.id);
  const np = saveNonprofit(db, null, { name: 'Calm Sangha', url: 'https://calm.example.org', mission: 'Free meditation.', reason: 'local', city_id: stPete.id, status: 'active' }).id;
  // An ad that's live today, with one image (no file needed for matching).
  const make = (form = {}) => {
    const r = saveAd(db, null, { name: 'Ad', nonprofit_id: String(np), placement: 'park', starts_on: '2026-06-01', ends_on: '2026-06-30', ...form, active: '0' }, { now: now() });
    assert.ok(r.id, JSON.stringify(r.errors));
    addSlide(db, r.id, { key: 'a'.repeat(24), animated: false, alt: 'A calm lake' });
    if (form.active !== '0') db.prepare('UPDATE ads SET active = 1 WHERE id = ?').run(r.id);
    return r.id;
  };
  return { ...made, now, people, stPete, park, np, make, cityId };
}

test('validation: a nonprofit, a place, dates in order, cities and parks chosen; on needs an image', async () => {
  const { db, np, now } = await world();
  const bad = saveAd(db, null, { name: '', placement: 'x', starts_on: '2026-06-10', ends_on: '2026-06-01', all_cities: '0', park_scope: 'parks' }, { now: now() });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['cities', 'ends_on', 'name', 'nonprofit_id', 'placement', 'park_scope'].sort());
  const tip = saveAd(db, null, { name: 'T', nonprofit_id: String(np), placement: 'activity', starts_on: '2026-06-01', ends_on: '2026-06-02' }, { now: now() });
  assert.deepEqual(Object.keys(tip.errors).sort(), ['activity_id', 'body', 'title']);
  const on = saveAd(db, null, { name: 'On', nonprofit_id: String(np), placement: 'park', starts_on: '2026-06-01', ends_on: '2026-06-02', active: '1' }, { now: now() });
  assert.match(on.errors.active, /Add at least one image/);
  // A suggested nonprofit can't have ads.
  const sug = saveNonprofit(db, null, { name: 'S', url: 'https://s.example.org', mission: 'x', reason: 'local', city_id: 1, status: 'suggested' }).id;
  assert.ok(saveAd(db, null, { name: 'S', nonprofit_id: String(sug), placement: 'park', starts_on: '2026-06-01', ends_on: '2026-06-02' }, { now: now() }).errors.nonprofit_id);
});

test('hidden unless on and within its dates (city time); state names for admin', async () => {
  const { db, make, park, stPete, now } = await world();
  const a = park('a-park');
  const id = make({ starts_on: '2026-06-07', ends_on: '2026-06-30' });
  assert.equal(adForPark(db, a, stPete, { now: now() }), null); // starts tomorrow
  assert.equal(adState(adById(db, id), '2026-06-06'), 'Scheduled');
  // 2026-06-07 05:00 UTC is still June 6 in St. Pete; 04:00 UTC on the 8th is the 7th.
  assert.equal(adForPark(db, a, stPete, { now: new Date('2026-06-07T03:00:00Z') }), null);
  assert.equal(adForPark(db, a, stPete, { now: new Date('2026-06-08T03:00:00Z') })?.id, id);
  assert.equal(adForPark(db, a, stPete, { now: new Date('2026-07-01T05:00:00Z') }), null); // ended (June 30 local ended at 04:00 UTC)
  db.prepare('UPDATE ads SET active = 0').run();
  assert.equal(adForPark(db, a, stPete, { now: new Date('2026-06-10T12:00:00Z') }), null);
  assert.equal(adState(adById(db, id), '2026-06-10'), 'Off');
  // A paused nonprofit's ads don't show either, and admin says so.
  db.prepare('UPDATE ads SET active = 1').run();
  db.prepare("UPDATE nonprofits SET status = 'paused'").run();
  assert.equal(adForPark(db, a, stPete, { now: new Date('2026-06-10T12:00:00Z') }), null);
  assert.equal(adState(adById(db, id), '2026-06-10'), 'Paused');
});

test('targeting: cities, categories, neighborhoods and hand-picked parks', async () => {
  const { db, make, park, stPete, cityId, now } = await world();
  const a = park('a-park');
  const b = park('b-park');
  const westminster = cityById(db, cityId('westminster'));
  const other = make({ all_cities: '0', cities: String(westminster.id) });
  assert.equal(adForPark(db, a, stPete, { now: now() }), null);
  db.prepare('DELETE FROM ads WHERE id = ?').run(other);

  db.prepare("INSERT INTO park_categories (park_id, category) VALUES (?, 'dog-park')").run(b.id);
  const dogs = make({ park_scope: 'categories', categories: 'dog-park' });
  assert.equal(adForPark(db, a, stPete, { now: now() }), null);
  assert.equal(adForPark(db, b, stPete, { now: now() }).id, dogs);
  db.prepare('DELETE FROM ads').run();

  const areaA = areaForPark(stPete, a).name;
  const areaB = areaForPark(stPete, b).name;
  assert.notEqual(areaA, areaB, 'the two test parks sit in different neighborhoods');
  const hood = make({ park_scope: 'areas', areas: `${stPete.id}:${areaA}` });
  assert.equal(adForPark(db, a, stPete, { now: now() }).id, hood);
  assert.equal(adForPark(db, b, stPete, { now: now() }), null);
  db.prepare('DELETE FROM ads').run();

  const picked = make({ park_scope: 'parks', parks: String(b.id) });
  assert.equal(adForPark(db, a, stPete, { now: now() }), null);
  assert.equal(adForPark(db, b, stPete, { now: now() }).id, picked);
  // The passport is targeted by city only.
  const pass = make({ placement: 'passport', park_scope: 'parks', parks: String(b.id) });
  assert.equal(adById(db, pass).park_scope, 'all');
  assert.equal(adForPassport(db, stPete, { now: now() }).id, pass);
  assert.equal(adForPassport(db, westminster, { now: now() }).id, pass); // all cities
});

test('slides: at most 5, reorder, removing the last switches the ad off', async () => {
  const { db, make } = await world();
  const id = make();
  for (let i = 0; i < 4; i++) assert.ok(addSlide(db, id, { key: String(i).repeat(24), animated: false, alt: `Slide ${i}` }).id);
  assert.match(addSlide(db, id, { key: 'f'.repeat(24), animated: false, alt: 'Six' }).error, /at most 5/);
  assert.match(addSlide(db, 999, { key: 'f'.repeat(24), animated: false, alt: '' }).error, /Describe the image/);
  const [first, second] = adById(db, id).slides;
  assert.ok(moveSlide(db, id, second.id, -1));
  assert.equal(adById(db, id).slides[0].id, second.id);
  for (const s of adById(db, id).slides) removeSlide(db, id, s.id);
  assert.equal(adById(db, id).active, 0);
  assert.equal(first.alt, 'A calm lake');
});

test('park page: one ad at the bottom, counted; clicks counted only where it can show; crawlers not counted', async () => {
  const { app, db, people, make, park } = await world();
  const a = park('a-park');
  const b = park('b-park');
  const id = make({ park_scope: 'parks', parks: String(a.id) });
  const page = (await people.ana.c.get('/st-pete/parks/a-park')).body;
  assert.match(page, /class="np-ad" aria-label="Local nonprofit: Calm Sangha"/);
  assert.match(page, new RegExp(`href="/go/ad/${id}\\?from=${a.id}" rel="noopener sponsored"`));
  assert.ok(page.indexOf('class="np-ad"') > page.indexOf('id="photos"'), 'at the bottom');
  assert.doesNotMatch((await people.ana.c.get('/st-pete/parks/b-park')).body, /class="np-ad"/);
  const stat = () => db.prepare('SELECT park_id, SUM(views) AS v, SUM(clicks) AS c FROM ad_stats GROUP BY park_id').all();
  assert.deepEqual(stat(), [{ park_id: a.id, v: 1, c: 0 }]);
  const go = await people.ana.c.get(`/go/ad/${id}?from=${a.id}`);
  assert.equal(go.statusCode, 302);
  assert.equal(go.headers.location, 'https://calm.example.org/');
  await people.ana.c.get(`/go/ad/${id}?from=${b.id}`); // not a park it shows on: redirect, no count
  assert.deepEqual(stat(), [{ park_id: a.id, v: 1, c: 1 }]);
  await app.inject({ method: 'GET', url: '/st-pete/parks/a-park', headers: { 'user-agent': 'Googlebot/2.1' } });
  await app.inject({ method: 'GET', url: `/go/ad/${id}?from=${a.id}`, headers: { 'user-agent': 'Googlebot/2.1' } });
  assert.deepEqual(stat(), [{ park_id: a.id, v: 1, c: 1 }]); // crawlers aren't counted
});

test('passport: the ad at the bottom of your own passport, never on /u pages', async () => {
  const { db, people, make } = await world();
  const id = make({ placement: 'passport' });
  const mine = (await people.ana.c.get('/st-pete/passport')).body;
  assert.match(mine, new RegExp(`href="/go/ad/${id}\\?from=city-\\d+"`));
  db.prepare("UPDATE users SET default_visibility = 'public'").run();
  const handle = db.prepare("SELECT handle FROM users WHERE display_name = 'ana'").pluck().get();
  assert.doesNotMatch((await people.boss.c.get(`/u/${handle}`)).body, /class="np-ad"/);
  assert.equal(db.prepare('SELECT SUM(views) FROM ad_stats WHERE park_id = 0').pluck().get(), 1);
});

test('activity tip: shows on the activity once stamped today; opening it is the counted view', async () => {
  const { app, db, people, make, park, stPete, now } = await world();
  const a = park('a-park');
  seedActivities(db, [{ slug: 'meditate', name: 'Meditate', pillar: 'calm', measure: 'minutes', points: 3 }]);
  const act = db.prepare("SELECT * FROM activities WHERE slug = 'meditate'").get();
  const id = make({ placement: 'activity', activity_id: String(act.id), title: 'Three breaths', body: 'Sit.\nBreathe in.\n\nSmile.' });
  assert.equal(tipsFor(db, a, stPete, { now: now() }).get(act.id).id, id);
  const before = (await people.ana.c.get('/st-pete/parks/a-park')).body;
  assert.doesNotMatch(before, /Tips from Calm Sangha/); // locked until today's stamp
  // Only where the link shows: not signed out, not before today's stamp (and no view counted).
  assert.equal((await client(app).get(`/tips/${id}?park=${a.id}`)).statusCode, 404);
  assert.equal((await people.ana.c.get(`/tips/${id}?park=${a.id}`)).statusCode, 404);
  await people.ana.c.post('/st-pete/parks/a-park/stamp', {});
  const after = (await people.ana.c.get('/st-pete/parks/a-park')).body;
  assert.match(after, new RegExp(`href="/tips/${id}\\?park=${a.id}" data-tip>`));
  assert.match(after, /src="\/js\/ads\.js\?v=/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM ad_stats').pluck().get(), 0); // a tip link isn't a view
  const embed = await people.ana.c.get(`/tips/${id}?park=${a.id}&embed=1`);
  assert.equal(embed.statusCode, 200);
  assert.match(embed.body, /<h2 id="tip-h">Three breaths<\/h2>/);
  assert.match(embed.body, /<p>Sit\.<br>Breathe in\.<\/p>\s*<p>Smile\.<\/p>/);
  assert.doesNotMatch(embed.body, /<html/);
  const pageView = await people.ana.c.get(`/tips/${id}?park=${a.id}`);
  assert.match(pageView.body, /<h1 id="tip-h">Three breaths<\/h1>/);
  assert.equal(db.prepare('SELECT SUM(views) FROM ad_stats WHERE ad_id = ?').pluck().get(id), 2);
  // Not a park it shows on, or switched off: 404.
  db.prepare('UPDATE ads SET park_scope = ? WHERE id = ?').run('parks', id);
  assert.equal((await people.ana.c.get(`/tips/${id}?park=${a.id}`)).statusCode, 404);
});

test('admin: members get 404; an admin makes an ad, adds an image (resized to 600×500), switches it on', async () => {
  const { app, db, people, np } = await world();
  assert.equal((await people.ana.c.get('/admin/ads')).statusCode, 404);
  assert.equal((await people.ana.c.post('/admin/ads/new', { name: 'x' })).statusCode, 404);
  const { c } = people.boss;
  assert.match((await c.get('/admin/ads')).body, /No ads yet/);
  const made = await c.post('/admin/ads/new', { name: 'Summer calm', nonprofit_id: String(np), placement: 'park', starts_on: '2026-06-01', ends_on: '2026-06-30', all_cities: '1', park_scope: 'all' });
  assert.equal(made.statusCode, 303);
  const id = Number(/\/admin\/ads\/(\d+)/.exec(made.headers.location)[1]);
  assert.equal(adById(db, id).active, 0); // new ads are off
  const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#00b3a4' } }).png().toBuffer();
  const noAlt = await c.postMultipart(`/admin/ads/${id}/slides`, { alt: '' }, { image: { buffer: png, filename: 'a.png', type: 'image/png' } });
  assert.equal(noAlt.statusCode, 422);
  assert.match(noAlt.body, /Describe the image/);
  const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000' } }).png().toBuffer();
  assert.match((await c.postMultipart(`/admin/ads/${id}/slides`, { alt: 'x' }, { image: { buffer: tiny, filename: 't.png', type: 'image/png' } })).body, /at least 300×250/);
  const ok = await c.postMultipart(`/admin/ads/${id}/slides`, { alt: 'A teal square' }, { image: { buffer: png, filename: 'a.png', type: 'image/png' } });
  assert.equal(ok.statusCode, 303);
  const [slide] = adById(db, id).slides;
  const meta = await sharp(adImagePath(app.config.uploadsDir, slide.image_key)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 600, 500]);
  const img = await client(app).get(`/ad-art/${slide.image_key}.webp`);
  assert.equal(img.statusCode, 200);
  assert.match(img.headers['cache-control'], /immutable/);
  const on = await c.post(`/admin/ads/${id}`, { name: 'Summer calm', nonprofit_id: String(np), placement: 'park', starts_on: '2026-06-01', ends_on: '2026-06-30', all_cities: '1', park_scope: 'all', active: '1' });
  assert.equal(on.statusCode, 303);
  assert.match((await c.get('/admin/ads')).body, /Running/);
  assert.match((await people.ana.c.get('/st-pete/parks/a-park')).body, /class="np-ad"/);
  // Deleting removes the files.
  await c.post(`/admin/ads/${id}/delete`, {});
  assert.equal(fs.existsSync(adImagePath(app.config.uploadsDir, slide.image_key)), false);
  // So does deleting the nonprofit (its ads go with it).
  const again = await c.post('/admin/ads/new', { name: 'Again', nonprofit_id: String(np), placement: 'park', starts_on: '2026-06-01', ends_on: '2026-06-30', all_cities: '1', park_scope: 'all' });
  const id2 = Number(/\/admin\/ads\/(\d+)/.exec(again.headers.location)[1]);
  await c.postMultipart(`/admin/ads/${id2}/slides`, { alt: 'Teal' }, { image: { buffer: png, filename: 'a.png', type: 'image/png' } });
  const key2 = adById(db, id2).slides[0].image_key;
  assert.equal(fs.existsSync(adImagePath(app.config.uploadsDir, key2)), true);
  await c.post(`/admin/nonprofits/${np}/delete`, {});
  assert.equal(adById(db, id2), null);
  assert.equal(fs.existsSync(adImagePath(app.config.uploadsDir, key2)), false);
});

test('animated GIF stays animated, with a still first frame', async () => {
  const { app } = await world();
  const frames = await Promise.all(['#f00', '#0f0'].map((c) => sharp({ create: { width: 600, height: 500, channels: 3, background: c } }).raw().toBuffer()));
  const gif = await sharp(Buffer.concat(frames), { raw: { width: 600, height: 1000, channels: 3, pageHeight: 500 } }).gif({ delay: [300, 300], loop: 0 }).toBuffer();
  const stored = await storeAdImage(gif, app.config.uploadsDir);
  assert.equal(stored.animated, true);
  assert.equal((await sharp(adImagePath(app.config.uploadsDir, stored.key), { animated: true }).metadata()).pages, 2);
  assert.equal((await sharp(adImagePath(app.config.uploadsDir, stored.key, true)).metadata()).pages ?? 1, 1);
  assert.match((await storeAdImage(Buffer.from('<svg/>'), app.config.uploadsDir)).error, /JPEG, PNG, WebP or GIF/);
});
