// Dev-only: builds seed/cities/asheville/parks.csv from the City of Asheville's locations
// directory (Parks & Recreation):
//   node scripts/seed-asheville.js
// The directory page embeds every location as JSON (name, link, features, type, pin), so no
// geocoding is needed; each park's own page gives its street address ("Get Directions").
// Never run in production.
import fs from 'node:fs';
import path from 'node:path';
import { stringifyCsv } from '../src/lib/csv.js';
import { PARK_CSV_COLUMNS } from '../src/domain/csv-import.js';

const DIRECTORY_URL = 'https://www.ashevillenc.gov/locations/?avl_department=parks-recreation';
const UA = 'parks-passport-seed/1.0 (personal project)';
const OUT = path.join(import.meta.dirname, '..', 'seed', 'cities', 'asheville', 'parks.csv');

// Locations that are parks to stamp: any of these types. Community centers, the golf course, the
// pool building and venues are left out unless they're also a park; a community center that sits
// in a park listed on its own is left out too (one stamp per place).
const PARK_TYPES = new Set(['Park', 'River Park', 'Dog Park', 'Greenway', 'Sports Complex']);
const FEATURES = {
  'Playground': ['playground'], 'Picnic Shelter': ['picnic-shelter'], 'Restrooms': ['restrooms'],
  'Tennis': ['tennis'], 'Pickleball': ['pickleball'], 'Basketball': ['basketball'], 'Sports Field(s)': ['ball-fields'],
  'Paved Walking Path(s)': ['trails'], 'Unpaved Trail(s)': ['trails'], 'River Access': ['water-access'],
  'Outdoor Pool': ['pool'], 'Splashpad': ['pool'],
};
const TYPE_CATEGORIES = { 'Dog Park': ['dog-park'], 'Greenway': ['trails'] };
// A greenway's pin is one point on a long trail: allow a wider check-in circle.
const GREENWAY_RADIUS_M = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&#8217;|&#039;|&rsquo;/g, "'").replace(/&#8211;/g, '–').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.text();
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`, { cause: err });
      await sleep(1500 * attempt);
    }
  }
}

/** The JSON array of locations the directory page embeds (archiveObjects). */
export function parseDirectory(page) {
  const start = page.indexOf('[{"title":');
  if (start < 0) throw new Error('No locations JSON on the directory page.');
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < page.length; i++) {
    const ch = page[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if ((ch === ']' || ch === '}') && --depth === 0) return JSON.parse(page.slice(start, i + 1));
  }
  throw new Error('The locations JSON never closes.');
}

const termsOf = (loc, taxonomy) => (loc.terms || []).filter((t) => t.taxonomy === taxonomy).map((t) => t.name);

/** Locations to stamp, as CSV rows (address filled in later). */
export function parkRows(locations) {
  const titles = new Set(locations.map((l) => decode(l.title)));
  return locations.filter((l) => {
    const types = termsOf(l, 'location_type');
    const name = decode(l.title);
    if (!types.some((t) => PARK_TYPES.has(t))) return false;
    // "Burton Street Community Center" when "Burton Street Park" is listed too.
    return !(/Community Center$/.test(name) && [...titles].some((t) => t !== name && t.startsWith(name.replace(/ Community Center$/, '')) && / Park$/.test(t)));
  }).map((l) => {
    const name = decode(l.title);
    const types = termsOf(l, 'location_type');
    const cats = new Set([...termsOf(l, 'location_feature').flatMap((f) => FEATURES[f] || []), ...types.flatMap((t) => TYPE_CATEGORIES[t] || [])]);
    if (/skatepark/i.test(name)) cats.add('skatepark');
    const slug = new URL(l.permalink).pathname.split('/').filter(Boolean).pop();
    const greenwayOnly = types.length === 1 && types[0] === 'Greenway';
    return {
      slug, name, address: '', phone: '', lat: Number(l.coordinates.lat).toFixed(6), lng: Number(l.coordinates.lon).toFixed(6),
      checkin_radius_m: greenwayOnly ? String(GREENWAY_RADIUS_M) : '', categories: [...cats].sort().join('|'),
      city_url: l.permalink, needs_pin: '0',
    };
  });
}

/** The street address from a park page's "Get Directions" link, or ''. */
export const addressFrom = (page) => decode((page.match(/maps\/dir\/\?api=1&(?:amp;)?destination=([^"&]+)/) || [])[1] || '');

async function main() {
  const rows = parkRows(parseDirectory(await get(DIRECTORY_URL)));
  console.log(`${rows.length} parks`);
  for (const r of rows) {
    await sleep(1000);
    r.address = addressFrom(await get(r.city_url));
    if (!r.address) console.warn(`  ! ${r.slug}: no address on its page`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, stringifyCsv(PARK_CSV_COLUMNS, rows));
  console.log(`Wrote ${rows.length} rows to ${path.relative(process.cwd(), OUT)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
