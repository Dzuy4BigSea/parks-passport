import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { evaluateCheckin } from '../../src/domain/checkin.js';
import { stampVisit, deleteVisit } from '../../src/domain/visits.js';
import { visitPoints, totalPoints, POINTS } from '../../src/domain/points.js';
import { localDate, isValidDate } from '../../src/domain/time.js';
import { createUser } from '../../src/domain/users.js';

const PARK = { id: 1, lat: 27.8065, lng: -82.75531, checkin_radius_m: 150 };
// ~0.0009 degrees of latitude is ~100 m.
const north = (m) => ({ lat: PARK.lat + m / 111195, lng: PARK.lng });

test('check-in counts within radius plus accuracy, with accuracy capped at 100 m', () => {
  assert.equal(evaluateCheckin(PARK, { ...north(140), accuracy: 0 }).ok, true);
  assert.equal(evaluateCheckin(PARK, { ...north(160), accuracy: 0 }).ok, false);
  assert.equal(evaluateCheckin(PARK, { ...north(200), accuracy: 60 }).ok, true);
  assert.equal(evaluateCheckin(PARK, { ...north(245), accuracy: 5000 }).ok, true);   // 150 + 100 cap
  assert.equal(evaluateCheckin(PARK, { ...north(260), accuracy: 5000 }).ok, false);
  const far = evaluateCheckin(PARK, { ...north(1609), accuracy: 10 });
  assert.equal(far.ok, false);
  assert.ok(Math.abs(far.distance_m - 1609) < 2);
  assert.equal(evaluateCheckin({ ...PARK, lat: null, lng: null }, { ...north(0), accuracy: 0 }).reason, 'no_location');
});

test('local dates use America/New_York, across the UTC midnight and DST', () => {
  assert.equal(localDate(new Date('2026-06-02T03:30:00Z')), '2026-06-01'); // 11:30 pm EDT
  assert.equal(localDate(new Date('2026-06-02T04:30:00Z')), '2026-06-02'); // 12:30 am EDT
  assert.equal(localDate(new Date('2026-12-02T04:30:00Z')), '2026-12-01'); // 11:30 pm EST
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('2026-6-1'), false);
});

test('points: first stamp 10, repeat 2, GPS +5, photo +3', () => {
  const pts = visitPoints([{ id: 1, method: 'gps' }, { id: 2, method: 'honor' }, { id: 3, method: 'photo', hasPhoto: true }]);
  assert.deepEqual(pts.map((p) => p.total), [POINTS.firstStamp + POINTS.gpsBonus, POINTS.repeatStamp, POINTS.repeatStamp + POINTS.photoBonus]);
  assert.deepEqual(pts.map((p) => p.total), [15, 2, 5]);
});

function setup(start = '2026-06-01T16:00:00Z') {
  const now = testClock(start);
  const { app, db } = makeApp({ now });
  importParksCsv(db, [
    PARK_CSV_COLUMNS.join(','),
    'abercrombie-park,Abercrombie Park,,,27.8065,-82.75531,,,,0',
    'auburn-street-park,Auburn Street Park,,,,,,,,0',
  ].join('\n'));
  const park = db.prepare("SELECT * FROM parks WHERE slug = 'abercrombie-park'").get();
  return { app, db, now, park };
}

const newUser = async (db, email = 'sam@example.com') =>
  (await createUser(db, { display_name: 'Sam', email, password: 'correct horse battery' })).user;

test('GPS stamp at the park is saved as gps with points; too far is refused with the distance', async () => {
  const { db, now, park } = setup();
  const user = await newUser(db);
  const far = stampVisit(db, { user, park, method: 'gps', position: { ...north(800), accuracy: 10 } }, { now: now() });
  assert.equal(far.error, 'too_far');
  assert.ok(far.distance_m > 790);
  const ok = stampVisit(db, { user, park, method: 'gps', position: { ...north(20), accuracy: 15 } }, { now: now() });
  assert.equal(ok.visit.method, 'gps');
  assert.equal(ok.visit.visited_on, '2026-06-01');
  assert.equal(ok.visit.points, 15);
  assert.equal(totalPoints(db, user.id), 15);
});

