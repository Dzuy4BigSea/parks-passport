import { distanceMeters } from './geo.js';
import { sanitizeSvg } from '../lib/svg-sanitize.js';

// City theme: accent colors, neighborhood areas and landmark motifs for the active city.
// The brand palette is national; this layer is what makes a city feel like itself.

const HEX = /^#[0-9a-fA-F]{6}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Used when no theme is seeded (unit tests with a bare DB): neutral, no motifs.
const FALLBACK = Object.freeze({
  id: null, key: 'default', name: 'your city', tagline: '', accent: '#FF7A59', accent_2: '#7C6CF2', areas: [], motifs: [],
});

const cache = new WeakMap(); // db -> theme (cleared on every theme write)
export const clearThemeCache = (db) => cache.delete(db);

const parseAreas = (json) => {
  try {
    const list = JSON.parse(json || '[]');
    return Array.isArray(list) ? list.filter((a) => a && SLUG_RE.test(a.slug) && a.name
      && Number.isFinite(a.lat) && Number.isFinite(a.lng)) : [];
  } catch { return []; }
};

export function activeThemeRow(db) {
  return db.prepare('SELECT * FROM city_themes WHERE active = 1 ORDER BY id LIMIT 1').get() || null;
}

/** The active city theme with its approved motifs (sanitized SVG), cached per db. */
export function getTheme(db) {
  if (cache.has(db)) return cache.get(db);
  const row = activeThemeRow(db);
  let theme = FALLBACK;
  if (row) {
    const motifs = db.prepare(`SELECT id, slug, name, blurb, svg FROM city_motifs
      WHERE theme_id = ? AND status = 'approved' ORDER BY sort, id`).all(row.id)
      .map((m) => ({ ...m, svg: sanitizeSvg(m.svg) })).filter((m) => m.svg);
    theme = {
      id: row.id, key: row.key, name: row.name, tagline: row.tagline,
      accent: HEX.test(row.accent) ? row.accent : FALLBACK.accent,
      accent_2: HEX.test(row.accent_2) ? row.accent_2 : FALLBACK.accent_2,
      areas: parseAreas(row.areas), motifs,
    };
  }
  cache.set(db, theme);
  return theme;
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

/** Loads seed/city-*.json once (when no theme exists) and makes it active. */
export function seedThemeIfEmpty(db, seed, { now = new Date() } = {}) {
  if (db.prepare('SELECT COUNT(*) FROM city_themes').pluck().get() > 0) return 0;
  const at = now.toISOString();
  db.transaction(() => {
    const { lastInsertRowid: themeId } = db.prepare(`INSERT INTO city_themes (key, name, tagline, accent, accent_2, areas, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)`).run(seed.key, seed.name, seed.tagline || '', seed.accent, seed.accent_2, JSON.stringify(seed.areas || []), at);
    const ins = db.prepare(`INSERT INTO city_motifs (theme_id, slug, name, blurb, svg, status, source, sort, created_at)
      VALUES (?, ?, ?, ?, ?, 'approved', 'seed', ?, ?)`);
    (seed.motifs || []).forEach((m, i) => {
      const svg = sanitizeSvg(m.svg);
      if (!svg) throw new Error(`seed motif ${m.slug} has an invalid SVG`);
      ins.run(themeId, m.slug, m.name, m.blurb || '', svg, i, at);
    });
  })();
  clearThemeCache(db);
  return (seed.motifs || []).length;
}

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
