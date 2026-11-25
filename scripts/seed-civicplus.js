// Dev-only: builds seed/cities/<key>/parks.csv for a city whose website runs the CivicPlus
// "Facilities" directory (Cookeville, TN and Marple Township, PA):
//   node scripts/seed-civicplus.js cookeville
//   node scripts/seed-civicplus.js marple
// The directory's search lists the "Parks" facility type with addresses and features; each
// facility's own page carries its map pin. Never run in production.
import { UA, get, sleep, decode, slugify, fixed, writeParksCsv } from './lib/seed-fetch.js';

const SITES = {
  cookeville: {
    host: 'https://www.cookeville-tn.gov', parksCategory: 2,
    // The rentable shelters are inside Cane Creek Park, which is listed on its own (one stamp per place).
    skip: (name) => / Shelter$/.test(name),
    // Amenities named on the park's page but not in its feature list.
    extra: { 'cane-creek-park': ['basketball', 'lake', 'picnic-shelter', 'playground', 'trails', 'water-access'] },
  },
  marple: {
    host: 'https://www.marpletwp.com', parksCategory: 2, skip: () => false,
    extra: {
      'broomall-fields': ['ball-fields'], 'thomas-ballfields': ['ball-fields'], 'south-marple-little-league': ['ball-fields'],
      'malin-road-tot-lot': ['playground'],
    },
  },
};

// CivicPlus feature names -> our categories (src/domain/categories.js).
const FEATURES = {
  'Playground': ['playground'], 'Picnic Shelters': ['picnic-shelter'], 'Pavilion': ['picnic-shelter'],
  'Trails': ['trails'], 'Bike Trail': ['trails'], 'Walking Trail': ['trails'], 'Walking Path': ['trails'],
  'Baseball / Softball': ['ball-fields'], 'Baseball / Softball Diamond': ['ball-fields'], 'Baseball Field': ['ball-fields'],
  'Softball Field': ['ball-fields'], 'Soccer Field': ['ball-fields'], 'Athletic Fields': ['ball-fields'], 'Multi-Purpose Field': ['ball-fields'],
  'Basketball': ['basketball'], 'Basketball Court': ['basketball'], 'Tennis Court': ['tennis'], 'Tennis Courts': ['tennis'],
  'Pickleball': ['pickleball'], 'Pickleball Court': ['pickleball'], 'Restrooms': ['restrooms'], 'Restroom': ['restrooms'],
  'Fishing': ['water-access'], 'Boat Ramp': ['water-access'], 'Dog Park': ['dog-park'], 'Skate Park': ['skatepark'],
  'Splash Pad': ['pool'], 'Pool': ['pool'], 'Fitness Equipment': ['fitness'], 'Exercise Equipment': ['fitness'],
};

/** Facilities in a CivicPlus search results page: name, detail path, address, phone, features. */
export function parseListing(page) {
  return page.split('data-facilityID=').slice(1).flatMap((block) => {
    const link = block.match(/href="(\/Facilities\/Facility\/Details\/[^"]+)"/);
    const name = block.match(/<h3>[\s\S]*?<span>([^<]+)<\/span>/);
    if (!link || !name) return [];
    const part = (cls) => decode((block.match(new RegExp(`class="${cls}">([^<]*)<`)) || [])[1] || '');
    const street = part('street-address');
    const locality = part('locality').replace(/\s*,\s*/, ', ');
    const zip = part('postal-code');
    const tel = (block.match(/href="tel:(\d{3})(\d{3})(\d{4})"/) || []).slice(1);
    const feat = (block.match(/class="feat">[\s\S]*?<ul>([\s\S]*?)<\/ul>/) || [])[1] || '';
    return [{
      name: decode(name[1]), path: link[1],
      address: street ? `${street}, ${locality} ${zip}`.trim() : '',
      phone: tel.length ? `(${tel[0]}) ${tel[1]}-${tel[2]}` : '',
      features: [...feat.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => decode(m[1])),
    }];
  });
}

/** The map pin a facility page embeds (hdn_MapSearchResults), or null. */
export function pinFrom(page) {
  const raw = (page.match(/value="([^"]*)" id="hdn_MapSearchResults"/) || [])[1];
  if (!raw) return null;
  const [hit] = JSON.parse(decode(raw));
  return hit && Number(hit.Latitude) ? { lat: Number(hit.Latitude), lng: Number(hit.Longitude) } : null;
}

async function main() {
  const key = process.argv[2];
  const site = SITES[key];
  if (!site) throw new Error(`Usage: node scripts/seed-civicplus.js <${Object.keys(SITES).join('|')}>`);
  // The search needs the session cookie the directory page sets.
  let cookie = '';
  for (let attempt = 1; !cookie; attempt++) {
    try {
      const res = await fetch(`${site.host}/Facilities?clear=False`, { headers: { 'User-Agent': UA } });
      cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') || 'none=1';
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(1500 * attempt);
    }
  }
  const body = new URLSearchParams({ categoryIDs: String(site.parksCategory), featureIDs: '', pageSize: '100', pageNumber: '1', isReservableOnly: 'false', keywords: '', sortBy: '0' });
  const listing = await get(`${site.host}/Facilities/Facility/Search`, {
    method: 'POST', body, headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const facilities = parseListing(listing).filter((f) => !site.skip(f.name));
  console.log(`${facilities.length} parks`);
  const rows = [];
  for (const f of facilities) {
    await sleep(1000);
    const url = site.host + f.path;
    const pin = pinFrom(await get(url));
    if (!pin) console.warn(`  ! ${f.name}: no pin on its page`);
    const slug = slugify(f.name);
    const cats = new Set([...f.features.flatMap((x) => FEATURES[x] || []), ...(site.extra[slug] || [])]);
    rows.push({
      slug, name: f.name, address: f.address, phone: f.phone, lat: fixed(pin?.lat), lng: fixed(pin?.lng),
      categories: [...cats].sort().join('|'), city_url: url,
    });
  }
  writeParksCsv(key, rows);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
