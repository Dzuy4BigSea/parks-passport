import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { savedParkIds, setSaved, wantToGo } from '../../src/domain/saved.js';
import { nextParks } from '../../src/domain/engagement.js';

const PW = 'correct horse battery';

async function world() {
  const now = testClock('2026-06-06T16:00:00Z');
  const { app, db } = makeApp({ now });
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','),
    'a-park,A Park,,,27.800,-82.700,,,,0',
    'b-park,B Park,,,27.801,-82.701,,,,0',
    'c-park,C Park,,,27.900,-82.800,,lake,,0'].join('\n'));
  const people = {};
  for (const name of ['ana', 'ben']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  const parkId = (slug) => db.prepare('SELECT id FROM parks WHERE slug = ?').pluck().get(slug);
  return { app, db, people, parkId };
}

const cardSlugs = (body) => [...body.matchAll(/<h2><a href="\/st-pete\/parks\/([a-z0-9-]+)">/g)].map((m) => m[1]);

test('saving and unsaving a park without JS: POST form, redirect back, idempotent', async () => {
  const { db, people, parkId } = await world();
  const { c, id } = people.ana;
  const res = await c.post('/st-pete/parks/c-park/save', { saved: '1', back: '/st-pete/parks?q=park' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/st-pete/parks?q=park');
  await c.post('/st-pete/parks/c-park/save', { saved: '1' }); // double submit: still one row
  assert.equal(db.prepare('SELECT COUNT(*) FROM saved_parks WHERE user_id = ?').pluck().get(id), 1);
  assert.deepEqual([...savedParkIds(db, id)], [parkId('c-park')]);

  const page = await c.get('/st-pete/parks/c-park');
  assert.match(page.body, /action="\/st-pete\/parks\/c-park\/save"[\s\S]*?aria-pressed="true"/);

  const off = await c.post('/st-pete/parks/c-park/save', { saved: '0' });
  assert.equal(off.headers.location, '/st-pete/parks/c-park'); // default back is the park page
  assert.equal(savedParkIds(db, id).size, 0);
  assert.match((await c.get('/st-pete/parks/c-park')).body, /aria-pressed="false"/);
});

test('save route: JSON for the JS toggle, CSRF required, sign-in required, 404 for unknown or inactive parks, unsafe back ignored', async () => {
  const { app, db, people } = await world();
  const { c } = people.ana;
  await c.get('/');
  const csrf = [...c.jar].find(([k]) => k.endsWith('pp_csrf'))[1];
  const cookie = [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const json = await app.inject({ method: 'POST', url: '/st-pete/parks/a-park/save', payload: `_csrf=${csrf}&saved=1`,
    headers: { cookie, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(json.statusCode, 200);
  assert.deepEqual(json.json(), { saved: true });

  assert.equal((await c.post('/st-pete/parks/a-park/save', { saved: '1' }, { csrf: false })).statusCode, 403);
  const anon = await client(app).post('/st-pete/parks/a-park/save', { saved: '1' });
  assert.equal(anon.statusCode, 303);
  assert.equal(anon.headers.location, '/login?next=%2Fst-pete%2Fparks%2Fa-park');
  assert.equal((await c.post('/st-pete/parks/nope/save', { saved: '1' })).statusCode, 404);
  db.prepare("UPDATE parks SET active = 0 WHERE slug = 'b-park'").run();
  assert.equal((await c.post('/st-pete/parks/b-park/save', { saved: '1' })).statusCode, 404, 'inactive park');
  const evil = await c.post('/st-pete/parks/a-park/save', { saved: '1', back: '//evil.example' });
  assert.equal(evil.headers.location, '/passport');
});

test('/parks shows hearts only when signed in, and the Want to go filter lists only my saved parks', async () => {
  const { app, people } = await world();
  const anon = await client(app).get('/st-pete/parks');
  assert.ok(!anon.body.includes('save-form'));
  assert.ok(!anon.body.includes('name="saved"'));
  assert.deepEqual(cardSlugs((await client(app).get('/st-pete/parks?saved=1')).body), ['a-park', 'b-park', 'c-park']); // ignored signed out

  await people.ana.c.post('/st-pete/parks/b-park/save', { saved: '1' });
  await people.ana.c.post('/st-pete/parks/c-park/save', { saved: '1' });
  const all = await people.ana.c.get('/st-pete/parks');
  assert.equal((all.body.match(/class="save-form/g) || []).length, 3);
  assert.equal((all.body.match(/aria-pressed="true"/g) || []).length, 2);
  assert.match(all.body, /aria-label="Want to go: B Park"/);

  const filtered = await people.ana.c.get('/st-pete/parks?saved=1');
  assert.deepEqual(cardSlugs(filtered.body), ['b-park', 'c-park']);
  assert.match(filtered.body, /name="saved" value="1" checked/);
  assert.match(filtered.body, /2 of 3 parks match/);
  // Combines with search.
  assert.deepEqual(cardSlugs((await people.ana.c.get('/st-pete/parks?saved=1&q=c+park')).body), ['c-park']);
  // ...with amenities and with "Not visited yet".
  assert.deepEqual(cardSlugs((await people.ana.c.get('/st-pete/parks?saved=1&cat=lake')).body), ['c-park']);
  await people.ana.c.post('/st-pete/parks/b-park/stamp', {});
  assert.deepEqual(cardSlugs((await people.ana.c.get('/st-pete/parks?saved=1&unvisited=1')).body), ['c-park']);
  // Ben has saved nothing.
  const ben = await people.ben.c.get('/st-pete/parks?saved=1');
  assert.deepEqual(cardSlugs(ben.body), []);
  assert.match(ben.body, /Nothing saved yet/);
});

test('passport Want to go lists saved parks not yet stamped; stamping moves a park off it', async () => {
  const { people } = await world();
  const { c } = people.ana;
  assert.match((await c.get('/st-pete/passport')).body, /<h2 id="want-h">Want to go<\/h2>[\s\S]*Nothing here yet/);
  await c.post('/st-pete/parks/a-park/save', { saved: '1' });
  await c.post('/st-pete/parks/c-park/save', { saved: '1' });
  await c.post('/st-pete/parks/a-park/stamp', {});
  const body = (await c.get('/st-pete/passport')).body;
  const section = body.match(/<section aria-labelledby="want-h"[\s\S]*?<\/section>/)[0];
  assert.ok(section.includes('C Park'));
  assert.ok(!section.includes('A Park'), 'stamped parks leave the list');
  assert.match(section, /action="\/st-pete\/parks\/c-park\/save"/);
});

test('wantToGo skips inactive parks', async () => {
  const { db, people, parkId } = await world();
  const { id } = people.ana;
  setSaved(db, id, parkId('a-park'), true);
  setSaved(db, id, parkId('b-park'), true);
  db.prepare("UPDATE parks SET active = 0 WHERE slug = 'b-park'").run();
  assert.deepEqual(wantToGo(db, id).map((p) => p.slug), ['a-park']);
});

test('saved parks are private: not on public passports, the pals page or other members\' pages', async () => {
  const { app, people } = await world();
  await people.ana.c.post('/account/visibility', { default_visibility: 'public' });
  const link = (await people.ana.c.get('/pals')).body.match(/\/pals\/invite\/[A-Za-z0-9_-]+/)[0];
  await people.ben.c.post(`${link}/accept`);
  await people.ana.c.post('/st-pete/parks/c-park/save', { saved: '1' });
  await people.ana.c.post('/st-pete/parks/a-park/stamp', {});

  const viewers = { pal: people.ben.c, anon: client(app) };
  for (const [who, c] of Object.entries(viewers)) {
    const passport = await c.get('/u/ana');
    assert.equal(passport.statusCode, 200, who);
    assert.ok(!passport.body.includes('Want to go'), `public passport, ${who}`);
    assert.ok(!passport.body.includes('save-form'), `no hearts on public passport, ${who}`);
  }
  // Owner preview of the public passport doesn't show it either.
  assert.ok(!(await people.ana.c.get('/u/ana?preview=1')).body.includes('Want to go'));
  const pals = await people.ben.c.get('/pals');
  assert.ok(!pals.body.includes('Want to go'));
  // Ben's park pages and list show his own (empty) state, not ana's.
  assert.ok(!(await people.ben.c.get('/st-pete/parks')).body.includes('aria-pressed="true"'));
  assert.match((await people.ben.c.get('/st-pete/parks/c-park')).body, /aria-pressed="false"/);
});

test('next up prefers the closest saved park, and says so', async () => {
  const { db, people, parkId } = await world();
  const { c, id } = people.ana;
  await c.post('/st-pete/parks/a-park/stamp', {});
  assert.deepEqual(nextParks(db, id)[0], { slug: 'b-park', city_key: 'st-pete', name: 'B Park', saved: false, distance_m: nextParks(db, id)[0].distance_m });
  setSaved(db, id, parkId('c-park'), true); // farther than B, but saved
  const [next] = nextParks(db, id);
  assert.equal(next.slug, 'c-park');
  assert.equal(next.saved, true);
  const passport = (await c.get('/st-pete/passport')).body;
  assert.match(passport, /<span class="label">Want to go<\/span><strong>C Park<\/strong>/);
});

test('deleting an account removes its saved parks (ON DELETE CASCADE)', async () => {
  const { db, people } = await world();
  const { c, id } = people.ana;
  await c.post('/st-pete/parks/a-park/save', { saved: '1' });
  await people.ben.c.post('/st-pete/parks/a-park/save', { saved: '1' });
  assert.match((await c.post('/account/delete', { delete_password: PW })).body, /Your account is deleted/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM users WHERE id = ?').pluck().get(id), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM saved_parks WHERE user_id = ?').pluck().get(id), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM saved_parks').pluck().get(), 1, "ben's save stays");
});
