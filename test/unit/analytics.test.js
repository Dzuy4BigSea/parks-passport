import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { EVENTS, buildEvent, parseConsent, serializeConsent, inlineJson } from '../../src/lib/analytics.js';
import { loadConfig } from '../../src/config.js';

const ANALYTICS = { gtmId: 'GTM-TEST123', gtmScriptOrigin: 'https://sgtm.example.test', umamiWebsiteId: '0f2c3d4e-1234-4abc-8def-123456789abc', umamiScriptUrl: '/stats/script.js', umamiHostUrl: 'https://pp.test/stats' };

test('the event list matches the spec exactly', () => {
  assert.deepEqual(Object.keys(EVENTS).sort(), ['badge_earned', 'check_in', 'consent_update', 'level_up', 'login', 'pal_accepted',
    'pal_invite_created', 'park_search', 'park_view', 'photo_upload', 'rating_submit', 'share_prompt_action', 'sign_up',
    'activity_log'].sort());
  assert.deepEqual(buildEvent('check_in', { park_slug: 'a-park', method: 'gps' }), { event: 'check_in', park_slug: 'a-park', method: 'gps' });
});

test('PII guard: unknown events, wrong keys, "@" and long values are refused', () => {
  assert.throws(() => buildEvent('page_secret', {}), /Unknown analytics event/);
  assert.throws(() => buildEvent('sign_up', {}), /needs exactly \[method\]/);
  assert.throws(() => buildEvent('sign_up', { method: 'password', email: 'a@b.co' }), /needs exactly/);
  assert.throws(() => buildEvent('login', { method: 'sam@example.com' }), /not allowed/);
  assert.throws(() => buildEvent('park_view', { park_slug: 'x'.repeat(101) }), /not allowed/);
  assert.throws(() => buildEvent('rating_submit', { park_slug: 'a', stars: { n: 5 } }), /not allowed/);
  assert.ok(buildEvent('park_view', { park_slug: 'x'.repeat(100) }));
});

test('inline JSON cannot close the script element', () => {
  const out = inlineJson({ a: '</script><script>alert(1)</script> ' });
  assert.ok(!out.includes('<'));
  assert.ok(!out.includes(' '));
  assert.deepEqual(JSON.parse(out), { a: '</script><script>alert(1)</script> ' });
});

test('consent cookie format', () => {
  assert.deepEqual(parseConsent(undefined), { chosen: false, analytics: false, ads: false });
  assert.deepEqual(parseConsent('v1.a1.d0'), { chosen: true, analytics: true, ads: false });
  assert.deepEqual(parseConsent('junk'), { chosen: false, analytics: false, ads: false });
  assert.equal(serializeConsent({ analytics: false, ads: true }), 'v1.a0.d1');
});

test('config: GTM and Umami load only with valid ids; the GTM origin is configurable', () => {
  assert.equal(loadConfig({}).analytics.gtmId, '');
  assert.equal(loadConfig({ GTM_ID: 'not-an-id' }).analytics.gtmId, '');
  const c = loadConfig({ GTM_ID: 'GTM-ABC1234', GTM_SCRIPT_ORIGIN: 'https://sgtm.pp.test/', UMAMI_WEBSITE_ID: ANALYTICS.umamiWebsiteId, BASE_URL: 'https://pp.test' });
  assert.equal(c.analytics.gtmScriptOrigin, 'https://sgtm.pp.test');
  assert.equal(c.analytics.umamiHostUrl, 'https://pp.test/stats');
});

function setup(analytics = ANALYTICS) {
  const { app, db } = makeApp({ analytics, now: testClock() });
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','), 'a-park,A Park,,,27.80,-82.70,,dog-park,,0'].join('\n'));
  return { app, db };
}
const pageEvents = (body) => JSON.parse(body.match(/window\.__ppEvents = (\[.*?\]);/)[1]);

test('head: consent defaults all denied before GTM loads; GTM from the configured origin; Umami loads', async () => {
  const { app } = setup();
  const body = (await client(app).get('/')).body;
  const def = body.indexOf("gtag('consent', 'default', {analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied'");
  const loader = body.indexOf('<script async src="https://sgtm.example.test/gtm.js?id=GTM-TEST123">');
  assert.ok(def > 0 && loader > def, 'default before the loader');
  assert.match(body, /<script defer src="\/stats\/script.js" data-website-id="0f2c3d4e-1234-4abc-8def-123456789abc" data-host-url="https:\/\/pp.test\/stats">/);
  // Without ids nothing loads and there is no banner.
  const off = (await client(setup(null).app).get('/')).body;
  assert.ok(!off.includes('gtm.js') && !off.includes('data-website-id') && !off.includes('consent-banner'));
});

