// Dev-only: builds seed/cities/westminster/parks.csv from a saved copy of the City of
// Westminster, CA "Parks and Facilities" page (the site blocks automated fetches, so save it
// from a browser first):
//   node scripts/seed-westminster.js <saved-page.html>
// Pins come from OpenStreetMap (the park by name, via Nominatim); if OSM has no park by that
// name, the street address is geocoded (US Census). Never run in production.
import fs from 'node:fs';
import path from 'node:path';
import { stringifyCsv } from '../src/lib/csv.js';
import { PARK_CSV_COLUMNS } from '../src/domain/csv-import.js';
import { distanceMeters } from '../src/domain/geo.js';

const SOURCE_URL = 'https://www.westminster-ca.gov/business/find/parks-facilities';
const PHONE = '(714) 895-2860'; // Community Services & Recreation
const UA = 'parks-passport-seed/1.0 (personal project)';
const BOUNDS = { minLat: 33.70, maxLat: 33.81, minLng: -118.05, maxLng: -117.92 };
const OUT = path.join(import.meta.dirname, '..', 'seed', 'cities', 'westminster', 'parks.csv');

// Amenities named in the page's text (the full amenity table is not in the saved page).
const KNOWN_CATEGORIES = {
  'sigler-park': ['pool', 'ball-fields', 'pickleball'],
  'buckingham-park': ['ball-fields'],
  'westminster-park': ['ball-fields'],
  'liberty-park': ['skatepark'],
  'bolsa-chica-park': ['tennis'],
  'tony-lam-park': ['tennis', 'pickleball'],
  'elden-f-gillespie-park': ['tennis'],
  'mendez-tribute-monument-park': ['history-nature'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/[ \t]+/g, ' ');
const slugify = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const inBounds = ({ lat, lng }) => lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;

/** The "Parks" table: name followed by a two-line address, up to the "Facilities" table. */
export function parseParks(page) {
  const text = decode(page);
  const start = text.search(/FACILITY NAME\s+ADDRESS/i);
  const end = text.indexOf('Facilities', start + 20);
  if (start < 0 || end < 0) throw new Error('Could not find the Parks table in the saved page.');
  const lines = text.slice(start, end).split('\n').map((l) => l.trim()).filter(Boolean).slice(1)
    .filter((l) => !/^(FACILITY NAME|ADDRESS)$/i.test(l));
  const parks = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const [rawName, street, cityLine] = lines.slice(i, i + 3);
    if (!rawName || !street || !/Westminster, CA/.test(cityLine || '')) break;
    const name = rawName.replace(/\s*\(formerly [^)]*\)/i, '').trim();
    parks.push({ name, slug: slugify(name), address: `${street.replace(/\.$/, '')}, ${cityLine}` });
  }
  return parks;
}

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.json();
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`, { cause: err });
      await sleep(1500 * attempt);
    }
  }
}

// Names OSM may use instead: the surname form ("Frank G. Fry Park" -> "Fry Park") and old names.
const OLD_NAMES = { 'tony-lam-park': ['Park West Park'] };
const altNames = (p) => {
  const short = p.name.replace(/^(?:[A-Z][a-z]+\.?\s+)(?:[A-Z]\.\s+)?(?=[A-Z][a-z]+ (?:Freedom )?Park$)/, '');
  return [...new Set([p.name, short, ...(OLD_NAMES[p.slug] || [])])];
};

async function osmPark(p) {
  for (const name of altNames(p)) {
    const q = new URLSearchParams({ q: `${name}, Westminster, California`, format: 'jsonv2', limit: '5', countrycodes: 'us' });
    const hits = await getJson(`https://nominatim.openstreetmap.org/search?${q}`);
    await sleep(1100); // Nominatim: at most one request a second
    const hit = hits.find((h) => h.category === 'leisure' && ['park', 'pitch', 'recreation_ground', 'playground'].includes(h.type)
      && inBounds({ lat: +h.lat, lng: +h.lon }));
    if (hit) return { lat: +hit.lat, lng: +hit.lon, via: name };
  }
  return null;
}

async function censusPoint(address) {
  const q = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' });
  const data = await getJson(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${q}`);
  const m = data?.result?.addressMatches?.[0];
  if (m) return { lat: m.coordinates.y, lng: m.coordinates.x };
  // The Census misses some addresses (e.g. 8301 McFadden Ave); OSM often has the house number.
  const q2 = new URLSearchParams({ q: address, format: 'jsonv2', limit: '1', countrycodes: 'us' });
  const [hit] = await getJson(`https://nominatim.openstreetmap.org/search?${q2}`);
  await sleep(1100);
  return hit ? { lat: +hit.lat, lng: +hit.lon } : null;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/seed-westminster.js <saved-page.html>');
  const parks = parseParks(fs.readFileSync(file, 'utf8'));
  console.log(`${parks.length} parks in the saved page`);
  const rows = [];
  for (const p of parks) {
    const osm = await osmPark(p);
    const census = await censusPoint(p.address);
    const apart = osm && census ? Math.round(distanceMeters(osm, census)) : null;
    // A name match far from the listed address is probably a different park: trust the address.
    const okCensus = census && inBounds(census) ? census : null;
    const pin = apart != null && apart > 500 && okCensus ? okCensus : osm || okCensus;
    if (pin === okCensus && osm) console.warn(`  ! ${p.slug}: OSM match is ${apart} m from the address; using the address. Check this pin.`);
    console.log(`${p.slug.padEnd(34)} ${osm ? 'osm   ' : census ? 'census' : 'NONE  '}${osm && osm.via !== p.name ? ` as "${osm.via}"` : ''}${apart != null ? ` (osm vs address ${apart} m)` : ''}`);
    rows.push({
      slug: p.slug, name: p.name, address: p.address, phone: PHONE,
      lat: pin ? pin.lat.toFixed(6) : '', lng: pin ? pin.lng.toFixed(6) : '', checkin_radius_m: '',
      categories: (KNOWN_CATEGORIES[p.slug] || []).join('|'), city_url: SOURCE_URL, needs_pin: pin ? '0' : '1',
    });
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, stringifyCsv(PARK_CSV_COLUMNS, rows));
  console.log(`Wrote ${rows.length} rows to ${path.relative(process.cwd(), OUT)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
