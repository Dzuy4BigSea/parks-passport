// Dev-only: builds seed/cities/bend/parks.csv from the Bend Park & Recreation District's park
// locator:
//   node scripts/seed-bend.js
// The locator page holds every park as a map marker with its pin, address and amenity classes,
// so one request is enough. Never run in production.
import { get, decode, slugify, fixed, writeParksCsv } from './lib/seed-fetch.js';

const LOCATOR_URL = 'https://www.bendparksandrec.org/parks-trails/park-locator/';
const PHONE = '(541) 389-7275'; // Bend Park & Recreation District

// Offices and indoor facilities rather than parks to stamp. The swim center sits in Juniper Park,
// which is listed on its own (one stamp per place).
const SKIP = new Set(['district-office', 'park-operations-and-development', 'bend-senior-center',
  'juniper-swim-and-fitness-center', 'the-pavilion-in-bend']);

// Locator amenity classes -> our categories (src/domain/categories.js).
const FEATURES = {
  'playgrounds': ['playground'], 'large-picnic-shelter': ['picnic-shelter'], 'trails': ['trails'], 'paths-unpaved': ['trails'],
  'deschutes-river-trail': ['trails'], 'ball-field': ['ball-fields'], 'sports-field': ['ball-fields'], 'basketball': ['basketball'],
  'restrooms': ['restrooms'], 'seasonal-restrooms': ['restrooms'], 'tennis': ['tennis'], 'pickleball': ['pickleball'],
  'historical-markers': ['history-nature'], 'natural-areas': ['history-nature'], 'river-access': ['water-access'],
  'fitness-loop': ['fitness'], 'dog-off-leash-areas': ['dog-park'], 'water-play-feature': ['pool'], 'skateboarding': ['skatepark'],
};

/** Every marker on the locator page: name, link, address, pin and amenity classes. */
export function parseLocator(page) {
  const re = /<div class="marker ([^"]*)" data-lat="([^"]*)" data-lng="([^"]*)"[^>]*>\s*<h4><a href="([^"]*)"[^>]*>([^<]*)<\/a><\/h4>\s*<p class="address">([^<]*)<\/p>/g;
  return [...page.matchAll(re)].map(([, classes, lat, lng, url, name, address]) => ({
    classes: classes.split(/\s+/).filter(Boolean), lat: Number(lat), lng: Number(lng), url,
    slug: slugify(name), name: decode(name),
    address: decode(address).replace(/, (?:United States|USA)$/, ''),
  }));
}

async function main() {
  const markers = parseLocator(await get(LOCATOR_URL));
  if (!markers.length) throw new Error('No parks on the locator page.');
  const rows = markers.filter((m) => !SKIP.has(m.slug)).map((m) => ({
    slug: m.slug, name: m.name, address: m.address, phone: PHONE, lat: fixed(m.lat), lng: fixed(m.lng),
    categories: [...new Set(m.classes.flatMap((c) => FEATURES[c] || []))].sort().join('|'), city_url: m.url,
  }));
  console.log(`${rows.length} parks (${markers.length - rows.length} offices and facilities left out)`);
  writeParksCsv('bend', rows);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
