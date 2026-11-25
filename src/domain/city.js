import { distanceMeters } from './geo.js';
import { sanitizeSvg } from '../lib/svg-sanitize.js';
import { DEFAULT_TIME_ZONE } from './time.js';

export { DEFAULT_TIME_ZONE };

// Cities (SPEC Flow 14). Each city is a city_themes row: its theme (accent colors, neighborhood
// areas and landmark motifs) plus what the app needs to work there (time zone, map bounds, page
// copy). The brand palette is national; this layer is what makes a city feel like itself.
// A city's files live in seed/cities/<key>/ (a "city pack": city.json, parks.csv, badges.json).

const HEX = /^#[0-9a-fA-F]{6}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A city's key is the first segment of its URLs (/westminster/parks), so it can't be a top-level
// path the app already uses (routes, public/ folders, nginx's /stats).
export const RESERVED_CITY_KEYS = new Set(['account', 'activities', 'admin', 'auth', 'avatars', 'ideas', 'badge-art', 'brand', 'city', 'consent',
  'credits', 'css', 'default', 'fonts', 'forgot', 'healthz', 'icons', 'join', 'js', 'login', 'logout', 'og', 'pals', 'parks',
  'passport', 'photos', 'privacy', 'reset', 'signup', 'stamp', 'stats', 'u', 'vendor', 'visits']);
const TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

// Used when no city exists (never after migration 016, which adds St. Pete): neutral, no motifs.
const FALLBACK = Object.freeze({
  id: null, key: 'default', name: 'your city', tagline: '', accent: '#FF7A59', accent_2: '#7C6CF2', areas: [], motifs: [],
  time_zone: DEFAULT_TIME_ZONE, bounds: null, center: null, listed: true, copy: cityCopy({ name: 'your city' }, {}),
});

/**
 * Page copy for a city, from its pack, with defaults built from the name. Every field is plain
 * text (escaped when rendered).
 *   short: "St. Pete" (headings: "St. Pete parks"); place: "St. Petersburg, Florida" (eyebrow);
 *   official: "the City of St. Petersburg" (the "not affiliated" line); gary: Gary's hello;
 *   description: the meta description; search_examples: the park search placeholder;
 *   made_for: the footer's "Made for …" (default "the <tagline>").
 */
function cityCopy(row, copy) {
  const s = (v, max = 400) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const short = s(copy.short, 40) || row.name;
  return {
    short,
    place: s(copy.place, 60) || row.name,
    official: s(copy.official, 80) || `the City of ${row.name}`,
    gary: s(copy.gary, 600) || `I love wandering ${short} parks, and I still find something new on most visits.`,
    description: s(copy.description, 300)
      || `Check in at every ${short} park you visit, collect stamps and badges, rate your favorites and explore with your Park Pals.`,
    search_examples: s(copy.search_examples, 80) || 'Park name…', // the park search placeholder
    made_for: s(copy.made_for, 80) || (row.tagline ? `the ${row.tagline}` : row.name), // footer: "Made for …"
    og_alt: s(copy.og_alt, 200) || `Parks Passport: stamp every ${short} park you visit. Gary the park guide waves in front of ${short} landmark icons.`, // share image alt text
  };
}

const cache = new WeakMap(); // db -> { list, byKey, byId } (cleared on every city or motif write)
export const clearThemeCache = (db) => cache.delete(db);

const parseJson = (json, fallback) => {
  try { return JSON.parse(json || ''); } catch { return fallback; }
};

const parseAreas = (json) => {
  const list = parseJson(json, []);
  return Array.isArray(list) ? list.filter((a) => a && SLUG_RE.test(a.slug) && a.name
    && Number.isFinite(a.lat) && Number.isFinite(a.lng)) : [];
};

const parseBounds = (json) => {
  const b = parseJson(json, {});
  const ok = b && ['minLat', 'maxLat', 'minLng', 'maxLng'].every((k) => Number.isFinite(b[k])) && b.minLat < b.maxLat && b.minLng < b.maxLng;
  if (!ok) return null;
  // An optional center (e.g. downtown) for maps; otherwise the middle of the box.
  const c = b.center && Number.isFinite(b.center.lat) && Number.isFinite(b.center.lng) ? { lat: b.center.lat, lng: b.center.lng } : null;
  return { minLat: b.minLat, maxLat: b.maxLat, minLng: b.minLng, maxLng: b.maxLng, center: c };
};

