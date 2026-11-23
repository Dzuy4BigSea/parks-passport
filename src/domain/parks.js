import { distanceMeters } from './geo.js';
import { CATEGORIES } from './categories.js';

const withCategories = (db, parks) => {
  if (!parks.length) return parks;
  const rows = db.prepare(`SELECT park_id, category FROM park_categories
    WHERE park_id IN (${parks.map(() => '?').join(',')}) ORDER BY category`).all(...parks.map((p) => p.id));
  const byPark = new Map(parks.map((p) => [p.id, []]));
  for (const r of rows) byPark.get(r.park_id).push(r.category);
  return parks.map((p) => ({ ...p, categories: byPark.get(p.id) }));
};

// Cleans the category filter list down to known slugs.
export const cleanCategories = (input) => {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return [...new Set(list.map(String).filter((c) => Object.hasOwn(CATEGORIES, c)))];
};

/**
 * Active parks, filtered by name search (case-insensitive substring) and categories (all must match).
 * With `near`, sorted by distance (parks without coordinates last) and each has distance_m.
 */
export function listParks(db, { q = '', categories = [], near = null } = {}) {
  const where = ['p.active = 1'];
  const params = [];
  const query = String(q).trim().slice(0, 100);
  if (query) {
    where.push("p.name LIKE ? ESCAPE '\\'"); // LIKE is case-insensitive for ASCII
    params.push(`%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  for (const c of categories) {
    where.push('EXISTS (SELECT 1 FROM park_categories pc WHERE pc.park_id = p.id AND pc.category = ?)');
    params.push(c);
  }
  const parks = db.prepare(`SELECT p.id, p.slug, p.name, p.address, p.lat, p.lng FROM parks p
    WHERE ${where.join(' AND ')} ORDER BY p.name COLLATE NOCASE`).all(...params);

  let result = withCategories(db, parks);
  if (near) {
    result = result
      .map((p) => ({ ...p, distance_m: p.lat == null ? null : distanceMeters(near, p) }))
      .sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
  }
  return result;
}

export const countActiveParks = (db) => db.prepare('SELECT COUNT(*) FROM parks WHERE active = 1').pluck().get();

export function getParkBySlug(db, slug) {
  const park = db.prepare('SELECT * FROM parks WHERE slug = ? AND active = 1').get(String(slug));
  return park ? withCategories(db, [park])[0] : null;
}

// Categories that at least one active park has, in display order.
export function categoriesInUse(db) {
  const used = new Set(db.prepare(`SELECT DISTINCT pc.category FROM park_categories pc
    JOIN parks p ON p.id = pc.park_id WHERE p.active = 1`).pluck().all());
  return Object.keys(CATEGORIES).filter((c) => used.has(c));
}
