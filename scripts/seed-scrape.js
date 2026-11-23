// Dev-only: builds seed/parks.csv from the City of St. Petersburg parks directory.
//   npm run seed:scrape            (writes seed/parks.csv and seed/park-features.txt)
// Coordinates come from the City map embedded on each park's info page; if missing,
// the address is geocoded (US Census, then Nominatim). Never run in production.
import fs from 'node:fs';
import path from 'node:path';
import { stringifyCsv } from '../src/lib/csv.js';
import { PARK_CSV_COLUMNS, ST_PETE_BOUNDS } from '../src/domain/csv-import.js';
import { featureToCategories } from '../seed/categories.js';

const DIRECTORY_URL = 'https://www.stpeteparksrec.org/parks___facilities/_parks.php';
const UA = 'parks-passport-seed/1.0 (personal project)';
const OUT_DIR = path.join(import.meta.dirname, '..', 'seed');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`, { cause: err });
      await sleep(1000 * attempt);
    }
  }
}

const decode = (s) => s
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const slugify = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
  .replace(/\b(Of|And|The|At)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase())
  .replace(/\bMlk\b/g, 'MLK').replace(/, Fl\b/g, ', FL').replace(/\b(N|S|E|W|Ne|Nw|Se|Sw)\b\.?/g, (w) => w.toUpperCase());

const inBounds = (lat, lng) => lat >= ST_PETE_BOUNDS.minLat && lat <= ST_PETE_BOUNDS.maxLat &&
  lng >= ST_PETE_BOUNDS.minLng && lng <= ST_PETE_BOUNDS.maxLng;

// One block per park in the directory listing.
function parseDirectory(page) {
  const blocks = page.split('<!-- Business Name Begins -->').slice(1);
  return blocks.map((b) => {
    const name = decode((b.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || '');
    const info = (b.match(/<a href=\s*"([^"]+)"\s*>\s*Park Information/i) || [])[1] || '';
    const detail = (b.match(/href="([^"]*business_detail_[^"]+)"/) || [])[1] || '';
    const phone = decode((b.match(/<a href="tel:[^"]*">([\s\S]*?)<\/a>/) || [])[1] || '');
    const addr = decode((b.match(/fa-map-marker"><\/i>([\s\S]*?)<\/a>/) || [])[1] || '');
    return { name, info: info.trim(), detail, phone, address: addr.replace(/\s+,/g, ',') };
  }).filter((p) => p.name);
}

function parseInfoPage(page) {
  // Only the park's own embedded map, zoomed in (the site nav links to city-wide map views).
  const embed = page.match(/<iframe[^>]+src="[^"]*events\.stpeteparksrec\.org[^"]*#(\d+)\/(-?\d+\.\d+)\/(-?\d+\.\d+)"/);
  const coords = embed && Number(embed[1]) >= 15 ? [null, embed[2], embed[3]] : null;
  const featuresBlock = page.match(/Park Features[\s\S]{0,400}?<ul>([\s\S]*?)<\/ul>/i);
  const features = featuresBlock
    ? [...featuresBlock[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1])).filter(Boolean)
    : [];
  const title = decode((page.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').split('|')[0].trim();
  return {
    lat: coords ? Number(coords[1]) : null,
    lng: coords ? Number(coords[2]) : null,
    features,
    title,
  };
}

// Looks the park itself up by name in OpenStreetMap, inside the St. Pete box. A park area
// match is more accurate than an intersection address.
const GENERIC = new Set(['park', 'parks', 'the', 'of', 'and', 'at', 'community', 'preserve', 'nature', 'center']);
const tokens = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !GENERIC.has(t));
// Every distinctive word of the City's name must appear in the OSM name.
function namesMatch(cityName, osmName) {
  const want = tokens(cityName);
  const have = new Set(tokens(osmName));
  return want.length > 0 && want.every((t) => have.has(t));
}
const OSM_PARK_CLASSES =new Set(['leisure', 'boundary', 'natural', 'landuse', 'tourism']);
async function findParkByName(name) {
  await sleep(1100); // Nominatim usage policy: max 1 request per second
  const b = ST_PETE_BOUNDS;
  const q = encodeURIComponent(`${name}, St. Petersburg, Florida`);
  try {
    const res = JSON.parse(await get(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&bounded=1&viewbox=${b.minLng},${b.maxLat},${b.maxLng},${b.minLat}&q=${q}`));
    const hit = (res || []).find((r) => OSM_PARK_CLASSES.has(r.class) && namesMatch(name, r.name || ''));
    if (hit) return { lat: Number(hit.lat), lng: Number(hit.lon), source: `osm-${hit.class}:${hit.type}` };
  } catch { /* fall through */ }
  return null;
}