export const inBounds = (bounds, lat, lng) => !bounds
  || (lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng);

function themeFromRow(db, row) {
  const motifs = db.prepare(`SELECT id, slug, name, blurb, svg FROM city_motifs
    WHERE theme_id = ? AND status = 'approved' ORDER BY sort, id`).all(row.id)
    .map((m) => ({ ...m, svg: sanitizeSvg(m.svg) })).filter((m) => m.svg);
  const areas = parseAreas(row.areas);
  const bounds = parseBounds(row.bounds);
  const center = bounds ? bounds.center || { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 } : areas[0] || null;
  return Object.freeze({
    id: row.id, key: row.key, name: row.name, tagline: row.tagline,
    accent: HEX.test(row.accent) ? row.accent : FALLBACK.accent,
    accent_2: HEX.test(row.accent_2) ? row.accent_2 : FALLBACK.accent_2,
    areas, motifs, bounds, center, listed: Boolean(row.listed),
    time_zone: TIME_ZONES.has(row.time_zone) ? row.time_zone : DEFAULT_TIME_ZONE,
    copy: cityCopy(row, parseJson(row.copy, {}) || {}),
  });
}

function loadCities(db) {
  if (cache.has(db)) return cache.get(db);
  const rows = db.prepare('SELECT * FROM city_themes WHERE active = 1 ORDER BY sort, id').all();
  const list = rows.map((r) => themeFromRow(db, r));
  const loaded = { list, byKey: new Map(list.map((c) => [c.key, c])), byId: new Map(list.map((c) => [c.id, c])) };
  cache.set(db, loaded);
  return loaded;
}

/** Every active city, in switcher order (sort, then id). St. Pete is first. */
export const listCities = (db) => loadCities(db).list;
/** A city by its URL key (e.g. "westminster"), or null. */
export const cityByKey = (db, key) => loadCities(db).byKey.get(String(key)) || null;
/** A city by id, or null. */
export const cityById = (db, id) => loadCities(db).byId.get(id) || null;
/** The default city: the first active one (St. Pete). */
export const defaultCity = (db) => loadCities(db).list[0] || FALLBACK;

/** A city row for admin edits: by key, else the default city's row. */
export function activeThemeRow(db, key = null) {
  const byKey = key ? db.prepare('SELECT * FROM city_themes WHERE key = ? AND active = 1').get(String(key)) : null;
  return byKey || db.prepare('SELECT * FROM city_themes WHERE active = 1 ORDER BY sort, id LIMIT 1').get() || null;
}

/** A city's theme by key, or the default city's. Kept for callers that predate multi-city. */
export function getTheme(db, key = null) {
  return (key && cityByKey(db, key)) || defaultCity(db);
}

