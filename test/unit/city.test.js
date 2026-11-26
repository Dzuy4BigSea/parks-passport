import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { sanitizeSvg } from '../../src/lib/svg-sanitize.js';
import { seedCityPack, seedThemeIfEmpty, getTheme, clearThemeCache, collections, areaForPark, motifForPark, cleanMotif } from '../../src/domain/city.js';
import { weeklyStreak, closestBadge } from '../../src/domain/engagement.js';
import { cleanThemeResult, themeJob } from '../../src/domain/theme-job.js';
import { createThemeGenerator } from '../../src/lib/theme-ai.js';
import { SEED_CITY_JSON } from '../../src/db/seed.js';

const SEED = JSON.parse(fs.readFileSync(SEED_CITY_JSON, 'utf8'));
const PW = 'correct horse battery';
const ICON = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="10"/><path d="M4 40h40"/></svg>';

// ---- SVG sanitizer ----

test('sanitizer: every seed icon passes and comes back normalized', () => {
  for (const m of SEED.motifs) {
    const out = sanitizeSvg(m.svg);
    assert.ok(out, m.slug);
    assert.match(out, /^<svg viewBox="0 0 48 48" fill="none" stroke="currentColor"/);
  }
});

test('sanitizer: anything beyond plain shapes is rejected', () => {
  const bad = [
    '<svg viewBox="0 0 48 48"><script>alert(1)</script></svg>',
    '<svg viewBox="0 0 48 48"><path d="M0 0" onload="alert(1)"/></svg>',
    '<svg viewBox="0 0 48 48"><path d="M0 0" style="fill:red"/></svg>',
    '<svg viewBox="0 0 48 48"><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>',
    '<svg viewBox="0 0 48 48"><use href="#x"/></svg>',
    '<svg viewBox="0 0 48 48"><text>hi</text></svg>',
    '<svg viewBox="0 0 48 48">hello<path d="M0 0"/></svg>',
    '<svg viewBox="0 0 48 48"><!-- x --><path d="M0 0"/></svg>',
    '<svg viewBox="0 0 48 48"><path d="M0 0" fill="url(#g)"/></svg>',
    '<svg viewBox="0 0 48 48"><path d=M0/></svg>',
    '<svg viewBox="0 0 48 48"><path d="M0 0&#x22;"/></svg>',
    '<svg viewBox="0 0 48 48"><foreignObject><div/></foreignObject></svg>',
    '<svg viewBox="0 0 48 48"><g><path d="M0 0"/></svg>',
    '<svg viewBox="0 0 48 48"><svg><path d="M0 0"/></svg></svg>',
    '<svg viewBox="0 0 48 48"><path d="M0 0"/></svg><script>x</script>',
    '<svg viewBox="0 0 48 48"></svg>',
    `<svg viewBox="0 0 48 48">${'<path d="M0 0"/>'.repeat(61)}</svg>`,
    '<svg viewBox="0 0 48 48"><path constructor="x"/></svg>',
    '<svg viewBox="0 0 48 48"><path toString="x" valueOf="y"/></svg>',
    'not svg', '', null,
  ];
  for (const s of bad) assert.equal(sanitizeSvg(s), null, String(s));
});