test('one stamp per park per local day; a new local day allows another', async () => {
  const { db, now, park } = setup('2026-06-02T03:00:00Z'); // 11 pm June 1 in St. Pete
  const user = await newUser(db);
  assert.ok(stampVisit(db, { user, park, method: 'honor' }, { now: now() }).visit);
  assert.equal(stampVisit(db, { user, park, method: 'honor' }, { now: now() }).error, 'duplicate_day');
  now.advanceMinutes(90); // 12:30 am June 2
  const next = stampVisit(db, { user, park, method: 'honor' }, { now: now() });
  assert.equal(next.visit.visited_on, '2026-06-02');
  assert.equal(next.visit.points, POINTS.repeatStamp);
});

test('honor stamps can be backdated but never future-dated', async () => {
  const { db, now, park } = setup();
  const user = await newUser(db);
  assert.equal(stampVisit(db, { user, park, method: 'honor', visitedOn: '2026-06-02' }, { now: now() }).error, 'future_date');
  assert.equal(stampVisit(db, { user, park, method: 'honor', visitedOn: '1999-12-31' }, { now: now() }).error, 'bad_date');
  assert.equal(stampVisit(db, { user, park, method: 'honor', visitedOn: 'yesterday' }, { now: now() }).error, 'bad_date');
  const back = stampVisit(db, { user, park, method: 'honor', visitedOn: '2026-05-20' }, { now: now() });
  assert.equal(back.visit.visited_on, '2026-05-20');
  assert.equal(back.visit.method, 'honor');
});

test('deleting the first visit promotes the next one and the totals follow', async () => {
  const { db, now, park } = setup();
  const user = await newUser(db);
  const a = stampVisit(db, { user, park, method: 'honor', visitedOn: '2026-05-01' }, { now: now() }).visit;
  const b = stampVisit(db, { user, park, method: 'gps', position: { ...north(10), accuracy: 5 } }, { now: now() }).visit;
  assert.equal(totalPoints(db, user.id), 10 + 2 + 5);
  deleteVisit(db, { user, visitId: a.id }, { now: now() });
  assert.equal(db.prepare('SELECT points FROM visits WHERE id = ?').pluck().get(b.id), 15);
  assert.equal(totalPoints(db, user.id), 15);
  deleteVisit(db, { user, visitId: b.id }, { now: now() });
  assert.equal(totalPoints(db, user.id), 0);
});

test("a user can't delete someone else's visit", async () => {
  const { db, now, park } = setup();
  const owner = await newUser(db);
  const other = await newUser(db, 'pat@example.com');
  const v = stampVisit(db, { user: owner, park, method: 'honor' }, { now: now() }).visit;
  assert.equal(deleteVisit(db, { user: other, visitId: v.id }, { now: now() }), null);
  assert.equal(db.prepare('SELECT COUNT(*) FROM visits').pluck().get(), 1);
});

test('visit coordinates never appear in pages other people (or the owner) see', async () => {
  const { app, db } = setup();
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: 'correct horse battery' });
  const lat = '27.80661234';
  const lng = '-82.75539876';
  const res = await c.post('/st-pete/parks/abercrombie-park/checkin', { lat, lng, accuracy: '12' });
  assert.equal(res.statusCode, 303);
  assert.equal(db.prepare('SELECT lat FROM visits').pluck().get(), Number(lat));
  const pages = [
    await c.get(res.headers.location), await c.get('/st-pete/parks'),
    await client(app).get('/st-pete/parks/abercrombie-park'), await client(app).get('/st-pete/parks'),
  ];
  for (const p of pages) {
    assert.ok(!p.body.includes('80661234') && !p.body.includes('75539876'), 'coordinates leaked');
  }
});

test('deleting an account removes its visits and points', async () => {
  const { app, db } = setup();
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: 'correct horse battery' });
  await c.post('/st-pete/parks/abercrombie-park/stamp', { visited_on: '2026-05-01' });
  assert.equal(db.prepare('SELECT COUNT(*) FROM visits').pluck().get(), 1);
  await c.post('/account/delete', { delete_password: 'correct horse battery' });
  assert.equal(db.prepare('SELECT COUNT(*) FROM visits').pluck().get(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM point_events').pluck().get(), 0);
});

test('a park without a location offers only the honor system', async () => {
  const { app } = setup();
  const c = client(app);
  await c.post('/signup', { display_name: 'Sam', email: 'sam@example.com', password: 'correct horse battery' });
  const page = await c.get('/st-pete/parks/auburn-street-park');
  assert.ok(!page.body.includes('Check in here'));
  assert.match(page.body, /Stamp on the honor system/);
  const res = await c.post('/st-pete/parks/auburn-street-park/checkin', { lat: '27.8', lng: '-82.7', accuracy: '5' });
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /GPS check-in isn&#39;t available/);
});