async function geocode(address) {
  const q = encodeURIComponent(address);
  try {
    const census = JSON.parse(await get(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${q}&benchmark=Public_AR_Current&format=json`));
    const m = census?.result?.addressMatches?.[0];
    if (m) return { lat: m.coordinates.y, lng: m.coordinates.x, source: 'census' };
  } catch { /* fall through */ }
  await sleep(1100); // Nominatim usage policy: max 1 request per second
  try {
    const nom = JSON.parse(await get(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`));
    if (nom?.[0]) return { lat: Number(nom[0].lat), lng: Number(nom[0].lon), source: 'nominatim' };
  } catch { /* give up */ }
  return null;
}

async function main() {
  const dir = parseDirectory(await get(DIRECTORY_URL));
  console.log(`Directory lists ${dir.length} parks`);
  const rows = [];
  const allFeatures = new Map();
  const slugs = new Set();

  for (const p of dir) {
    let info = { lat: null, lng: null, features: [], title: '' };
    if (p.info) {
      const page = await get(p.info);
      if (page) info = parseInfoPage(page);
      await sleep(300);
    }
    const name = titleCase(p.name);
    let { lat, lng } = info;
    let source = lat != null ? 'city-map' : '';
    if (lat == null || !inBounds(lat, lng)) {
      const osm = await findParkByName(name);
        if (osm && inBounds(osm.lat, osm.lng)) ({ lat, lng, source } = osm);
      else { lat = null; lng = null; source = ''; }
    }
    if (lat == null) {
      const g = p.address ? await geocode(p.address) : null;
      if (g && inBounds(g.lat, g.lng)) ({ lat, lng, source } = g);
      else { lat = null; lng = null; source = ''; }
    }
    let slug = slugify(name);
    while (slugs.has(slug)) slug += '-2';
    slugs.add(slug);
    for (const f of info.features) allFeatures.set(f, (allFeatures.get(f) || 0) + 1);
    const categories = [...new Set(info.features.flatMap(featureToCategories))].sort();
    rows.push({
      slug, name, address: titleCase(p.address), phone: p.phone,
      lat: lat == null ? '' : lat.toFixed(6), lng: lng == null ? '' : lng.toFixed(6),
      checkin_radius_m: '', categories: categories.join('|'),
      city_url: (p.info || p.detail).replace(/^http:/, 'https:'),
      // City pins and OSM park matches are trusted; address geocodes need a human check.
      needs_pin: lat == null || !(source === 'city-map' || source.startsWith('osm-')) ? 1 : 0,
    });
    console.log(`${lat == null ? '!!' : 'ok'} ${name} [${source || 'no coords'}] ${info.features.length} features`);
  }

  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  fs.writeFileSync(path.join(OUT_DIR, 'parks.csv'), stringifyCsv(PARK_CSV_COLUMNS, rows));
  const featureList = [...allFeatures].sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${String(n).padStart(3)}  ${f}  ->  ${featureToCategories(f).join(', ') || '(none)'}`);
  fs.writeFileSync(path.join(OUT_DIR, 'park-features.txt'),
    '# Raw "Park Features" values from the City site, count, and the categories they map to.\n' +
    '# Edit seed/categories.js to change the mapping, then re-run npm run seed:scrape.\n' +
    featureList.join('\n') + '\n');
  const pins = rows.filter((r) => r.needs_pin === 1).length;
  console.log(`\nWrote ${rows.length} parks (${pins} need a pin check) and ${allFeatures.size} distinct features.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
