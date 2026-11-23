import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../../src/db/index.js';
import { importParksCsv, PARK_CSV_COLUMNS, ST_PETE_BOUNDS } from '../../src/domain/csv-import.js';
import { seedParksIfEmpty, SEED_PARKS_CSV } from '../../src/db/seed.js';
import { parseCsv, stringifyCsv } from '../../src/lib/csv.js';

const HEADER = PARK_CSV_COLUMNS.join(',');
const csv = (...lines) => [HEADER, ...lines].join('\n') + '\n';
const GOOD = 'abercrombie-park,Abercrombie Park,"Park St. and 38th Ave. N., St. Petersburg, FL 33709",(727) 893-7441,27.8065,-82.75531,,scenic-view|picnic-shelter,https://www.stpeteparksrec.org/parks___facilities/abercrombie_park.php,0';

test('csv round-trips quotes, commas and newlines', () => {
  const rows = [{ a: 'x, "y"', b: 'line1\nline2' }, { a: '', b: 'plain' }];
  assert.deepEqual(parseCsv(stringifyCsv(['a', 'b'], rows)), rows);
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [{ a: '1', b: '2' }]);
});

test('valid rows are added with categories', () => {
  const db = openDb(':memory:');
  const r = importParksCsv(db, csv(GOOD));
  assert.deepEqual({ ...r, invalid: r.invalid.length }, { added: 1, updated: 0, unchanged: 0, invalid: 0 });
  const park = db.prepare('SELECT * FROM parks WHERE slug = ?').get('abercrombie-park');
  assert.equal(park.name, 'Abercrombie Park');
  assert.equal(park.checkin_radius_m, 150);
  assert.equal(park.needs_pin, 0);
  const cats = db.prepare('SELECT category FROM park_categories WHERE park_id = ? ORDER BY category').pluck().all(park.id);
  assert.deepEqual(cats, ['picnic-shelter', 'scenic-view']);
});

test('importing the same file twice changes nothing', () => {
  const db = openDb(':memory:');
  importParksCsv(db, csv(GOOD));
  const before = db.prepare('SELECT * FROM parks').all();
  const r = importParksCsv(db, csv(GOOD), { now: () => new Date('2030-01-01') });
  assert.deepEqual({ ...r, invalid: r.invalid.length }, { added: 0, updated: 0, unchanged: 1, invalid: 0 });
  assert.deepEqual(db.prepare('SELECT * FROM parks').all(), before);
});

test('changed rows are updated, matched on slug', () => {
  const db = openDb(':memory:');
  importParksCsv(db, csv(GOOD));
  const r = importParksCsv(db, csv(GOOD.replace('Abercrombie Park,', 'Abercrombie Waterfront Park,').replace('scenic-view|', '')));
  assert.equal(r.updated, 1);
  assert.equal(db.prepare('SELECT name FROM parks').pluck().get(), 'Abercrombie Waterfront Park');
  assert.deepEqual(db.prepare('SELECT category FROM park_categories').pluck().all(), ['picnic-shelter']);
});

test('invalid rows are reported with line and reason, and not saved', () => {
  const db = openDb(':memory:');
  const r = importParksCsv(db, csv(
    GOOD,
    'Bad Slug,Name,,,27.8,-82.7,,,,0',
    'no-name,,,,27.8,-82.7,,,,0',
    'far-away,Far Away Park,,,28.5,-81.4,,,,0',
    'bad-radius,Radius Park,,,27.8,-82.7,5,,,0',
    'bad-url,Url Park,,,27.8,-82.7,,,http://example.com,0',
    'abercrombie-park,Dupe,,,27.8,-82.7,,,,0',
  ));
  assert.equal(r.added, 1);
  assert.deepEqual(r.invalid.map((i) => i.line), [3, 4, 5, 6, 7, 8]);
  assert.match(r.invalid[2].reason, /outside St\. Petersburg/);
  assert.match(r.invalid[5].reason, /duplicate slug/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM parks').pluck().get(), 1);
});

test('rows without coordinates are kept and flagged needs_pin', () => {
  const db = openDb(':memory:');
  const r = importParksCsv(db, csv('auburn-street-park,Auburn Street Park,,,,,,playground,,0'));
  assert.equal(r.added, 1);
  const p = db.prepare('SELECT lat, lng, needs_pin FROM parks').get();
  assert.deepEqual({ ...p }, { lat: null, lng: null, needs_pin: 1 });
});

test('seed/parks.csv has 102 valid St. Pete parks and loads once', () => {
  const rows = parseCsv(fs.readFileSync(SEED_PARKS_CSV, 'utf8'));
  assert.equal(rows.length, 102);
  for (const r of rows) {
    if (r.lat === '') { assert.equal(r.needs_pin, '1', `${r.slug} has no coords but is not flagged`); continue; }
    const lat = Number(r.lat); const lng = Number(r.lng);
    assert.ok(lat >= ST_PETE_BOUNDS.minLat && lat <= ST_PETE_BOUNDS.maxLat, r.slug);
    assert.ok(lng >= ST_PETE_BOUNDS.minLng && lng <= ST_PETE_BOUNDS.maxLng, r.slug);
  }
  const db = openDb(':memory:');
  const first = seedParksIfEmpty(db);
  assert.equal(first.added, 102);
  assert.deepEqual(first.invalid, []);
  assert.equal(seedParksIfEmpty(db), null);
});