test('sanitizer: keeps allowed attributes, drops the root\'s own attributes, defaults the viewBox', () => {
  const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" viewBox="0 0 24 24"><g transform="rotate(45 12 12)"><rect x="2" y="2" width="20" height="20" rx="4" fill="none"/></g></svg>');
  assert.equal(out, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(45 12 12)"><rect x="2" y="2" width="20" height="20" rx="4" fill="none"/></g></svg>');
  assert.match(sanitizeSvg('<path d="M1 1L5 5"/>'), /viewBox="0 0 48 48"/);
});

// ---- City theme ----

function cityApp(opts = {}) {
  const made = makeApp(opts);
  importParksCsv(made.db, [
    PARK_CSV_COLUMNS.join(','),
    'abercrombie-park,Abercrombie Park,,,27.8065,-82.75531,,,,0',
    'crescent-lake-park,Crescent Lake Park,,,27.7879,-82.6400,,,,0',
    'lake-vista-park,Lake Vista Park,,,27.7080,-82.6550,,,,0',
    'auburn-street-park,Auburn Street Park,,,,,,,,0',
  ].join('\n'));
  seedThemeIfEmpty(made.db, SEED);
  return made;
}

test('theme: seeding is one-time; only approved motifs with valid icons are live', () => {
  const { db } = cityApp();
  assert.equal(seedThemeIfEmpty(db, SEED), 0);
  const theme = getTheme(db);
  assert.equal(theme.name, 'St. Petersburg');
  assert.equal(theme.motifs.length, SEED.motifs.length);
  db.prepare("UPDATE city_motifs SET status = 'draft' WHERE slug = 'pier'").run();
  db.prepare("UPDATE city_motifs SET svg = '<svg><script/></svg>' WHERE slug = 'pelican'").run();
  clearThemeCache(db);
  const slugs = getTheme(db).motifs.map((m) => m.slug);
  assert.ok(!slugs.includes('pier'));
  assert.ok(!slugs.includes('pelican'));
});

test('theme: parks fall into the nearest area; unpinned parks go to "Other parks"; motif per park is stable', () => {
  const { db } = cityApp();
  const theme = getTheme(db);
  const parks = db.prepare('SELECT slug, name, lat, lng FROM parks').all().map((p) => ({ ...p, first_visit: p.slug === 'lake-vista-park' ? '2026-06-01' : null }));
  assert.equal(areaForPark(theme, parks.find((p) => p.slug === 'abercrombie-park')).slug, 'west');
  assert.equal(areaForPark(theme, parks.find((p) => p.slug === 'lake-vista-park')).slug, 'pinellas-point');
  const groups = collections(theme, parks);
  assert.deepEqual(groups.map((g) => g.slug), ['downtown', 'west', 'pinellas-point', 'other']);
  assert.equal(groups.find((g) => g.slug === 'pinellas-point').stamped, 1);
  assert.equal(groups.reduce((n, g) => n + g.total, 0), 4);
  assert.equal(motifForPark(theme, 'crescent-lake-park').slug, motifForPark(theme, 'crescent-lake-park').slug);
});

test('cleanMotif and cleanThemeResult validate model output', () => {
  assert.ok(cleanMotif({ name: 'Pier', svg: ICON }).motif);
  assert.ok(cleanMotif({ name: '', svg: ICON }).errors.name);
  assert.ok(cleanMotif({ name: 'X', svg: '<svg><script/></svg>' }).errors.svg);
  const r = cleanThemeResult({
    tagline: '  Sunshine   City ', accent: '#123ABC', accent_2: 'red',
    motifs: [
      { name: 'Pier', blurb: 'b', svg: ICON }, { name: 'pier', blurb: 'dup', svg: ICON },
      { name: 'Bad', blurb: 'b', svg: '<svg><script/></svg>' }, { name: 'Sunshine City', blurb: 'exists', svg: ICON },
      ...Array.from({ length: 20 }, (_, i) => ({ name: `M${i}`, blurb: 'b', svg: ICON })),
    ],
  }, ['Sunshine City']);
  assert.equal(r.motifs.length, 12);
  assert.equal(r.rejected, 3);
  assert.deepEqual(r.suggestion, { tagline: 'Sunshine City', accent: '#123ABC', accent_2: null });
  assert.equal(cleanThemeResult(null).motifs.length, 0);
});

// ---- Engagement ----

test('weekly streak counts back from this week, or from last week when this week is empty (at risk)', () => {
  // 2026-06-03 is a Wednesday; weeks start Monday.
  assert.deepEqual(weeklyStreak([], '2026-06-03'), { weeks: 0, activeThisWeek: false, atRisk: false });
  assert.deepEqual(weeklyStreak(['2026-06-01', '2026-05-27', '2026-05-18'], '2026-06-03'), { weeks: 3, activeThisWeek: true, atRisk: false });
  assert.deepEqual(weeklyStreak(['2026-05-31', '2026-05-20'], '2026-06-03'), { weeks: 2, activeThisWeek: false, atRisk: true });
  assert.deepEqual(weeklyStreak(['2026-05-20'], '2026-06-03'), { weeks: 0, activeThisWeek: false, atRisk: false });
});

test('closest badge: most progress first, earned and finished badges skipped', () => {
  const b = (slug, progress, target, state = 'known') => ({ slug, name: slug, art: '🏅', progress, target, unit: 'parks', state });
  assert.equal(closestBadge([]), null);
  assert.equal(closestBadge([b('a', 1, 10), b('b', 3, 5), b('c', 5, 5), b('d', 9, 10, 'earned')]).slug, 'b');
  assert.equal(closestBadge([b('a', 0, 10), b('b', 0, 1)]).slug, 'b');
  assert.equal(closestBadge([b('b', 3, 5)]).remaining, 2);
});

// ---- One-tap stamp ----

async function member(app, email = 'sam@example.com') {
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email, password: PW });
  return c;
}

