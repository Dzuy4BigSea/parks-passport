// Dev-only: builds the Pinellas County parks (https://pinellas.gov/parks/):
//   node scripts/seed-pinellas.js
// The county's park finder embeds every park's pin and address (FacetWP map data); each amenity
// filter (?_parks_amenities=<value>) lists the parks that have it. A county park that falls inside
// a city pack's map area (its bounds) belongs to that city: it goes in
// seed/cities/<city>/pinellas-county-parks.csv, which is imported once into that city (SPEC Flow 14).
// The rest make up the Pinellas County pack, seed/cities/pinellas/parks.csv. A county park within
// 250 m of one the city pack already has (by pin) is a duplicate and is left out. Never run in production.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { get, sleep, decode, slugify, fixed, inBounds } from './lib/seed-fetch.js';
import { stringifyCsv, parseCsv } from '../src/lib/csv.js';
import { PARK_CSV_COLUMNS } from '../src/domain/csv-import.js';
import { distanceMeters } from '../src/domain/geo.js';

const LIST_URL = 'https://pinellas.gov/parks/';
const PHONE = '(727) 582-2100'; // Parks & Conservation Resources
const COUNTY_KEY = 'pinellas';
const CITIES_DIR = path.join(import.meta.dirname, '..', 'seed', 'cities');
const DUPLICATE_M = 250;

// The umbrella for the Florida Botanical Gardens and Heritage Village, which are listed on their own
// (same pin as the gardens): one stamp per place.
const SKIP = new Set(['pinewood-cultural-park']);
// Big parks: a wider check-in circle (acres from the county).
const RADIUS_M = {
  'fort-de-soto-park': 2000, 'brooker-creek-preserve': 2000, 'weedon-island-preserve': 1500, 'shell-key-preserve': 1500,
  'sawgrass-lake-park': 600, 'john-chesnut-sr-park': 500, 'lake-seminole-park': 500, 'walsingham-park': 500, 'fred-howard-park': 400,
  'philippe-park': 300, 'boca-ciega-millennium-park': 300, 'wall-springs-park': 300,
};
// County amenity filters -> our categories (src/domain/categories.js).
const AMENITIES = {
  'Canoe Access / Trail': ['water-access', 'trails'], 'Boardwalk, Nature Trail': ['trails', 'history-nature'], 'Ball Field': ['ball-fields'],
  'Barrier Free Trail': ['trails'], 'Beach': ['beach'], 'Boat Ramps': ['water-access'], 'Dog Parks': ['dog-park'],
  'Historic Interest': ['history-nature'], 'Multipurpose Trail': ['trails'], 'Observation Tower': ['scenic-view'],
  'Playground Equipment': ['playground'], 'Restrooms': ['restrooms'], 'Shelters and Grills': ['picnic-shelter'], 'Small Boat Ramps': ['water-access'],
};

/** The FacetWP settings the park finder embeds. */
const fwp = (page) => {
  const start = page.indexOf('window.FWP_JSON = ');
  if (start < 0) throw new Error('No FacetWP data on the park finder.');
  const json = page.slice(start + 'window.FWP_JSON = '.length, page.indexOf('};\n', start) + 1);
  return JSON.parse(json);
};

/** Every park on the map: { slug, name, url, lat, lng, address }. */
export function parseParks(page) {
  const seen = new Map();
  for (const l of fwp(page).preload_data.settings.map.locations) {
    const c = l.content;
    const url = (c.match(/href="([^"]+)"/) || [])[1];
    const part = (prop) => decode((c.match(new RegExp(`property="${prop}">([^<]*)<`)) || [])[1] || '');
    if (!url || seen.has(url)) continue;
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop();
    seen.set(url, {
      slug, name: part('name'), url, lat: l.position.lat, lng: l.position.lng,
      address: `${part('streetAddress')}, ${part('addressLocality')}, FL ${part('postalCode')}`,
    });
  }
  return [...seen.values()];
}