/** The city nearest a point (by its center), among listed cities; null without a point or cities. */
export function nearestCity(db, point) {
  if (!point) return null;
  let best = null;
  let bestD = Infinity;
  for (const c of listCities(db)) {
    if (!c.listed || !c.center) continue;
    const d = distanceMeters(point, c.center);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? { city: best, distance_m: bestD } : null;
}

// Stable small hash so a park always gets the same motif on its stamp.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The motif shown on a park's stamp (null when the city has none). */
export function motifForPark(theme, slug) {
  if (!theme.motifs.length) return null;
  return theme.motifs[hash(slug) % theme.motifs.length];
}

/** The nearest area to a park, or null if the park has no pin or the city defines no areas. */
export function areaForPark(theme, park) {
  if (park.lat == null || park.lng == null || !theme.areas.length) return null;
  let best = null;
  let bestD = Infinity;
  for (const a of theme.areas) {
    const d = distanceMeters(park, a);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

/**
 * Groups parks (each with `first_visit`) into area collections, in the theme's area order, with
 * parks lacking a pin in a trailing "Other parks" group. Stamped parks come first in each group.
 */
export function collections(theme, parks) {
  const groups = new Map(theme.areas.map((a) => [a.slug, { ...a, parks: [] }]));
  const other = { slug: 'other', name: theme.areas.length ? 'Other parks' : 'All parks', parks: [] };
  for (const p of parks) {
    const area = areaForPark(theme, p);
    (area ? groups.get(area.slug) : other).parks.push(p);
  }
  const out = [...groups.values(), other].filter((g) => g.parks.length);
  for (const g of out) {
    g.parks.sort((a, b) => (Boolean(b.first_visit) - Boolean(a.first_visit)) || a.name.localeCompare(b.name));
    g.stamped = g.parks.filter((p) => p.first_visit).length;
    g.total = g.parks.length;
  }
  return out;
}

/**
 * Loads a city pack's city.json, on every start. A new city is added. The theme (name, tagline,
 * colors, areas, motifs) is loaded once, when the city hasn't been seeded yet; after that admins
 * own it. What the app needs to work there (time zone, bounds, copy, listed, sort) always follows
 * the pack. Returns the number of motifs added.
 */
export function seedCityPack(db, seed, { now = new Date() } = {}) {
  if (!SLUG_RE.test(seed.key || '')) throw new Error(`city pack key "${seed.key}" must be a slug`);
  if (RESERVED_CITY_KEYS.has(seed.key)) throw new Error(`city pack key "${seed.key}" is a path the app already uses`);
  if (seed.time_zone && !TIME_ZONES.has(seed.time_zone)) throw new Error(`city ${seed.key}: unknown time zone ${seed.time_zone}`);
  if (seed.bounds && !parseBounds(JSON.stringify(seed.bounds))) throw new Error(`city ${seed.key}: bounds need minLat < maxLat and minLng < maxLng`);
  const at = now.toISOString();
  let added = 0;
  db.transaction(() => {
    let row = db.prepare('SELECT * FROM city_themes WHERE key = ?').get(seed.key);
    if (!row) {
      db.prepare(`INSERT INTO city_themes (key, name, active, updated_at) VALUES (?, ?, 1, ?)`).run(seed.key, seed.name, at);
      row = db.prepare('SELECT * FROM city_themes WHERE key = ?').get(seed.key);
    }
    db.prepare('UPDATE city_themes SET time_zone = ?, bounds = ?, copy = ?, listed = ?, sort = ? WHERE id = ?').run(
      seed.time_zone || DEFAULT_TIME_ZONE, JSON.stringify(seed.bounds || {}), JSON.stringify(seed.copy || {}),
      seed.listed === false ? 0 : 1, Number.isInteger(seed.sort) ? seed.sort : 0, row.id);
    if (row.seeded_at) return;
    db.prepare(`UPDATE city_themes SET name = ?, tagline = ?, accent = ?, accent_2 = ?, areas = ?, seeded_at = ?, updated_at = ?
      WHERE id = ?`).run(seed.name, seed.tagline || '', seed.accent, seed.accent_2, JSON.stringify(seed.areas || []), at, at, row.id);
    const ins = db.prepare(`INSERT OR IGNORE INTO city_motifs (theme_id, slug, name, blurb, svg, status, source, sort, created_at)
      VALUES (?, ?, ?, ?, ?, 'approved', 'seed', ?, ?)`);
    (seed.motifs || []).forEach((m, i) => {
      const svg = sanitizeSvg(m.svg);
      if (!svg) throw new Error(`seed motif ${m.slug} has an invalid SVG`);
      added += ins.run(row.id, m.slug, m.name, m.blurb || '', svg, i, at).changes;
    });
  })();
  clearThemeCache(db);
  return added;
}

/** Single-city name, kept for older tests: loads the pack if its theme isn't seeded yet. */
export const seedThemeIfEmpty = seedCityPack;

// ---- Admin edits ----

export function listMotifs(db, themeId) {
  return db.prepare('SELECT * FROM city_motifs WHERE theme_id = ? ORDER BY status DESC, sort, id').all(themeId);
}

/** Validates a theme settings form (name, tagline, two accent colors). */
export function saveThemeSettings(db, themeId, form, { now = new Date() } = {}) {
  const v = (k) => String(form[k] ?? '').trim();
  const values = { name: v('name'), tagline: v('tagline'), accent: v('accent'), accent_2: v('accent_2') };
  const errors = {};
  if (!values.name || values.name.length > 60) errors.name = 'Enter a city name (60 characters or fewer).';
  if (values.tagline.length > 60) errors.tagline = 'Use 60 characters or fewer.';
  if (!HEX.test(values.accent)) errors.accent = 'Use a hex color like #FF7A59.';
  if (!HEX.test(values.accent_2)) errors.accent_2 = 'Use a hex color like #7C6CF2.';
  if (Object.keys(errors).length) return { errors, values };
  db.prepare('UPDATE city_themes SET name = ?, tagline = ?, accent = ?, accent_2 = ?, updated_at = ? WHERE id = ?')
    .run(values.name, values.tagline, values.accent, values.accent_2, now.toISOString(), themeId);
  clearThemeCache(db);
  return { ok: true };
}

/** Validates and cleans one motif (name, blurb, SVG). Returns { motif } or { errors }. */
export function cleanMotif(input) {
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim();
  const blurb = String(input.blurb ?? '').replace(/\s+/g, ' ').trim();
  const svg = sanitizeSvg(String(input.svg ?? ''));
  const errors = {};
  if (!name || name.length > 60) errors.name = 'Enter a name (60 characters or fewer).';
  if (blurb.length > 300) errors.blurb = 'Use 300 characters or fewer.';
  if (!svg) errors.svg = 'The icon must be a simple line drawing: path, circle, line, rect, polygon or polyline shapes only.';
  const slug = (input.slug && SLUG_RE.test(input.slug) ? input.slug
    : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 60) || 'motif';
  return Object.keys(errors).length ? { errors } : { motif: { slug, name, blurb, svg } };
}

function uniqueSlug(db, themeId, slug) {
  const taken = new Set(db.prepare('SELECT slug FROM city_motifs WHERE theme_id = ?').pluck().all(themeId));
  if (!taken.has(slug)) return slug;
  for (let i = 2; ; i++) if (!taken.has(`${slug}-${i}`)) return `${slug}-${i}`;
}

/** Inserts AI drafts (already cleaned). Returns the number added. */
export function addDraftMotifs(db, themeId, motifs, { now = new Date() } = {}) {
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) FROM city_motifs WHERE theme_id = ?').pluck().get(themeId);
  const ins = db.prepare(`INSERT INTO city_motifs (theme_id, slug, name, blurb, svg, status, source, sort, created_at)
    VALUES (?, ?, ?, ?, ?, 'draft', 'ai', ?, ?)`);
  db.transaction(() => motifs.forEach((m, i) => ins.run(themeId, uniqueSlug(db, themeId, m.slug), m.name, m.blurb, m.svg, maxSort + 1 + i, now.toISOString())))();
  clearThemeCache(db);
  return motifs.length;
}

/** Adds a motif an admin drew by hand (live right away). */
export function addAdminMotif(db, themeId, motif, { now = new Date() } = {}) {
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) FROM city_motifs WHERE theme_id = ?').pluck().get(themeId);
  db.prepare(`INSERT INTO city_motifs (theme_id, slug, name, blurb, svg, status, source, sort, created_at)
    VALUES (?, ?, ?, ?, ?, 'approved', 'admin', ?, ?)`).run(themeId, uniqueSlug(db, themeId, motif.slug), motif.name, motif.blurb, motif.svg, maxSort + 1, now.toISOString());
  clearThemeCache(db);
}

export function updateMotif(db, themeId, id, motif) {
  const r = db.prepare('UPDATE city_motifs SET name = ?, blurb = ?, svg = ? WHERE id = ? AND theme_id = ?')
    .run(motif.name, motif.blurb, motif.svg, id, themeId);
  clearThemeCache(db);
  return r.changes > 0;
}

export function setMotifStatus(db, themeId, id, status) {
  const r = db.prepare('UPDATE city_motifs SET status = ? WHERE id = ? AND theme_id = ?').run(status, id, themeId);
  clearThemeCache(db);
  return r.changes > 0;
}

export function deleteMotif(db, themeId, id) {
  const r = db.prepare('DELETE FROM city_motifs WHERE id = ? AND theme_id = ?').run(id, themeId);
  clearThemeCache(db);
  return r.changes > 0;
}

/** The time zone of a park's city: "today" for a stamp is today where the park is. */
export const parkTimeZone = (db, parkId) => db.prepare(`SELECT c.time_zone FROM parks p
  JOIN city_themes c ON c.id = p.city_id WHERE p.id = ?`).pluck().get(parkId) || DEFAULT_TIME_ZONE;