test('/stamp: inside a park stamps it by GPS; far away stamps nothing and lists the closest parks', async () => {
  const { app, db } = cityApp({ now: testClock('2026-06-01T16:00:00Z') });
  const out = await client(app).get('/stamp');
  assert.equal(out.statusCode, 302);
  const sam = await member(app);
  assert.equal((await sam.get('/stamp')).statusCode, 200);

  const far = await sam.post('/stamp', { lat: '27.7600', lng: '-82.7000', accuracy: '10' });
  assert.equal(far.statusCode, 422);
  assert.match(far.body, /from the closest park/);
  assert.match(far.body, /class="finder-list"/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM visits').pluck().get(), 0);
  assert.doesNotMatch(far.body, /27\.76/); // the position is never echoed back

  const none = await sam.post('/stamp', { lat: 'x', lng: '' });
  assert.equal(none.statusCode, 422);

  const ok = await sam.post('/stamp', { lat: '27.7880', lng: '-82.6401', accuracy: '15' });
  assert.equal(ok.statusCode, 303);
  assert.match(ok.headers.location, /^\/st-pete\/parks\/crescent-lake-park\?stamped=\d+$/);
  const visit = db.prepare('SELECT * FROM visits').get();
  assert.equal(visit.method, 'gps');

  const page = await sam.get(ok.headers.location);
  assert.match(page.body, /Stamped! \+15 points/);
  assert.match(page.body, /Closest new park/);

  const again = await sam.post('/stamp', { lat: '27.7880', lng: '-82.6401', accuracy: '15' });
  assert.equal(again.statusCode, 422);
  assert.match(again.body, /Already stamped today/);
});

test('/stamp: stamps the nearest park whose radius holds you, even if another park\'s center is nearer', async () => {
  const { app, db } = cityApp({ now: testClock('2026-06-01T16:00:00Z') });
  db.prepare("UPDATE parks SET checkin_radius_m = 1500 WHERE slug = 'abercrombie-park'").run();
  db.prepare("UPDATE parks SET checkin_radius_m = 50, lat = 27.8000, lng = -82.7400 WHERE slug = 'lake-vista-park'").run();
  const sam = await member(app);
  // ~600 m from Lake Vista's moved center (outside its 50 m), ~1.1 km from Abercrombie (inside 1500 m).
  const res = await sam.post('/stamp', { lat: '27.8010', lng: '-82.7460', accuracy: '10' });
  assert.equal(res.statusCode, 303);
  assert.match(res.headers.location, /^\/st-pete\/parks\/abercrombie-park\?stamped=/);
});

test('home: landing page signed out; dashboard with next park, next badge and streak signed in', async () => {
  const { app } = cityApp({ now: testClock('2026-06-01T16:00:00Z') });
  const landing = await client(app).get('/');
  assert.match(landing.body, /Your passport to St\. Pete parks/);
  assert.match(landing.body, /Sunshine City lore/);
  const sam = await member(app);
  await sam.post('/stamp', { lat: '27.7880', lng: '-82.6401', accuracy: '15' });
  const dash = await sam.get('/');
  assert.match(dash.body, /Hi, Sam/);
  assert.match(dash.body, /1 of 4 parks stamped/);
  assert.match(dash.body, /Closest new park/);
  assert.match(dash.body, /1 week in a row/);
  assert.match(dash.body, /class="tabbar"/);
});

// ---- Admin › City theme and the AI generator ----

const fakeGenerator = (result) => ({
  available: true,
  calls: [],
  async generate(args) { this.calls.push(args); if (result instanceof Error) throw result; return result; },
});

async function admin(app, db) {
  const c = await member(app, 'admin@example.com');
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = 'admin@example.com'").run();
  return c;
}

test('admin city: 404 for members; AI drafts stay off the site until approved', async () => {
  const gen = fakeGenerator({ tagline: 'Sunshine City', accent: '#FF8800', accent_2: '#0088FF', motifs: [
    { name: 'Sunken Gardens', blurb: 'A century-old garden.', svg: ICON },
    { name: 'Evil', blurb: 'x', svg: '<svg viewBox="0 0 48 48"><path d="M0 0" onclick="x"/></svg>' },
  ] });
  const { app, db } = cityApp({ themeAi: gen });
  const sam = await member(app);
  assert.equal((await sam.get('/admin/city')).statusCode, 404);
  assert.equal((await sam.post('/admin/city/generate')).statusCode, 404);

  const boss = await admin(app, db);
  assert.match((await boss.get('/admin/city')).body, /Generate landmark drafts/);
  const res = await boss.post('/admin/city/generate');
  assert.equal(res.statusCode, 303);
  await app.themeJobIdle();
  assert.equal(gen.calls[0].city, 'St. Petersburg');
  assert.ok(gen.calls[0].existing.includes('The Pier'));
  const job = themeJob(db);
  assert.equal(job.status, 'done');
  assert.equal(job.added, 1);
  assert.equal(job.rejected, 1);

  const draft = db.prepare("SELECT * FROM city_motifs WHERE name = 'Sunken Gardens'").get();
  assert.equal(draft.status, 'draft');
  assert.equal(draft.source, 'ai');
  assert.ok(!getTheme(db).motifs.some((m) => m.name === 'Sunken Gardens'));
  const adminPage = (await boss.get('/admin/city')).body;
  assert.match(adminPage, /Sunken Gardens/);
  assert.match(adminPage, /Suggested colors/);

  assert.equal((await boss.post(`/admin/city/motifs/${draft.id}/approve`)).statusCode, 303);
  assert.equal(db.prepare('SELECT status FROM city_motifs WHERE id = ?').pluck().get(draft.id), 'approved');
  assert.ok(getTheme(db).motifs.some((m) => m.name === 'Sunken Gardens'));

  // Editing re-sanitizes; a bad icon is refused and nothing changes.
  const bad = await boss.post(`/admin/city/motifs/${draft.id}`, { [`name-${draft.id}`]: 'X', [`blurb-${draft.id}`]: '', [`svg-${draft.id}`]: '<svg><script/></svg>' });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.body, /Not saved\. Fix the problems below/);
  assert.match(bad.body, new RegExp(`id="name-${draft.id}" name="name-${draft.id}" type="text" value="X"`));
  assert.equal(db.prepare('SELECT name FROM city_motifs WHERE id = ?').pluck().get(draft.id), 'Sunken Gardens');
  assert.equal((await boss.post(`/admin/city/motifs/${draft.id}/delete`)).statusCode, 303);
  assert.equal(db.prepare('SELECT COUNT(*) FROM city_motifs WHERE id = ?').pluck().get(draft.id), 0);
});