/** The amenity filters: [{ value, label }]. */
export const parseAmenities = (page) => [...fwp(page).preload_data.facets.parks_amenities
  .matchAll(/data-value="([^"]+)"><span class="facetwp-display-value">([^<]+)</g)].map((m) => ({ value: m[1], label: decode(m[2]) }));

/** The city packs (not the county): { key, bounds, center, parks: [{ slug, lat, lng }] }. */
function cityPacks() {
  return fs.readdirSync(CITIES_DIR).filter((k) => k !== COUNTY_KEY && fs.existsSync(path.join(CITIES_DIR, k, 'city.json'))).map((key) => {
    const pack = JSON.parse(fs.readFileSync(path.join(CITIES_DIR, key, 'city.json'), 'utf8'));
    const b = pack.bounds;
    const parks = parseCsv(fs.readFileSync(path.join(CITIES_DIR, key, 'parks.csv'), 'utf8')).filter((r) => r.lat)
      .map((r) => ({ slug: r.slug, name: r.name, lat: +r.lat, lng: +r.lng }));
    return { key, bounds: b, center: b.center || { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 }, parks };
  });
}

/** The city pack whose map area holds this pin (the nearest center if several), or null. */
export function cityFor(pin, cities) {
  const inside = cities.filter((c) => inBounds(c.bounds, pin));
  return inside.sort((a, b) => distanceMeters(pin, a.center) - distanceMeters(pin, b.center))[0] || null;
}

async function main() {
  const page = await get(LIST_URL);
  const parks = parseParks(page).filter((p) => !SKIP.has(p.slug));
  const cats = new Map(parks.map((p) => [p.slug, new Set()]));
  for (const a of parseAmenities(page)) {
    await sleep(800);
    const filtered = await get(`${LIST_URL}?_parks_amenities=${encodeURIComponent(a.value)}`);
    for (const m of filtered.matchAll(/<h3><a class="stretched-link" href="https:\/\/pinellas\.gov\/parks\/([^"/]+)\/"/g)) {
      for (const c of AMENITIES[a.label] || []) cats.get(m[1])?.add(c);
    }
  }
  const cities = cityPacks();
  const out = new Map(); // pack key -> rows
  for (const p of parks) {
    const slug = slugify(p.name);
    const city = cityFor(p, cities);
    const dupe = city?.parks.find((x) => x.slug === slug || distanceMeters(p, x) <= DUPLICATE_M);
    if (dupe) { console.log(`${slug.padEnd(30)} skip: ${city.key} already has ${dupe.name}`); continue; }
    const key = city?.key || COUNTY_KEY;
    console.log(`${slug.padEnd(30)} -> ${key}`);
    const row = {
      slug, name: p.name, address: p.address, phone: PHONE, lat: fixed(p.lat), lng: fixed(p.lng),
      checkin_radius_m: RADIUS_M[p.slug] ? String(RADIUS_M[p.slug]) : '',
      // The county has no "lake" amenity: a park named for its lake has one.
      categories: [...cats.get(p.slug), ...(/\bLake\b/.test(p.name) ? ['lake'] : [])].sort().join('|'),
      city_url: p.url, needs_pin: '0',
      // Inside a city pack, say who runs it (the county pack's own parks are the county's anyway).
      ...(key === COUNTY_KEY ? {} : { managed_by: 'Pinellas County' }),
    };
    out.set(key, [...(out.get(key) || []), row]);
  }
  for (const [key, rows] of out) {
    const file = path.join(CITIES_DIR, key, key === COUNTY_KEY ? 'parks.csv' : 'pinellas-county-parks.csv');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rows.sort((a, b) => a.slug.localeCompare(b.slug));
    fs.writeFileSync(file, stringifyCsv(key === COUNTY_KEY ? PARK_CSV_COLUMNS : [...PARK_CSV_COLUMNS, 'managed_by'], rows));
    console.log(`Wrote ${rows.length} rows to ${path.relative(process.cwd(), file)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
