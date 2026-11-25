// Dev-only: builds seed/cities/trinidad/parks.csv from the City of Trinidad, CO's "Parks & Trails
// Directory":
//   node scripts/seed-trinidad.js
// The directory gives names, descriptions and addresses (some are cross streets) but no pins, so
// pins come from OpenStreetMap (the park by name, via Nominatim), else the US Census geocoder.
// A park neither knows is written with needs_pin=1 for an admin to place. Never run in production.
import { get, decode, slugify, fixed, osmPark, censusPoint, writeParksCsv } from './lib/seed-fetch.js';

const DIRECTORY_URL = 'https://www.trinidad.co.gov/services/parks___recreation/parks___recreation.php';
const DETAIL_BASE = 'https://www.trinidad.co.gov/services/parks___recreation/';
const PHONE = '(719) 846-9843'; // City of Trinidad
export const BOUNDS = { minLat: 37.10, maxLat: 37.22, minLng: -104.56, maxLng: -104.44 };
const TRAIL_RADIUS_M = 300;

// The "Lakes" entry is Monument Lake Resort, 35 miles west of town: outside the city's map.
const KINDS = new Set(['Parks', 'Trails']);
// Better names for OSM than the directory's.
// The ball park and the skate park share an address, which OSM knows as South Side Park.
const OSM_NAMES = { 'jay-cimino-downtown-park': ['Cimino Park'], riverwalk: ['Purgatoire Riverwalk'],
  'southside-baseball-park': ['South Side Park'], 'trinidad-skate-park': ['South Side Park'] };
// Words in a park's description -> our categories.
const WORDS = [[/playground/i, 'playground'], [/baseball|soccer|softball/i, 'ball-fields'], [/skate/i, 'skatepark'],
  [/dog park/i, 'dog-park'], [/\blake\b/i, 'lake'], [/trail|riverwalk/i, 'trails'], [/water fountain for kids|splash/i, 'pool'],
  [/historic/i, 'history-nature']];

/** Directory entries: kind, name, description, address and detail link. */
export function parseDirectory(page) {
  return page.split('<div class="rz-business-block">').slice(1).flatMap((block) => {
    const kind = decode((block.match(/<ul class="category-list">\s*<li>([^<]+)<\/li>/) || [])[1] || '');
    const name = (block.match(/<h2>([^<]+)<\/h2>/) || [])[1];
    if (!name) return [];
    const link = (block.match(/href="(business_detail_[^"]+)"/) || [])[1];
    const map = (block.match(/maps\.google\.com\/\?q=[^"]*"[^>]*>\s*<i[^>]*><\/i>([\s\S]*?)<\/a>/) || [])[1] || '';
    return [{
      kind, name: decode(name), link: link ? DETAIL_BASE + link : DIRECTORY_URL,
      description: decode((block.match(/class="rz-business-desc">([\s\S]*?)<\/span>/) || [])[1] || '').replace(/<[^>]+>/g, ''),
      address: decode(map.replace(/<br\s*\/?>/g, ' ')).replace(/,\s*Trinidad/, ', Trinidad').replace(/CO (\d{5})/, 'CO $1'),
    }];
  });
}

async function main() {
  const entries = parseDirectory(await get(DIRECTORY_URL)).filter((e) => KINDS.has(e.kind));
  console.log(`${entries.length} parks and trails`);
  const rows = [];
  for (const e of entries) {
    const name = e.name.replace(/^The /, '');
    const slug = slugify(name);
    let pin = null;
    let via = 'osm';
    for (const n of [...(OSM_NAMES[slug] || []), name]) {
      pin = pin || await osmPark(n, 'Trinidad, Colorado', BOUNDS);
    }
    // Only a street address geocodes; cross streets and trailheads don't.
    if (!pin && /^\d/.test(e.address)) [pin, via] = [await censusPoint(e.address, BOUNDS), 'census'];
    console.log(`${slug.padEnd(32)} ${pin ? via : 'NONE'}`);
    rows.push({
      slug, name, address: e.address, phone: PHONE, lat: fixed(pin?.lat), lng: fixed(pin?.lng),
      checkin_radius_m: e.kind === 'Trails' ? String(TRAIL_RADIUS_M) : '',
      categories: [...new Set(WORDS.filter(([re]) => re.test(`${name} ${e.description}`)).map(([, c]) => c))].sort().join('|'),
      city_url: e.link,
    });
  }
  writeParksCsv('trinidad', rows);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
