// M26: Drops of Sunshine (SPEC Flow 17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { seedCities } from '../../src/db/seed.js';
import { deleteUser } from '../../src/domain/users.js';

const PW = 'correct horse battery';

async function world() {
  const made = makeApp({ now: testClock('2026-06-06T16:00:00Z') });
  const { db, app } = made;
  seedCities(db); // every city pack, so a park in another city can be tried
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','),
    'a-park,A Park,,,27.800,-82.700,,,,0', 'b-park,B Park,,,27.801,-82.701,,,,0'].join('\n'));
  const people = {};
  for (const name of ['ana', 'boss']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.boss.id);
  const notes = () => db.prepare('SELECT n.*, p.slug FROM sunshine_notes n LEFT JOIN parks p ON p.id = n.park_id ORDER BY n.id').all();
  return { ...made, people, notes };
}

const selected = (body) => body.match(/<option value="([^"]+)" selected>/)?.[1];

test('the park is chosen for you: the park page, else your latest stamp, else the whole department', async () => {
  const { people } = await world();
  const { c } = people.ana;
  assert.equal(selected((await c.get('/sunshine?city=st-pete')).body), 'department');
  assert.match((await c.get('/sunshine?city=st-pete')).body, /To: <strong class="park-name" data-sunshine-to>the St. Pete parks department<\/strong>/);
  await c.post('/st-pete/parks/b-park/stamp', {});
  assert.equal(selected((await c.get('/sunshine?city=st-pete')).body), 'b-park');
  // From a park page: that park, and no GPS pins (it's already the right park).
  const fromPark = (await c.get('/sunshine?city=st-pete&park=a-park')).body;
  assert.equal(selected(fromPark), 'a-park');
  assert.match(fromPark, /data-pins="\[\]"/);
  // Otherwise the page carries pins for the nearest-park choice in the browser.
  assert.match((await c.get('/sunshine?city=st-pete')).body, /data-pins="\[\{&quot;slug&quot;:&quot;/);
  // The park page links here with its city and slug.
  assert.match((await c.get('/st-pete/parks/a-park')).body, /href="\/sunshine\?city=st-pete&amp;park=a-park"/);
});

test('send: one box; park or department; other cities and unknown parks refused; length; daily limit', async () => {
  const { app, people, notes } = await world();
  const { c, id } = people.ana;
  await c.get('/sunshine?city=st-pete');
  const sent = await c.post('/sunshine', { text: 'Thank you for the new benches!', park: 'a-park' });
  assert.equal(sent.headers.location, '/sunshine?sent=1&city=st-pete&to=a-park');
  const thanks = (await c.get(sent.headers.location)).body;
  assert.match(thanks, /Your drop of sunshine is on its way\./);
  assert.match(thanks, /Thank you for thanking <span class="park-name">A Park<\/span>\./);
  assert.match(thanks, /class="sunshine-burst" aria-hidden="true"/);
  // The name comes from the database, never from the URL.
  assert.doesNotMatch((await c.get('/sunshine?sent=1&to=Evil%20Corp')).body, /Evil Corp/);

  assert.equal((await c.post('/sunshine', { text: 'To everyone in Parks & Rec: thank you.', park: 'department' })).headers.location, '/sunshine?sent=1&city=st-pete');
  assert.deepEqual(notes().map((n) => [n.slug, n.user_id, n.status]), [['a-park', id, 'new'], [null, id, 'new']]);

  assert.match((await c.post('/sunshine', { text: '  ', park: 'a-park' })).body, /Write a few words of thanks first/);
  assert.match((await c.post('/sunshine', { text: 'x'.repeat(501), park: 'a-park' })).body, /500 characters/);
  assert.match((await c.post('/sunshine', { text: 'hi', park: 'nope' })).body, /Choose a park/);
  // A Westminster park while the city is St. Pete is refused.
  const wm = app.db.prepare("SELECT p.slug FROM parks p JOIN city_themes c ON c.id = p.city_id WHERE c.key = 'westminster' LIMIT 1").pluck().get();
  assert.match((await c.post('/sunshine', { text: 'hi', park: wm })).body, /Choose a park/);

  for (let i = 0; i < 8; i++) await c.post('/sunshine', { text: `thanks ${i}`, park: 'a-park' });
  assert.match((await c.post('/sunshine', { text: 'one more', park: 'a-park' })).body, /a lot of sunshine for one day/);
  assert.equal(notes().length, 10);
  // Signed out: log in.
  assert.match((await client(app).get('/sunshine')).headers.location, /^\/login/);
});

test('admin review: members 404; approve and hide; filter by status and city; no location stored', async () => {
  const { db, people, notes } = await world();
  const { c } = people.ana;
  await c.get('/sunshine?city=st-pete');
  await c.post('/sunshine', { text: 'The <b>roses</b> are lovely', park: 'a-park' });
  const [n] = notes();
  assert.deepEqual(Object.keys(n).sort(), ['city_id', 'created_at', 'id', 'park_id', 'reviewed_at', 'slug', 'status', 'text', 'user_id']);

  assert.equal((await c.get('/admin/sunshine')).statusCode, 404);
  assert.equal((await c.post(`/admin/sunshine/${n.id}`, { status: 'approved' })).statusCode, 404);
  const boss = people.boss.c;
  const list = (await boss.get('/admin/sunshine')).body;
  assert.match(list, /☀️<\/span> The &lt;b&gt;roses&lt;\/b&gt; are lovely/);
  assert.match(list, /To A Park · St\. Petersburg · ana \(@ana\)/);
  assert.match((await boss.get('/admin')).body, /1 new thank-you notes/);
  assert.equal((await boss.post(`/admin/sunshine/${n.id}`, { status: 'approved', back: 'new' })).statusCode, 303);
  assert.equal(notes()[0].status, 'approved');
  assert.match((await boss.get('/admin/sunshine?status=approved&city=st-pete')).body, /roses/);
  assert.doesNotMatch((await boss.get('/admin/sunshine?status=approved&city=westminster')).body, /roses/);
  assert.equal((await boss.post(`/admin/sunshine/${n.id}`, { status: 'bogus' })).statusCode, 404);
  await boss.post(`/admin/sunshine/${n.id}`, { status: 'hidden' });
  assert.equal(notes()[0].status, 'hidden');

  deleteUser(db, people.ana.id);
  assert.equal(notes().length, 0);
});
