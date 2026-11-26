// M33: Gary's outfits and the weather (SPEC Flow 22).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client } from './helpers.js';
import { seedBadges, seedCities, SEED_GARY_OUTFITS_JSON } from '../../src/db/seed.js';
import { seedOutfits, wardrobe, outfitFor, chooseOutfit, setOutfitStatus } from '../../src/domain/outfits.js';
import { conditionFrom, createWeather } from '../../src/lib/weather.js';
import { garySvg } from '../../src/views/gary-art.js';
import fs from 'node:fs';

const PW = 'correct horse battery';

async function world() {
  const made = makeApp();
  const { db, app } = made;
  seedBadges(db);
  seedCities(db);
  seedOutfits(db, SEED_GARY_OUTFITS_JSON);
  const people = {};
  for (const name of ['boss', 'ana']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.boss.id);
  // Neither is a founding explorer for these tests (the first 75 accounts get Founding Member).
  db.prepare("DELETE FROM user_badges WHERE badge_id IN (SELECT id FROM badges WHERE slug IN ('founding-member', 'early-bird-100'))").run();
  const give = (userId, slug) => db.prepare("INSERT INTO user_badges (user_id, badge_id, awarded_at, source_type, seen_at) VALUES (?, (SELECT id FROM badges WHERE slug = ?), 'x', 'grant', 'x')").run(userId, slug);
  const approveAll = () => db.prepare("UPDATE gary_outfits SET status = 'approved'").run();
  return { ...made, people, give, approveAll };
}

test('outfits ship as drafts (Classic approved); seeding is idempotent; every unlock badge exists; art renders', () => {
  const { db } = makeApp();
  seedBadges(db);
  seedCities(db);
  const list = JSON.parse(fs.readFileSync(SEED_GARY_OUTFITS_JSON, 'utf8'));
  assert.ok(list.length >= 12);
  assert.equal(seedOutfits(db, SEED_GARY_OUTFITS_JSON), list.length);
  assert.equal(seedOutfits(db, SEED_GARY_OUTFITS_JSON), 0);
  const statuses = db.prepare('SELECT slug, status FROM gary_outfits').all();
  assert.deepEqual(statuses.filter((s) => s.status === 'approved').map((s) => s.slug), ['classic']);
  assert.deepEqual(list.filter((o) => o.starter).map((o) => o.slug), ['classic', 'sun-hat', 'rain-slicker']);
  const slugs = new Set(db.prepare('SELECT slug FROM badges').pluck().all());
  for (const o of list) for (const b of o.unlock_badges) assert.ok(slugs.has(b), `${o.slug}: ${b}`);
  assert.deepEqual(list.find((o) => o.slug === 'early-bird').unlock_badges, ['founding-member', 'early-bird-100']);
  for (const o of list) {
    const svg = String(garySvg(o.art, { id: o.slug }));
    assert.match(svg, new RegExp(`clip-path="url\\(#gary-mouth-${o.slug}\\)"`));
    assert.doesNotMatch(svg, /<script|on\w+=/i);
  }
  assert.match(String(garySvg({ shirt: { main: '#123456' } })), /#123456/);
  assert.doesNotMatch(String(garySvg({ shirt: { main: 'red;} body{x' } })), /red;/); // only #rrggbb colors
});

test('members only see approved outfits: 3 starters, Early Bird for founding explorers, the rest unlocked by badges', async () => {
  const { db, people, give, approveAll } = await world();
  assert.deepEqual(wardrobe(db, people.ana.id).map((o) => o.slug), ['classic']); // drafts aren't shown
  approveAll();
  const owned = () => wardrobe(db, people.ana.id).filter((o) => o.owned).map((o) => o.slug);
  assert.deepEqual(owned(), ['classic', 'sun-hat', 'rain-slicker']);
  give(people.ana.id, 'early-bird-100');
  give(people.ana.id, 'four-week-streak');
  assert.deepEqual(owned(), ['classic', 'sun-hat', 'rain-slicker', 'early-bird', 'winter-parka']);
  setOutfitStatus(db, 'winter-parka', 'hidden');
  assert.ok(!owned().includes('winter-parka'));
  assert.equal(setOutfitStatus(db, 'classic', 'hidden'), false); // Classic always stays
});

test('weather: codes and temperatures map to rain, snow, cold, hot and mild; Gary dresses for it', async () => {
  assert.equal(conditionFrom({ code: 61, tempF: 60 }), 'rain');
  assert.equal(conditionFrom({ code: 95, tempF: 80 }), 'rain');
  assert.equal(conditionFrom({ code: 73, tempF: 20 }), 'snow');
  assert.equal(conditionFrom({ code: 1, tempF: 45 }), 'cold');
  assert.equal(conditionFrom({ code: 0, tempF: 85 }), 'hot');
  assert.equal(conditionFrom({ code: 2, tempF: 70 }), 'mild');

  const { db, people, give, approveAll } = await world();
  approveAll();
  const user = () => db.prepare('SELECT * FROM users WHERE id = ?').get(people.ana.id);
  const wear = (condition) => outfitFor(db, user(), condition ? { condition, tempF: 50 } : null).outfit.slug;
  assert.equal(wear('rain'), 'rain-slicker');
  assert.equal(wear('hot'), 'sun-hat');
  assert.equal(wear('snow'), 'classic'); // no parka yet
  assert.equal(wear(null), 'classic'); // weather unknown
  give(people.ana.id, 'four-week-streak');
  assert.equal(wear('snow'), 'winter-parka');
  // A chosen outfit wins over the weather, until it's no longer owned.
  assert.ok(chooseOutfit(db, people.ana.id, 'sun-hat'));
  assert.equal(wear('snow'), 'sun-hat');
  assert.equal(chooseOutfit(db, people.ana.id, 'explorer'), false); // not unlocked
  setOutfitStatus(db, 'sun-hat', 'hidden');
  assert.equal(wear('snow'), 'winter-parka');
  // Visitors get the starters.
  assert.equal(outfitFor(db, null, { condition: 'rain' }).outfit.slug, 'rain-slicker');
});

test('the weather service caches per city for an hour, refreshes in the background, and survives failures', async () => {
  let calls = 0;
  let fail = false;
  let t = Date.parse('2026-11-25T12:00:00Z');
  const fetch = async (url) => {
    calls += 1;
    assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=44\.058&longitude=-121\.315&/);
    if (fail) throw new Error('down');
    return { ok: true, json: async () => ({ current: { temperature_2m: 28.4, weather_code: 73 } }) };
  };
  const w = createWeather({ fetch, now: () => new Date(t) });
  const bend = { key: 'bend', center: { lat: 44.058, lng: -121.315 } };
  assert.equal(w.current(bend), null); // first look: nothing yet, a fetch starts
  await w.refresh(bend);
  assert.deepEqual(w.current(bend), { condition: 'snow', tempF: 28, code: 73 });
  assert.equal(calls, 1);
  t += 30 * 60e3;
  w.current(bend);
  assert.equal(calls, 1); // still fresh
  t += 31 * 60e3;
  fail = true;
  assert.equal(w.current(bend).condition, 'snow'); // stale, but still shown while refreshing
  await w.refresh(bend);
  assert.equal(w.current(bend).condition, 'snow'); // a failure keeps the last answer
  assert.equal(w.current({ key: 'nowhere' }), null);
});

