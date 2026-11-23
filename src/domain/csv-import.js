import { parseCsv } from '../lib/csv.js';

export const PARK_CSV_COLUMNS = [
  'slug', 'name', 'address', 'phone', 'lat', 'lng', 'checkin_radius_m',
  'categories', 'city_url', 'needs_pin',
];

// Rough box around the City of St. Petersburg; coordinates outside it are rejected.
export const ST_PETE_BOUNDS = { minLat: 27.60, maxLat: 27.93, minLng: -82.80, maxLng: -82.55 };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const inBounds = (lat, lng) =>
  lat >= ST_PETE_BOUNDS.minLat && lat <= ST_PETE_BOUNDS.maxLat &&
  lng >= ST_PETE_BOUNDS.minLng && lng <= ST_PETE_BOUNDS.maxLng;

// Validates one CSV record. Returns { park } or { error }.
export function validateParkRow(r) {
  const slug = (r.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return { error: 'slug must be lowercase letters, digits and hyphens' };
  const name = (r.name || '').trim();
  if (!name) return { error: 'name is required' };
  if (name.length > 120) return { error: 'name is longer than 120 characters' };

  let needsPin = ['1', 'true', 'yes'].includes(String(r.needs_pin || '').toLowerCase());
  let lat = null;
  let lng = null;
  const present = (v) => v !== '' && v != null;
  if (present(r.lat) || present(r.lng)) {
    lat = Number(r.lat);
    lng = Number(r.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'lat/lng must be numbers' };
    if (!inBounds(lat, lng)) return { error: 'lat/lng is outside St. Petersburg' };
  } else {
    needsPin = true;
  }

  let radius = 150;
  if (r.checkin_radius_m) {
    radius = Number(r.checkin_radius_m);
    if (!Number.isInteger(radius) || radius < 25 || radius > 2000) {
      return { error: 'checkin_radius_m must be a whole number from 25 to 2000' };
    }
  }

  const categories = [...new Set(String(r.categories || '')
    .split('|').map((c) => c.trim().toLowerCase()).filter(Boolean))];
  if (categories.some((c) => !SLUG_RE.test(c))) return { error: 'categories must be slugs separated by |' };

  const cityUrl = (r.city_url || '').trim();
  if (cityUrl && !/^https:\/\//.test(cityUrl)) return { error: 'city_url must start with https://' };

  return {
    park: {
      slug, name, address: (r.address || '').trim(), phone: (r.phone || '').trim(),
      lat, lng, checkin_radius_m: radius, city_url: cityUrl, needs_pin: needsPin ? 1 : 0, categories,
    },
  };
}

// Upserts parks from CSV text, matching on slug. Re-importing the same file changes nothing.
export function importParksCsv(db, csvText, { now = () => new Date() } = {}) {
  const records = parseCsv(csvText);
  const result = { added: 0, updated: 0, unchanged: 0, invalid: [] };
  const ts = now().toISOString();

  const findBySlug = db.prepare('SELECT * FROM parks WHERE slug = ?');
  const catsFor = db.prepare('SELECT category FROM park_categories WHERE park_id = ? ORDER BY category').pluck();
  const insert = db.prepare(`INSERT INTO parks
    (slug, name, address, phone, lat, lng, checkin_radius_m, city_url, needs_pin, active, created_at, updated_at)
    VALUES (@slug, @name, @address, @phone, @lat, @lng, @checkin_radius_m, @city_url, @needs_pin, 1, @ts, @ts)`);
  const update = db.prepare(`UPDATE parks SET name=@name, address=@address, phone=@phone, lat=@lat, lng=@lng,
    checkin_radius_m=@checkin_radius_m, city_url=@city_url, needs_pin=@needs_pin, updated_at=@ts WHERE id=@id`);
  const clearCats = db.prepare('DELETE FROM park_categories WHERE park_id = ?');
  const addCat = db.prepare('INSERT INTO park_categories (park_id, category) VALUES (?, ?)');

  const fields = ['name', 'address', 'phone', 'lat', 'lng', 'checkin_radius_m', 'city_url', 'needs_pin'];
  const seen = new Set();

  db.transaction(() => {
    records.forEach((r, i) => {
      const line = i + 2; // header is line 1
      const { park, error } = validateParkRow(r);
      if (error) { result.invalid.push({ line, slug: r.slug || '', reason: error }); return; }
      if (seen.has(park.slug)) { result.invalid.push({ line, slug: park.slug, reason: 'duplicate slug in file' }); return; }
      seen.add(park.slug);

      const existing = findBySlug.get(park.slug);
      const cats = [...park.categories].sort();
      if (!existing) {
        const { lastInsertRowid } = insert.run({ ...park, ts });
        for (const c of cats) addCat.run(lastInsertRowid, c);
        result.added++;
        return;
      }
      const same = fields.every((f) => existing[f] === park[f]) &&
        JSON.stringify(catsFor.all(existing.id)) === JSON.stringify(cats);
      if (same) { result.unchanged++; return; }
      update.run({ ...park, id: existing.id, ts });
      clearCats.run(existing.id);
      for (const c of cats) addCat.run(existing.id, c);
      result.updated++;
    });
  })();

  return result;
}