test('admin city: settings validate colors; a failed generation shows a safe message; no key = button off', async () => {
  const { app, db } = cityApp({ themeAi: fakeGenerator(Object.assign(new Error('secret upstream detail'), { status: 401 })) });
  const boss = await admin(app, db);
  const bad = await boss.post('/admin/city/settings', { city_name: 'St. Petersburg', tagline: 'Sunshine City', accent: 'red', accent_2: '#7C6CF2' });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.body, /hex color/);
  const good = await boss.post('/admin/city/settings', { city_name: 'St. Petersburg', tagline: 'The Burg', accent: '#FF8800', accent_2: '#7C6CF2' });
  assert.equal(good.statusCode, 303);
  assert.match((await client(app).get('/')).body, /--city-accent:#FF8800/);

  await boss.post('/admin/city/generate');
  await app.themeJobIdle();
  const page = (await boss.get('/admin/city')).body;
  assert.match(page, /API key was rejected/);
  assert.doesNotMatch(page, /secret upstream detail/);

  const added = await boss.post('/admin/city/motifs/new', { name: 'Fossil', blurb: '', svg: ICON });
  assert.equal(added.statusCode, 303);
  assert.equal(db.prepare("SELECT status FROM city_motifs WHERE name = 'Fossil'").pluck().get(), 'approved');

  const { app: app2, db: db2 } = cityApp();
  const boss2 = await admin(app2, db2);
  assert.match((await boss2.get('/admin/city')).body, /Set <code>ANTHROPIC_API_KEY<\/code>/);
  await boss2.post('/admin/city/generate');
  assert.equal(themeJob(db2), null);
});