test('Account › Gary\'s wardrobe: pick an outfit, it shows in the lower right; locked ones say how to unlock', async () => {
  const { db, people, approveAll, weather } = await world();
  approveAll();
  weather.value = { condition: 'rain', tempF: 52 };
  const page = (await people.ana.c.get('/account/gary')).body;
  assert.match(page, /<h1>Gary’s wardrobe<\/h1>/);
  assert.match(page, /Today in St\. Pete: rainy, 52°F\./);
  assert.match(page, /value="sun-hat"/);
  assert.match(page, /Earn Four-Week Streak to unlock\./);
  assert.match(page, /Earn a hidden badge to unlock\./); // Founding Member and Early Bird Edition are hidden badges
  assert.doesNotMatch(page, /Night Owl|Weekend Warrior|Golden Acorn/); // hidden and lucky badges stay a surprise
  // Dressed for the rain by default.
  assert.match((await people.ana.c.get('/st-pete/parks')).body, /class="gary-fab">[\s\S]*#ffc83d/);
  assert.equal((await people.ana.c.post('/account/gary', { outfit: 'explorer' })).statusCode, 422);
  const saved = await people.ana.c.post('/account/gary', { outfit: 'sun-hat' });
  assert.equal(saved.headers.location, '/account/gary?done=saved');
  assert.equal(db.prepare('SELECT gary_outfit FROM users WHERE id = ?').pluck().get(people.ana.id), 'sun-hat');
  const parks = (await people.ana.c.get('/st-pete/parks')).body;
  assert.match(parks, /class="gary-fab">[\s\S]*#ff7a59/); // the sun hat's coral shirt
  // A pick that an admin hides since: Gary goes back to the weather, and so does the form.
  setOutfitStatus(db, 'sun-hat', 'hidden');
  assert.match((await people.ana.c.get('/account/gary')).body, /value="" checked/);
  setOutfitStatus(db, 'sun-hat', 'approved');
  await people.ana.c.post('/account/gary', { outfit: '' });
  assert.equal(db.prepare('SELECT gary_outfit FROM users WHERE id = ?').pluck().get(people.ana.id), null);
});

test('Admin › Gary: admins approve, hide and edit outfits; members get 404', async () => {
  const { db, people } = await world();
  assert.equal((await people.ana.c.get('/admin/gary')).statusCode, 404);
  assert.equal((await people.ana.c.post('/admin/gary/sun-hat/status', { status: 'approved' })).statusCode, 404);
  const page = (await people.boss.c.get('/admin/gary')).body;
  assert.match(page, /1 approved · 13 drafts · 0 hidden/);
  assert.match(page, /role="img" aria-label="Gary in the Early Bird outfit"/);
  await people.boss.c.post('/admin/gary/sun-hat/status', { status: 'approved' });
  assert.equal(db.prepare("SELECT status FROM gary_outfits WHERE slug = 'sun-hat'").pluck().get(), 'approved');
  const bad = await people.boss.c.post('/admin/gary/sun-hat', { name: '' });
  assert.equal(bad.statusCode, 422);
  await people.boss.c.post('/admin/gary/explorer', { name: 'Trail boss', blurb: 'Hat!', unlock_badges: 'ten-parks' });
  const row = db.prepare("SELECT name, unlock_badges, starter FROM gary_outfits WHERE slug = 'explorer'").get();
  assert.deepEqual({ ...row }, { name: 'Trail boss', unlock_badges: '["ten-parks"]', starter: 0 });
  assert.equal((await people.boss.c.post('/admin/gary/nope', { name: 'x' })).statusCode, 404);
});

test("Gary's wardrobe is a tap away: from his chat panel and from the home page Gary; not when signed out", async () => {
  const { app, people } = await world();
  const page = (await people.ana.c.get('/st-pete/parks')).body;
  assert.match(page, /class="gary-dress-link"><a href="\/account\/gary">/);
  const home = (await people.ana.c.get('/st-pete')).body;
  assert.match(home, /<a class="gary-dress" href="\/account\/gary"/);
  assert.doesNotMatch((await client(app).get('/st-pete/parks')).body, /gary-dress-link/);
});
