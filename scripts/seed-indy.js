// Dev-only: builds seed/cities/indianapolis/parks.csv from Indy Parks and Recreation's website:
//   node scripts/seed-indy.js
// The site's WordPress API lists every park with its amenities and township; each park's page
// gives its street address, phone and a Google Maps "Directions" link with the place's pin. If a
// page has no place pin, its address is geocoded (US Census), then the park is looked up in
// OpenStreetMap by name (a trail's OSM match is the whole trail, so the address comes first).
// Never run in production.
import { pathToFileURL } from 'node:url';
import { get, sleep, decode, slugify, fixed, osmPark, censusPoint, writeParksCsv } from './lib/seed-fetch.js';

const API = 'https://parks.indy.gov/wp-json/wp/v2/parks?per_page=100&_fields=id,slug,title,link,parent,class_list';
export const BOUNDS = { minLat: 39.60, maxLat: 39.95, minLng: -86.35, maxLng: -85.90 }; // Marion County
const TRAIL_RADIUS_M = 300; // a trail's pin is one point on a long path
// Eagle Creek's page lists two entrances instead of an address, and the park is about 3,900 acres.
// Robey Park's page says S Bridgeport Rd, but 46234 and the park are on N Bridgeport Rd.
const ADDRESSES = { 'eagle-creek-park': '5700 N Eagle Creek Pkwy, Indianapolis, IN 46254',
  'robey-park': '2800 N Bridgeport Rd, Indianapolis, IN 46234' };
const RADIUS_M = { 'eagle-creek-park': 2000 };
// Pages whose Directions link points at another park (Centennial & 20th's goes to Municipal Gardens).
const IGNORE_PAGE_PIN = new Set(['centennial-and-20th-park']);

// Golf courses, a school pool and a highway parcel aren't parks to stamp (as in the other packs).
const skip = (name) => /Golf (?:Course|Academy)$|School Pool$|^Highway Parcel/.test(name);

// Amenity terms (class_list) -> our categories (src/domain/categories.js).
const FEATURES = {
  'outdoor-experience-playground': ['playground'], 'outdoor-experience-shelter': ['picnic-shelter'],
  'outdoor-experience-trails': ['trails'], 'outdoor-experience-bike-trail-mtn': ['trails'], 'outdoor-experience-dog-park': ['dog-park'],
  'sport-experience-baseball': ['ball-fields'], 'sport-experience-softball': ['ball-fields'], 'sport-experience-soccer': ['ball-fields'],
  'sport-experience-football': ['ball-fields'], 'sport-experience-multi-purpose-field': ['ball-fields'],
  'sport-experience-basketball': ['basketball'], 'sport-experience-tennis': ['tennis'], 'sport-experience-pickleball': ['pickleball'],
  'sport-experience-outdoor-fitness': ['fitness'], 'sport-experience-skate-park': ['skatepark'],
  'water-experience-pool-indoor-outdoor': ['pool'], 'water-experience-splash-park': ['pool'], 'water-experience-comfort-station': ['restrooms'],
  'water-experience-fishing': ['water-access'], 'water-experience-boat-launch': ['water-access'],
  'water-experience-canoe-kayak-paddle-board-launch': ['water-access'], 'water-experience-beach': ['beach'],
  'centers-family-center': ['recreation-center'], 'centers-nature-center': ['history-nature'],
  'arts-culture-national-historic-marker': ['history-nature'], 'arts-culture-memorials': ['history-nature'],
};

/** The street address, phone and pin on a park's page. */
export function parsePark(page) {
  const loc = (page.match(/<h2 class="h4">Location<\/h2>\s*<p>([\s\S]*?)<\/p>/) || [])[1];
  const directions = (page.match(/href="(https:\/\/www\.google\.com\/maps[^"]*)"[^>]*>Directions</) || [])[1] || '';
  // !3d…!4d is the place itself; an @lat,lng is only where the map was centered, so it isn't used.
  const exact = directions.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || directions.match(/[?&](?:q|query)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  const phone = (page.match(/<h2 class="h4">Contact<\/h2>\s*<p>\(?(\d{3})\)?[.\s-]?(\d{3})[.\s-](\d{4})<\/p>/) || []).slice(1);
  return {
    address: loc ? decode(loc.replace(/<br\s*\/?>/g, ', ').replace(/<[^>]+>/g, '')) : '',
    pin: exact ? { lat: Number(exact[1]), lng: Number(exact[2]) } : null,
    phone: phone.length ? `(${phone[0]}) ${phone[1]}-${phone[2]}` : '',
  };
}

async function main() {
  const parks = [];
  for (let page = 1; ; page++) {
    const batch = await get(`${API}&page=${page}`, { json: true });
    parks.push(...batch);
    if (batch.length < 100) break; // (an exact multiple of 100 would end on an HTTP 400 and stop)
  }
  // Child pages ("Plan Your Visit", a family center inside Riverside Park) belong to their park.
  const top = parks.filter((p) => !p.parent && !skip(decode(p.title.rendered)));
  console.log(`${top.length} parks (${parks.length - top.length} child pages, golf courses and others left out)`);
  const rows = [];
  for (const p of top) {
    await sleep(1000);
    const name = decode(p.title.rendered);
    const slug = slugify(name);
    const info = parsePark(await get(p.link));
    info.address = ADDRESSES[slug] || info.address;
    let pin = !IGNORE_PAGE_PIN.has(slug) && info.pin && info.pin.lat >= BOUNDS.minLat && info.pin.lat <= BOUNDS.maxLat
      && info.pin.lng >= BOUNDS.minLng && info.pin.lng <= BOUNDS.maxLng ? info.pin : null;
    let via = pin ? 'page' : 'census';
    if (!pin && info.address) pin = await censusPoint(info.address, BOUNDS);
    if (!pin) [pin, via] = [await osmPark(name, 'Indianapolis, Indiana', BOUNDS), 'osm'];
    console.log(`${slug.padEnd(44)} ${pin ? via : 'NONE'}`);
    rows.push({
      slug, name, address: info.address, phone: info.phone, lat: fixed(pin?.lat), lng: fixed(pin?.lng),
      checkin_radius_m: RADIUS_M[slug] ? String(RADIUS_M[slug]) : / Trail$/.test(name) ? String(TRAIL_RADIUS_M) : '',
      categories: [...new Set(p.class_list.flatMap((c) => FEATURES[c] || []))].sort().join('|'), city_url: p.link,
    });
  }
  writeParksCsv('indianapolis', rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
