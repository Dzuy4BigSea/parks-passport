// Dev-only: builds the Florida State Parks (SPEC Flow 14) from Florida DEP's open data:
//   node scripts/seed-florida-state-parks.js
// floridastateparks.org blocks automated clients, so this reads DEP's ArcGIS services instead:
// the state park boundaries (name, address, acreage, county, public access, park page) and
// Florida's Outdoor Recreation Inventory (a pin and amenity counts per site, joined by name). A
// park without an inventory pin is pinned by its address (US Census), else by a point inside its
// boundary; any pin outside the park's boundary (with a little slack) is replaced by that point. Parks closed to the public, or open only by prior arrangement, are left out.
// Like the county parks: a state park inside a city pack's map area goes to that city's
// florida-state-parks.csv (imported once, adding missing parks), else inside a county pack's area
// to that county's, else to the Florida State Parks pack (seed/cities/florida-state-parks/).
// A park within 250 m of one the pack already has is a duplicate and is left out.
// Never run in production.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { get, decode, slugify, fixed, censusPoint, inBounds } from './lib/seed-fetch.js';
import { stringifyCsv, parseCsv } from '../src/lib/csv.js';
import { PARK_CSV_COLUMNS } from '../src/domain/csv-import.js';
import { distanceMeters } from '../src/domain/geo.js';