test('consent banner: shown until a choice is made; accept, reject and custom set the cookie', async () => {
  const { app } = setup();
  const c = client(app);
  assert.match((await c.get('/st-pete/parks')).body, /id="consent-banner"/);
  const res = await c.post('/consent', { choice: 'accept', back: '/st-pete/parks' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/st-pete/parks');
  const cookie = res.cookies.find((x) => x.name === 'pp_consent');
  assert.equal(cookie.value, 'v1.a1.d0');
  assert.ok(cookie.maxAge >= 180 * 86400);
  const page = (await c.get('/st-pete/parks')).body;
  assert.ok(!page.includes('id="consent-banner"'));
  assert.match(page, /\}\)\(\{"analytics":true,"ads":false\}\);/);
  assert.equal((await c.post('/consent', { choice: 'reject', back: '/' })).cookies.find((x) => x.name === 'pp_consent').value, 'v1.a0.d0');
  assert.equal((await c.post('/consent', { choice: 'custom', analytics: '1', ads: '1', back: '/' })).cookies.find((x) => x.name === 'pp_consent').value, 'v1.a1.d1');
  const json = await app.inject({ method: 'POST', url: '/consent', payload: `_csrf=${c.jar.get('pp_csrf')}&choice=accept`,
    headers: { cookie: `pp_csrf=${c.jar.get('pp_csrf')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
  assert.equal(json.statusCode, 204);
  assert.equal((await c.post('/consent', { choice: 'accept', back: '//evil.example' })).headers.location, '/passport');
});

test('events: page events, queued events after redirects, badges and level-ups, with no personal data', async () => {
  const { app, db } = setup();
  const c = client(app);
  assert.deepEqual(pageEvents((await c.get('/st-pete/parks?q=lake&cat=dog-park')).body), [{ event: 'park_search', has_query: true, filter_count: 1 }]);
  assert.deepEqual(pageEvents((await c.get('/st-pete/parks')).body), []);
  assert.deepEqual(pageEvents((await c.get('/st-pete/parks/a-park')).body), [{ event: 'park_view', park_slug: 'a-park' }]);

  const signup = await c.post('/signup', { display_name: 'Sam Explorer', email: 'sam@example.com', password: 'correct horse battery' });
  let landed = await c.get(signup.headers.location); // /passport, which goes on to the city's passport
  if (landed.statusCode === 302) landed = await c.get(landed.headers.location);
  const after = pageEvents(landed.body);
  assert.deepEqual(after, [{ event: 'sign_up', method: 'password' }]);

  db.prepare("INSERT INTO badges (slug, name, rule_type, rule_params, kind, created_at) VALUES ('first', 'First', 'parks_count', '{\"n\":1}', 'known', '2026-01-01')").run();
  const stamp = await c.post('/st-pete/parks/a-park/stamp', {});
  const evs = pageEvents((await c.get(stamp.headers.location)).body);
  assert.deepEqual(evs.map((e) => e.event).sort(), ['badge_earned', 'check_in', 'park_view']);
  assert.deepEqual(evs.find((e) => e.event === 'check_in'), { event: 'check_in', park_slug: 'a-park', method: 'honor' });
  assert.deepEqual(evs.find((e) => e.event === 'badge_earned'), { event: 'badge_earned', badge_slug: 'first', kind: 'known' });
  // Queued events are delivered once.
  assert.ok(!pageEvents((await c.get('/st-pete/passport')).body).some((e) => e.event === 'check_in'));

  await c.post('/st-pete/parks/a-park/rating', { stars: '4', comment: 'my secret comment sam@example.com' });
  const rated = pageEvents((await c.get('/st-pete/parks/a-park')).body);
  assert.deepEqual(rated.find((e) => e.event === 'rating_submit'), { event: 'rating_submit', park_slug: 'a-park', stars: 4 });
  for (const page of ['/st-pete/parks/a-park', '/st-pete/passport', '/pals']) {
    const raw = (await c.get(page)).body.match(/window\.__ppEvents = (\[.*?\]);/)[1];
    assert.ok(!raw.includes('@') && !raw.includes('Sam Explorer') && !raw.includes('secret'), page);
  }
});

test('Pals and share-prompt events', async () => {
  const { app, db } = setup();
  const a = client(app);
  const b = client(app);
  await a.post('/signup', { display_name: 'Ana', email: 'ana@example.com', password: 'correct horse battery' });
  await b.post('/signup', { display_name: 'Ben', email: 'ben@example.com', password: 'correct horse battery' });
  await a.get('/st-pete/passport');
  await b.get('/st-pete/passport');
  const palsPage = (await a.get('/pals')).body;
  assert.ok(pageEvents(palsPage).some((e) => e.event === 'pal_invite_created'));
  const link = palsPage.match(/\/pals\/invite\/[A-Za-z0-9_-]+/)[0];
  await b.post(`${link}/accept`);
  assert.ok(pageEvents((await b.get('/pals')).body).some((e) => e.event === 'pal_accepted'));
  await a.post('/account/nudge/dismiss', { back: '/st-pete/parks' });
  assert.deepEqual(pageEvents((await a.get('/st-pete/parks')).body), [{ event: 'share_prompt_action', action: 'dismiss' }]);
  await a.post('/account/visibility', { default_visibility: 'pals', back: '/st-pete/parks', source: 'nudge' });
  assert.deepEqual(pageEvents((await a.get('/st-pete/parks')).body), [{ event: 'share_prompt_action', action: 'share' }]);
  assert.equal(db.prepare('SELECT COUNT(*) FROM analytics_events').pluck().get(), 0);
});

test('pages with tokens or handles in the URL load no analytics and leak no query string', async () => {
  const { app, db } = setup();
  const c = client(app);
  await c.post('/signup', { display_name: 'Ana', email: 'ana@example.com', password: 'correct horse battery' });
  db.prepare("UPDATE users SET default_visibility = 'public'").run();
  const invite = (await c.get('/pals')).body.match(/\/pals\/invite\/[A-Za-z0-9_-]+/)[0];
  const anon = client(app);
  for (const url of ['/reset?token=SECRET123', '/auth/magic?token=SECRET123', '/account/delete/confirm?token=SECRET123', invite, '/u/ana']) {
    const body = (await anon.get(url)).body;
    assert.ok(!body.includes('gtm.js') && !body.includes('data-website-id'), `no analytics on ${url}`);
    assert.ok(!body.includes('consent-banner'), `no banner on ${url}`);
    assert.ok(!/consent\?back=[^"]*token/.test(body), `no token in consent links on ${url}`);
  }
  assert.match((await anon.get('/st-pete/parks')).body, /gtm\.js/);
});

test('withdrawing analytics consent clears _ga cookies', async () => {
  const { app } = setup();
  const c = client(app);
  await c.get('/');
  c.jar.set('_ga', 'GA1.1.123');
  c.jar.set('_ga_ABC123', 'GS1.1.456');
  const res = await c.post('/consent', { choice: 'custom', back: '/' });
  const cleared = res.cookies.filter((x) => x.name.startsWith('_ga') && (x.value === '' || x.maxAge === 0 || x.expires?.getTime() === 0));
  assert.deepEqual([...new Set(cleared.map((x) => x.name))].sort(), ['_ga', '_ga_ABC123']);
  const keep = await c.post('/consent', { choice: 'accept', back: '/' });
  assert.ok(!keep.cookies.some((x) => x.name.startsWith('_ga')));
});

test('/privacy names Umami, GA4 via GTM and every cookie', async () => {
  const { app } = setup();
  const body = (await client(app).get('/privacy')).body;
  for (const text of ['Umami', 'Google Analytics 4', 'Google Tag Manager', 'pp_consent', 'pp_session', 'pp_csrf', '_ga']) {
    assert.ok(body.includes(text), text);
  }
});

test('a photo stamp records photo_upload as well as check_in', async () => {
  const { app } = setup();
  const sharp = (await import('sharp')).default;
  const c = client(app);
  await c.post('/signup', { display_name: 'Ana', email: 'ana@example.com', password: 'correct horse battery' });
  const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2f6f4e' } }).jpeg().toBuffer();
  const res = await c.postMultipart('/st-pete/parks/a-park/stamp', {}, { photo: { buffer: jpeg, filename: 'a.jpg', type: 'image/jpeg' } });
  const evs = pageEvents((await c.get(res.headers.location)).body).map((e) => e.event);
  assert.ok(evs.includes('check_in') && evs.includes('photo_upload'), evs.join(','));
});