test('theme generator: resumes paused turns, nudges once for the tool call, and stops on refusal', async () => {
  const replies = [];
  const requests = [];
  const fake = { beta: { messages: { create: async (req) => { requests.push(structuredClone(req)); return replies.shift(); } } } };
  const gen = createThemeGenerator({ apiKey: 'test', clientFactory: () => fake });
  const done = { name: 'save_city_theme', type: 'tool_use', id: 't1', input: { tagline: 'x', accent: '#000000', accent_2: '#ffffff', motifs: [] } };
  replies.push({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'searching' }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    { stop_reason: 'tool_use', content: [done] });
  const out = await gen.generate({ city: 'St. Petersburg', existing: [] });
  assert.equal(out.tagline, 'x');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].model, 'claude-opus-5-5');
  assert.equal(requests[1].messages.length, 2); // resumed with the paused assistant turn
  assert.match(requests[2].messages.at(-1).content, /save_city_theme/);

  replies.push({ stop_reason: 'refusal', content: [] });
  await assert.rejects(gen.generate({ city: 'x' }), /declined/);
  assert.equal(createThemeGenerator({ apiKey: '' }).available, false);
});

test('theme job: internal errors and timeouts never reach the page word for word', async () => {
  const { app, db } = cityApp({ themeAi: fakeGenerator(new TypeError('rule.test is not a function')) });
  const boss = await admin(app, db);
  await boss.post('/admin/city/generate');
  await app.themeJobIdle();
  assert.equal(themeJob(db).error, 'Generation failed. Check the server log.');

  const slow = { beta: { messages: { create: (req, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) } } };
  const gen = createThemeGenerator({ apiKey: 'test', clientFactory: () => slow });
  const err = await gen.generate({ city: 'x' }, { deadlineMs: 20 }).catch((e) => e);
  assert.equal(err.name, 'TimeoutError');
  const { app: app2, db: db2 } = cityApp({ themeAi: { available: true, generate: () => Promise.reject(err) } });
  const boss2 = await admin(app2, db2);
  await boss2.post('/admin/city/generate');
  await app2.themeJobIdle();
  assert.equal(themeJob(db2).error, 'Generation took too long and was stopped. Try again.');
});

