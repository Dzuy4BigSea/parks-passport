// Dev-only: builds seed/cities/clearwater/parks.csv from Clearwater Parks & Recreation's
// "Find My Neighborhood Park" list:
//   node scripts/seed-clearwater.js
// The site blocks plain HTTP clients, so the list is read in a real browser (Playwright's Chromium,
// a dev dependency), page by page. It gives each place's name, address, tags and a short
// description, but no pins: those come from OpenStreetMap (the park by name, via Nominatim) and the
// US Census geocoder (the address). If both answer and are more than 500 m apart, the address wins.
// Neither? OSM looks up the address itself (it knows some the Census misses, and trail streets).
// Never run in production.
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { get, sleep, slugify, fixed, osmPark, censusPoint, inBounds, writeParksCsv } from './lib/seed-fetch.js';
import { distanceMeters } from '../src/domain/geo.js';

const LIST_URL = 'https://www.myclearwaterparks.com/Parks-and-Trails/Find-My-Neighborhood-Park';
const PHONE = '(727) 562-4800'; // Clearwater Parks & Recreation
export const BOUNDS = { minLat: 27.90, maxLat: 28.08, minLng: -82.86, maxLng: -82.64 };
const TRAIL_RADIUS_M = 300;

// Golf courses aren't parks to stamp (as in the other packs).
const skip = (name) => /Golf (?:Course|Club)|Country Club/.test(name);
// Tags and words in the description -> our categories (src/domain/categories.js).
const TAGS = { 'Beaches': ['beach'], 'Dog Park': ['dog-park'], 'Trails': ['trails'] };
const WORDS = [[/playground/i, 'playground'], [/pavilion|picnic shelter/i, 'picnic-shelter'], [/trail|boardwalk|walking path/i, 'trails'],
  [/ball ?fields?|baseball|softball|soccer|football|playfield|ballpark|stadium|turf field|sports complex/i, 'ball-fields'], [/basketball/i, 'basketball'],
  [/restroom/i, 'restrooms'], [/tennis/i, 'tennis'], [/pickleball/i, 'pickleball'], [/boat ramp|kayak|canoe|paddle|launch|fishing|dock|sailing/i, 'water-access'],
  [/splash|spray|pool/i, 'pool'], [/dog park/i, 'dog-park'], [/skate/i, 'skatepark'], [/shuffleboard/i, 'shuffleboard'],
  [/beach(?! volleyball)/i, 'beach'], [/lake\b/i, 'lake'], [/preserve|nature|historic/i, 'history-nature'], [/fitness/i, 'fitness']];
// Names OSM knows better.
const OSM_NAMES = { 'pinellas-trail': ['Fred Marquis Pinellas Trail', 'Pinellas Trail'], 'baycare-ballpark': ['BayCare Ballpark'],
  'coopers-point-preserve-and-coopers-point-park': ['Cooper\'s Point'] };

/** Every place in the list, page by page: { name, url, address, tags, desc }. */
export async function readList() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: 60000 });
    const all = new Map();
    for (let n = 1; n <= 20; n++) {
      const items = await page.$$eval('.list-item-container article a', (links) => links.map((a) => ({
        url: a.href, name: a.querySelector('.list-item-title')?.textContent.trim() || '',
        address: a.querySelector('.list-item-address')?.textContent.trim() || '',
        tags: (a.querySelector('.tagged-as-list .text')?.textContent || '').replace(/^,\s*/, '').split(/,\s*/).filter(Boolean),
        desc: [...a.querySelectorAll('p:not([class])')].map((p) => p.textContent.trim()).join(' '),
      })));
      for (const i of items) all.set(i.url, i);
      const next = await page.$(`a.page-link[aria-label="page ${n + 1}"]`);
      if (!next) break;
      await next.click();
      await page.waitForTimeout(2500);
    }
    return [...all.values()];
  } finally {
    await browser.close();
  }
}

/** The address (or street) in OpenStreetMap, or null. */
async function osmAddress(address) {
  const q = new URLSearchParams({ q: address, format: 'jsonv2', limit: '1', countrycodes: 'us' });
  const [hit] = await get(`https://nominatim.openstreetmap.org/search?${q}`, { json: true });
  await sleep(1100);
  const pin = hit && { lat: +hit.lat, lng: +hit.lon };
  return pin && inBounds(BOUNDS, pin) ? pin : null;
}

/** "1281 S Hercules Ave., Clearwater 33764" -> "1281 S Hercules Ave, Clearwater, FL 33764". */
export const fullAddress = (a) => a.replace(/\.,/g, ',').replace(/,\s*Clearwater\s+(\d{5})$/, ', Clearwater, FL $1');

async function main() {
  const list = (await readList()).filter((p) => !skip(p.name));
  console.log(`${list.length} places`);
  const rows = [];
  for (const p of list) {
    const slug = slugify(p.name);
    const address = fullAddress(p.address);
    let osm = null;
    for (const n of [...(OSM_NAMES[slug] || []), p.name]) osm = osm || await osmPark(n, 'Clearwater, Florida', BOUNDS);
    const census = /^\d/.test(address) ? await censusPoint(address, BOUNDS) : null;
    const apart = osm && census ? Math.round(distanceMeters(osm, census)) : null;
    let pin = apart != null && apart > 500 ? census : osm || census;
    const viaAddress = !pin;
    if (!pin) pin = await osmAddress(address.replace(/^Fred Marquis /, ''));
    console.log(`${slug.padEnd(46)} ${viaAddress ? (pin ? 'osm address' : 'NONE  ') : pin === osm ? 'osm   ' : 'census'}${apart != null ? ` (${apart} m apart)` : ''}`);
    const trail = p.tags.includes('Trails') && !p.tags.includes('Parks');
    const cats = new Set([...p.tags.flatMap((t) => TAGS[t] || []), ...WORDS.filter(([re]) => re.test(`${p.name} ${p.desc}`)).map(([, c]) => c)]);
    rows.push({
      slug, name: p.name, address, phone: PHONE, lat: fixed(pin?.lat), lng: fixed(pin?.lng),
      checkin_radius_m: trail ? String(TRAIL_RADIUS_M) : '', categories: [...cats].sort().join('|'), city_url: p.url,
    });
  }
  writeParksCsv('clearwater', rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