const DEP = 'https://ca.dep.state.fl.us/arcgis/rest/services/OpenData';
const STATE_KEY = 'florida-state-parks';
const COUNTY_PACKS = new Set(['pinellas']); // counties: a city pack wins over them
const CITIES_DIR = path.join(import.meta.dirname, '..', 'seed', 'cities');
const FLORIDA = { minLat: 24.3, maxLat: 31.1, minLng: -87.7, maxLng: -79.8 };
const PHONE = '(850) 245-2157'; // Florida State Parks information
const DUPLICATE_M = 250;
const OPEN = new Set(['Open-Fee Required', 'Open-No Fee Required']);
// Units that aren't a place of their own: a river camp on the Suwannee River Wilderness Trail,
// and a memorial next to Orman House (one stamp per place).
const SKIP = new Set(['andersons-landing', 'three-servicemen-memorial']);
// Where visitors actually go, when the data's pin is elsewhere in a big park (published coordinates
// of the lighthouse or fort), or a pin from the address (the visitor center).
const PINS = {
  'egmont-key-state-park': { lat: 27.6003, lng: -82.7608 }, // the lighthouse and ferry landing
  'bill-baggs-cape-florida-state-park': { lat: 25.6667, lng: -80.1561 }, // the Cape Florida Lighthouse
  'fort-clinch-state-park': { lat: 30.7022, lng: -81.4397 }, // the fort
};
const PIN_FROM_ADDRESS = new Set(['paynes-prairie-preserve-state-park']); // the visitor center, not the north rim
const RADIUS_M = { 'skyway-fishing-pier-state-park': 700, 'egmont-key-state-park': 900, 'bill-baggs-cape-florida-state-park': 1200 }; // long and thin
const ADDRESSES = {
  'fanning-springs-state-park': '18020 NW Highway 19, Fanning Springs, FL 32693', // the data repeats Manatee Springs' address
  'big-shoals-state-park': '11330 SE County Road 135, White Springs, FL 32096',
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const query = (layer, where, fields, extra = '') => get(`${DEP}/${layer}/query?where=${encodeURIComponent(where)}&outFields=${fields}&returnGeometry=false&f=json${extra}`, { json: true });

/** A check-in circle about the size of the park: the radius of a circle of its area, 150–2000 m. */
export const radiusFor = (acres, name) => {
  if (/\b(?:Trail|Greenways?|Trace)\b/.test(name)) return 300; // a long, thin park: one point on it
  const r = Math.sqrt((acres * 4046.86) / Math.PI);
  return Math.min(2000, Math.max(150, Math.round(r / 50) * 50));
};

/** Our categories (src/domain/categories.js) from an inventory row's amenity counts. */
export function categoriesFor(f, name) {
  const n = (k) => Number(f?.[k]) > 0;
  const any = (...ks) => ks.some(n);
  const cats = new Set();
  if (n('PLAYGROUNDS')) cats.add('playground');
  if (n('PICNIC_SHELTERS')) cats.add('picnic-shelter');
  if (f && Object.keys(f).some((k) => /_TRAIL$/.test(k) && !/OHV/.test(k) && n(k))) cats.add('trails');
  if (any('SALTWATER_BEACHES', 'FRESHWATER_BEACHES')) cats.add('beach');
  if (any('FRESHWATER_BOAT_RAMPS', 'SALTWATER_BOAT_RAMPS', 'SW_CANOE_KAYAK_LAUNCHES', 'FW_CANOE_KAYAK_LAUNCHES', 'S_USE_CANOE_KAYAK_TRAIL')) cats.add('water-access');
  // Most parks list a historic site, so only museums and the historic parks by name count here.
  if (n('MUSEUMS') || /Historic|Archaeological|Museum|Memorial|Battlefield|Fort\b|Mound/.test(name)) cats.add('history-nature');
  if (n('OUTDOOR_SWIMMING_POOLS')) cats.add('pool');
  if (n('OUTDOOR_TENNIS_COURTS')) cats.add('tennis');
  if (n('OUTDOOR_BASKETBALL_COURTS')) cats.add('basketball');
  if (any('BASEBALL_SOFTBALL_FIELDS', 'FOOTBALL_SOCCER_FIELDS', 'MULTIPLE_USE_FIELDS')) cats.add('ball-fields');
  if (/\bLake\b/.test(name)) cats.add('lake');
  if (/\b(?:Trail|Greenways?|Trace|Preserve)\b/.test(name)) cats.add('trails');
  return [...cats].sort();
}

/** A point inside a park's boundary: the centroid of its largest ring (rings come in lon/lat). */
function interiorPoint(rings) {
  const area = (r) => Math.abs(r.reduce((s, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2);
  const ring = [...rings].sort((a, b) => area(b) - area(a))[0];
  const [x, y] = ring.reduce(([sx, sy], [px, py]) => [sx + px, sy + py], [0, 0]).map((v) => v / ring.length);
  return { lat: y, lng: x };
}

function packs() {
  return fs.readdirSync(CITIES_DIR).filter((k) => k !== STATE_KEY && fs.existsSync(path.join(CITIES_DIR, k, 'city.json'))).map((key) => {
    const dir = path.join(CITIES_DIR, key);
    const b = JSON.parse(fs.readFileSync(path.join(dir, 'city.json'), 'utf8')).bounds;
    const parks = fs.readdirSync(dir).filter((f) => /^([a-z0-9-]+-)?parks\.csv$/.test(f) && f !== 'florida-state-parks.csv')
      .flatMap((f) => parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((r) => r.lat)
      .map((r) => ({ slug: r.slug, name: r.name, lat: +r.lat, lng: +r.lng }));
    return { key, county: COUNTY_PACKS.has(key), bounds: b, center: b.center || { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 }, parks };
  });
}

/** The pack whose map area holds the pin: a city before a county, the nearest center among equals. */
export function packFor(pin, all) {
  const inside = all.filter((p) => inBounds(p.bounds, pin))
    .sort((a, b) => Number(a.county) - Number(b.county) || distanceMeters(pin, a.center) - distanceMeters(pin, b.center));
  return inside[0] || null;
}

async function main() {
  const units = (await query('PARKS_BOUNDARIES/MapServer/0', '1=1', 'UNIT_ID,SITE_NAME,PUBLIC_ACC,ACREAGE,COUNTY,URL,ADDRESS')).features.map((f) => f.attributes);
  const open = units.filter((u) => OPEN.has(u.PUBLIC_ACC));
  console.log(`${units.length} units, ${open.length} open to the public`);
  const fori = (await query('PARKS_FORI/MapServer/0', "SITE_NAME LIKE '%STATE%'", '*')).features.map((f) => f.attributes);
  const byName = new Map();
  for (const f of fori) if (!byName.has(norm(f.SITE_NAME))) byName.set(norm(f.SITE_NAME), f);
  // Every boundary (simplified), to check pins against.
  const geo = await get(`${DEP}/PARKS_BOUNDARIES/MapServer/0/query?where=1%3D1&outFields=UNIT_ID&returnGeometry=true&outSR=4326&maxAllowableOffset=0.002&f=json`, { json: true });
  const rings = new Map(geo.features.map((g) => [g.attributes.UNIT_ID, g.geometry?.rings || []]));
  const all = packs();
  const out = new Map();
  for (const u of open) {
    const name = decode(u.SITE_NAME).replace(/\s*\(Managed by [^)]*\)/i, '').trim();
    const slug = slugify(name);
    if (SKIP.has(slug)) continue;
    const address = ADDRESSES[slug] || u.ADDRESS;
    const f = byName.get(norm(u.SITE_NAME));
    let pin = f && Number(f.DECIMAL_DEGREES_LAT) ? { lat: Number(f.DECIMAL_DEGREES_LAT), lng: Number(f.DECIMAL_DEGREES_LONG) } : null;
    if (pin && pin.lng > 0) pin.lng = -pin.lng; // some rows store west longitude as positive
    let via = pin ? 'inventory' : '';
    if (PIN_FROM_ADDRESS.has(slug)) { const p = await censusPoint(address, FLORIDA); if (p) { pin = p; via = 'address'; } }
    if (!pin && /^\d/.test(address || '')) { pin = await censusPoint(address, FLORIDA); via = 'address'; }
    const r = rings.get(u.UNIT_ID) || [];
    if (r.length) {
      const pts = r.flat();
      const box = { minLat: Math.min(...pts.map((p) => p[1])) - 0.02, maxLat: Math.max(...pts.map((p) => p[1])) + 0.02,
        minLng: Math.min(...pts.map((p) => p[0])) - 0.02, maxLng: Math.max(...pts.map((p) => p[0])) + 0.02 };
      if (!pin || !inBounds(box, pin)) {
        if (pin) console.warn(`  ! ${slug}: the ${via} pin is outside the park; using a point inside its boundary`);
        pin = interiorPoint(r);
        via = 'boundary';
      }
    }
    if (PINS[slug]) { pin = PINS[slug]; via = 'set by hand'; }
    if (!pin || !inBounds(FLORIDA, pin)) { console.warn(`  ! ${slug}: no pin`); pin = null; }
    const pack = pin ? packFor(pin, all) : null;
    // A duplicate of a park the pack already has, or of one this run already placed in the same pack.
    const placed = (out.get(pack?.key || STATE_KEY) || []).map((r) => ({ slug: r.slug, name: r.name, lat: +r.lat, lng: +r.lng }));
    const dupe = pin && [...(pack?.parks || []), ...placed].find((x) => x.slug === slug || distanceMeters(pin, x) <= DUPLICATE_M);
    if (dupe) { console.log(`${slug.padEnd(52)} skip: ${pack?.key || STATE_KEY} already has ${dupe.name}`); continue; }
    const key = pack?.key || STATE_KEY;
    if (key !== STATE_KEY) console.log(`${slug.padEnd(52)} -> ${key} (${via})`);
    const row = {
      slug, name, address: address && /,\s*FL\b/.test(address) ? decode(address) : `${u.COUNTY} County, FL`, phone: PHONE,
      lat: fixed(pin?.lat), lng: fixed(pin?.lng), checkin_radius_m: String(RADIUS_M[slug] || radiusFor(u.ACREAGE || 0, name)),
      categories: categoriesFor(f, name).join('|'), // Our parks need an https link: the park page, else the parks list (one unit links a private camp over http).
      city_url: /^https:\/\/www\.floridastateparks\.org\//.test(u.URL || '') ? u.URL : 'https://www.floridastateparks.org/parks-and-trails', needs_pin: pin ? '0' : '1',
    };
    out.set(key, [...(out.get(key) || []), row]);
  }
  for (const [key, rows] of out) {
    const file = path.join(CITIES_DIR, key, key === STATE_KEY ? 'parks.csv' : 'florida-state-parks.csv');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const seen = new Set();
    const unique = rows.filter((r) => !seen.has(r.slug) && seen.add(r.slug)).sort((a, b) => a.slug.localeCompare(b.slug));
    fs.writeFileSync(file, stringifyCsv(PARK_CSV_COLUMNS, unique));
    console.log(`Wrote ${unique.length} rows to ${path.relative(process.cwd(), file)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