test('city photos: St. Pete pages get the background photos and a credits page; other themes do not', async () => {
  const { app } = cityApp();
  const home = (await client(app).get('/')).body;
  assert.match(home, /--photo-hero:url\(\/city\/st-pete\/pier-sunrise\.webp\);/);
  assert.match(home, /<a href="\/credits">Photo credits<\/a>/);
  const credits = await client(app).get('/credits');
  assert.equal(credits.statusCode, 200);
  assert.match(credits.body, /Andrew Heneen/);
  assert.match(credits.body, /CC BY 4\.0/);
  assert.match(credits.body, /commons\.wikimedia\.org\/wiki\/File:Saint_Petersburg_Pier_at_sunrise\.jpg/);
  assert.match(credits.body, /Converted to grayscale/);
  for (const f of ['pier-sunrise', 'pier-point', 'mangroves']) {
    assert.equal((await client(app).get(`/city/st-pete/${f}.webp`)).statusCode, 200, f);
  }
  // A city without photos: no background photos and no credits page.
  seedCityPack(app.db, { key: 'testville', name: 'Testville', accent: '#112233', accent_2: '#445566' });
  const visitor = client(app);
  assert.doesNotMatch((await visitor.get('/testville')).body, /--photo-hero/);
  assert.equal((await visitor.get('/credits')).statusCode, 404);
});

test('Gary picks the most useful tip, in order, and is honest about distances', async () => {
  const { garyTip } = await import('../../src/views/gary.js');
  const nearest = { slug: 'pioneer-park', city_key: 'st-pete', name: 'Pioneer Park', where: 'right downtown' };
  const streak = { weeks: 0, activeThisWeek: false, atRisk: false };
  assert.match(garyTip({ stamped: 2, stampedToday: { slug: 'x', name: 'Vinoy Park' }, streak, nearest }).text.toString().replace(/<[^>]+>/g, ''), /Nice work at Vinoy Park today/);
  const first = garyTip({ stamped: 0, streak, nearest });
  assert.match(first.text.toString().replace(/<[^>]+>/g, ''), /first stamp\. Pioneer Park is right downtown/);
  assert.equal(first.action.href, '/st-pete/parks/pioneer-park');
  assert.match(garyTip({ stamped: 3, streak: { weeks: 3, activeThisWeek: false, atRisk: true }, nearest }).text.toString().replace(/<[^>]+>/g, ''), /3 weeks streak going/);
  assert.match(garyTip({ stamped: 5, streak, almost: { name: 'Downtown', stamped: 22, total: 24 }, nearest }).text.toString().replace(/<[^>]+>/g, ''), /Only 2 parks left to finish Downtown/);
  assert.match(garyTip({ stamped: 4, streak, nextBadge: { name: 'Five Parks', remaining: 1 }, nearest }).text.toString().replace(/<[^>]+>/g, ''), /One more and Five Parks is yours/);
  assert.match(garyTip({ stamped: 4, streak, lore: { blurb: 'Pelicans dive.' }, nearest }).text.toString().replace(/<[^>]+>/g, ''), /Here's one I love: Pelicans dive\./);
});

test('home: "Use my location" measures closest parks from you, with walk times; punch card shows 8 weeks', async () => {
  const { weekPunches } = await import('../../src/domain/engagement.js');
  const punches = weekPunches(['2026-06-01', '2026-05-20'], '2026-06-03', 8);
  assert.equal(punches.length, 8);
  assert.deepEqual(punches.filter((w) => w.on).map((w) => w.label), ['May 18', 'Jun 1']);
  assert.ok(punches.at(-1).current);

  const { app } = cityApp({ now: testClock('2026-06-01T16:00:00Z') });
  const sam = await member(app);
  const plain = (await sam.get('/')).body;
  assert.match(plain, /Around downtown/);
  assert.match(plain, /is right downtown/);
  const located = (await sam.get('/?lat=27.7880&lng=-82.6401')).body;
  assert.match(located, /From where you are now/);
  assert.match(located, /\d+ min walk/);
  assert.match(located, /class="constellation"/);
  assert.match(located, /Your first stamp goes here/);
});
