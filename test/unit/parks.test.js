import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { listParks, getParkBySlug, categoriesInUse, cleanCategories, countActiveParks } from '../../src/domain/parks.js';
import { distanceMeters, formatMiles, parseLatLng } from '../../src/domain/geo.js';

function fixtureDb() {
  const db = openDb(':memory:');
  importParksCsv(db, [
    PARK_CSV_COLUMNS.join(','),
    'crescent-lake-park,Crescent Lake Park,,,27.7864,-82.6440,,dog-park|playground|lake,,0',
    'lake-maggiore-park,Lake Maggiore Park,,,27.7410,-82.6550,,lake|trails,,0',
    'abercrombie-park,Abercrombie Park,,,27.8065,-82.7553,,scenic-view,,0',
    'auburn-street-park,Auburn Street Park,,,,,,playground,,0',
    'pct_park,Odd 100% Park,,,27.77,-82.64,,,,0',
  ].join('\n').replace('pct_park', 'pct-park'));
  return db;
}

test('distance: downtown St. Pete to Crescent Lake is about 1.7 km', () => {
  const d = distanceMeters({ lat: 27.7731, lng: -82.6400 }, { lat: 27.7864, lng: -82.6440 });
  assert.ok(d > 1400 && d < 1600, String(d));
  assert.equal(formatMiles(1609.344 * 1.26), '1.3 mi');
  assert.equal(distanceMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
});

test('parseLatLng accepts valid pairs only', () => {
  assert.deepEqual(parseLatLng('27.7', '-82.6'), { lat: 27.7, lng: -82.6 });
  for (const [a, b] of [['', '1'], ['x', '1'], ['91', '0'], ['0', '181'], [undefined, '1']]) {
    assert.equal(parseLatLng(a, b), null);
  }
});

test('list is alphabetical and includes categories', () => {
  const parks = listParks(fixtureDb());
  assert.deepEqual(parks.map((p) => p.slug),
    ['abercrombie-park', 'auburn-street-park', 'crescent-lake-park', 'lake-maggiore-park', 'pct-park']);
  assert.deepEqual(parks[2].categories, ['dog-park', 'lake', 'playground']);
});

test('search is case-insensitive substring on name, and LIKE wildcards are literal', () => {
  const db = fixtureDb();
  assert.deepEqual(listParks(db, { q: 'LAKE' }).map((p) => p.slug), ['crescent-lake-park', 'lake-maggiore-park']);
  assert.deepEqual(listParks(db, { q: '100%' }).map((p) => p.slug), ['pct-park']);
  assert.deepEqual(listParks(db, { q: '%' }).map((p) => p.slug), ['pct-park']);
  assert.deepEqual(listParks(db, { q: '_' }), []);
});

test('category filters require every selected category and combine with search', () => {
  const db = fixtureDb();
  assert.deepEqual(listParks(db, { categories: ['lake'] }).map((p) => p.slug), ['crescent-lake-park', 'lake-maggiore-park']);
  assert.deepEqual(listParks(db, { categories: ['lake', 'dog-park'] }).map((p) => p.slug), ['crescent-lake-park']);
  assert.deepEqual(listParks(db, { q: 'maggiore', categories: ['dog-park'] }), []);
});

test('near sorts by distance and puts parks without coordinates last', () => {
  const near = { lat: 27.8060, lng: -82.7550 }; // at Abercrombie
  const parks = listParks(fixtureDb(), { near });
  assert.equal(parks[0].slug, 'abercrombie-park');
  assert.ok(parks[0].distance_m < 100);
  assert.equal(parks.at(-1).slug, 'auburn-street-park');
  assert.equal(parks.at(-1).distance_m, null);
  for (let i = 1; i < parks.length - 1; i++) assert.ok(parks[i - 1].distance_m <= parks[i].distance_m);
});

test('inactive parks are hidden from lists, counts and park pages', () => {
  const db = fixtureDb();
  db.prepare("UPDATE parks SET active = 0 WHERE slug = 'abercrombie-park'").run();
  assert.equal(countActiveParks(db), 4);
  assert.ok(!listParks(db).some((p) => p.slug === 'abercrombie-park'));
  assert.equal(getParkBySlug(db, 'abercrombie-park'), null);
  assert.ok(!categoriesInUse(db).includes('scenic-view'));
});

test('cleanCategories keeps known slugs only', () => {
  assert.deepEqual(cleanCategories(['lake', 'nope', 'lake']), ['lake']);
  assert.deepEqual(cleanCategories('dog-park'), ['dog-park']);
  assert.deepEqual(cleanCategories(undefined), []);
});
