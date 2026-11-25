// M31: Gary on every screen (SPEC Flow 21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client } from './helpers.js';
import { seedCities } from '../../src/db/seed.js';
import { grantBadge } from '../../src/domain/badges/index.js';
import { ALL_SCREENS, SIGN_OFFS, REPLIES, screenFor, garyTipFor, garyReply } from '../../src/views/gary-help.js';

const PW = 'correct horse battery';

test('every screen has at least 4 tips; tips get a sign-off; replies fit each kind', () => {
  for (const s of ALL_SCREENS) {
    assert.ok(s.tips.length >= 4, s.key);
    assert.equal(new Set(s.tips).size, s.tips.length, `${s.key}: no repeats`);
    for (const t of s.tips) assert.ok(t.length <= 220, `${s.key}: short enough: ${t}`);
  }
  assert.ok(SIGN_OFFS.length >= 4);
  for (const kind of ['idea', 'bug', 'love']) assert.ok(REPLIES[kind].length >= 4, kind);
  const tip = garyTipFor('/st-pete/parks', () => 0);
  assert.equal(tip.screen, 'parks');
  assert.ok(SIGN_OFFS.includes(tip.signOff));
  assert.notEqual(garyTipFor('/st-pete/parks', () => 0).tip, garyTipFor('/st-pete/parks', () => 0.99).tip); // variations
  assert.ok(REPLIES.bug.includes(garyReply('bug')));
  assert.ok(REPLIES.idea.includes(garyReply('nonsense')));
});

test('screens are matched from the path, with or without a city, ignoring the query string', () => {
  const cases = {
    '/': 'home', '/st-pete': 'home', '/bend/parks': 'parks', '/parks?q=x': 'parks', '/bend/parks/drake-park': 'park',
    '/stamp': 'stamp', '/st-pete/passport': 'passport', '/u/sam': 'public', '/pals/invite/abc': 'pals', '/account': 'account',
    '/notifications': 'notifications', '/admin/messages/3': 'admin', '/login': 'auth', '/join/tok': 'auth', '/sunshine': 'sunshine',
    '/feedback': 'feedback', '/ideas': 'ideas', '/privacy': 'other', '/credits': 'other',
  };
  for (const [path, key] of Object.entries(cases)) assert.equal(screenFor(path).key, key, path);
});

test('Gary is on every page for everyone; only founding explorers get the talk-back form', async () => {
  const { app, db } = makeApp();
  seedCities(db);
  const visitor = client(app);
  for (const url of ['/', '/st-pete/parks', '/login', '/privacy']) {
    const body = (await visitor.get(url)).body;
    assert.match(body, /<details class="gary-help" data-gary>/, url);
    assert.match(body, /<span class="visually-hidden">Ask Gary<\/span>/, url);
    assert.doesNotMatch(body, /data-gary-talk/, url);
  }
  const sam = client(app);
  await sam.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: PW });
  const id = db.prepare("SELECT id FROM users WHERE email = 'sam@example.com'").pluck().get();
  // Sam is Founding Member #1 (the first 75), so Sam can talk back.
  const page = (await sam.get('/st-pete/parks')).body;
  assert.match(page, /data-gary-talk/);
  assert.match(page, /name="page" value="\/st-pete\/parks"/);
  assert.match(page, /Talk to Gary/);
  // The tip is for this screen.
  const parksTips = ALL_SCREENS.find((s) => s.key === 'parks').tips;
  assert.ok(parksTips.some((t) => page.includes(t)), 'a parks tip');
  // Everyone else: no form, and /feedback stays 404.
  db.prepare("DELETE FROM user_badges WHERE user_id = ?").run(id);
  const after = (await sam.get('/st-pete/parks')).body;
  assert.doesNotMatch(after, /data-gary-talk/);
  assert.equal((await sam.get('/feedback')).statusCode, 404);
  // Early Bird Edition opens it again.
  const eb = db.prepare("SELECT id FROM badges WHERE slug = 'early-bird-100'").pluck().get();
  grantBadge(db, { admin: { id, display_name: 'Boss' }, userId: id, badgeId: eb });
  assert.match((await sam.get('/st-pete/parks')).body, /data-gary-talk/);
});

test('talking back saves feedback with the page, and Gary replies (JSON, and the page without JS)', async () => {
  const { app, db } = makeApp();
  seedCities(db);
  const sam = client(app);
  await sam.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: PW });
  await sam.get('/st-pete/parks');
  const csrf = [...sam.jar].find(([k]) => k.endsWith('pp_csrf'))[1];
  const res = await app.inject({ method: 'POST', url: '/feedback', payload: new URLSearchParams({ _csrf: csrf, kind: 'bug', text: 'The map jumps', page: '/st-pete/parks' }).toString(),
    headers: { cookie: [...sam.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
  assert.equal(res.statusCode, 200);
  assert.ok(REPLIES.bug.includes(res.json().reply));
  const row = db.prepare('SELECT kind, text, page FROM feedback').get();
  assert.deepEqual({ ...row }, { kind: 'bug', text: 'The map jumps', page: '/st-pete/parks' });
  const plain = await sam.post('/feedback', { kind: 'love', text: 'So fun', page: '/st-pete' });
  assert.equal(plain.headers.location, '/feedback?done=sent&kind=love');
  const thanks = (await sam.get(plain.headers.location)).body;
  assert.ok(REPLIES.love.some((r) => thanks.includes(r)), 'a "love" reply');
});
