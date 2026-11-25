import { validateParkRow } from './csv-import.js';
import { cityById, defaultCity } from './city.js';
import { CATEGORIES } from './categories.js';
import { RULES } from './badges/rules.js';

// ---------- Parks ----------

// One city's parks (every city when cityId is null).
export const allParksForAdmin = (db, { filter = '', cityId = null } = {}) => db.prepare(`SELECT p.*,
    (SELECT COUNT(*) FROM visits v WHERE v.park_id = p.id) AS visit_count
  FROM parks p WHERE (? IS NULL OR p.city_id = ?) ${filter === 'needs_pin' ? 'AND p.needs_pin = 1' : filter === 'inactive' ? 'AND p.active = 0' : ''}
  ORDER BY p.name COLLATE NOCASE`).all(cityId, cityId);

export function parkForAdmin(db, id) {
  const park = db.prepare('SELECT p.*, (SELECT key FROM city_themes WHERE id = p.city_id) AS city_key FROM parks p WHERE p.id = ?').get(id);
  if (!park) return null;
  park.categories = db.prepare('SELECT category FROM park_categories WHERE park_id = ? ORDER BY category').pluck().all(id);
  return park;
}

/**
 * Creates (id = null) or updates a park from the admin form. Uses the CSV import's validation.
 * Saving a park with coordinates clears needs_pin unless "needs a pin check" stays ticked.
 * A new park goes in `city` (default: the first city); an existing one stays in its own.
 * Returns { park } or { error }.
 */
export function saveParkFromForm(db, id, form, { now = new Date(), city = null } = {}) {
  const cityId = id ? db.prepare('SELECT city_id FROM parks WHERE id = ?').pluck().get(id) : (city || defaultCity(db)).id;
  const home = cityById(db, cityId) || defaultCity(db);
  const cats = [].concat(form.categories || []).map(String).filter((c) => Object.hasOwn(CATEGORIES, c));
  // Repeated fields arrive as arrays; only plain strings are accepted.
  const f = (k) => (typeof form[k] === 'string' ? form[k] : '');
  const { park, error } = validateParkRow({
    slug: f('slug').trim(), name: f('name'), address: f('address'), phone: f('phone'),
    lat: f('lat').trim(), lng: f('lng').trim(), checkin_radius_m: f('checkin_radius_m').trim(),
    categories: cats.join('|'), city_url: f('city_url'), needs_pin: form.needs_pin === '1' ? '1' : '0',
  }, home.bounds ? { name: home.name, bounds: home.bounds } : undefined);
  if (error) return { error: error.charAt(0).toUpperCase() + error.slice(1) + '.' };
  const loopRaw = f('loop_mi').trim();
  const loop = loopRaw === '' ? null : Number(loopRaw);
  if (loop !== null && !(loop >= 0.1 && loop <= 20)) return { error: 'Walking loop must be from 0.1 to 20 miles, or empty.' };
  park.loop_mi = loop === null ? null : Math.round(loop * 10) / 10;
  const clash = db.prepare('SELECT id FROM parks WHERE city_id = ? AND slug = ? AND id IS NOT ?').get(cityId, park.slug, id);
  if (clash) return { error: 'Another park already uses that slug.' };
  const active = form.active === '1' ? 1 : 0;
  const ts = now.toISOString();
  const saved = db.transaction(() => {
    let parkId = id;
    if (id) {
      db.prepare(`UPDATE parks SET slug=@slug, name=@name, address=@address, phone=@phone, lat=@lat, lng=@lng,
        checkin_radius_m=@checkin_radius_m, loop_mi=@loop_mi, city_url=@city_url, needs_pin=@needs_pin, active=@active, updated_at=@ts
        WHERE id=@id`).run({ ...park, active, ts, id });
    } else {
      parkId = db.prepare(`INSERT INTO parks (city_id, slug, name, address, phone, lat, lng, checkin_radius_m, loop_mi, city_url,
        needs_pin, active, created_at, updated_at) VALUES (@city_id, @slug, @name, @address, @phone, @lat, @lng,
        @checkin_radius_m, @loop_mi, @city_url, @needs_pin, @active, @ts, @ts)`).run({ ...park, city_id: cityId, active, ts }).lastInsertRowid;
    }
    db.prepare('DELETE FROM park_categories WHERE park_id = ?').run(parkId);
    const add = db.prepare('INSERT INTO park_categories (park_id, category) VALUES (?, ?)');
    for (const c of park.categories) add.run(parkId, c);
    return parkId;
  })();
  return { park: parkForAdmin(db, saved) };
}

// ---------- Badges ----------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const allBadgesForAdmin = (db) => db.prepare(`SELECT b.*,
  (SELECT COUNT(*) FROM user_badges ub WHERE ub.badge_id = b.id) AS earned_count
  FROM badges b ORDER BY b.sort, b.id`).all();

export const badgeForAdmin = (db, id) => db.prepare('SELECT * FROM badges WHERE id = ?').get(id) || null;

/** Validates the badge form. Returns { badge } (columns ready to save) or { errors } keyed by field. */
// targets: the valid activity targets (badgeTargets(db) values), for the activity rules.
export function validateBadgeForm(form, { isNew, targets = [] }) {
  const errors = {};
  const s = (k, max) => String(form[k] ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max + 1);
  const name = s('name', 60);
  if (!name) errors.name = 'Enter a name.';
  else if (name.length > 60) errors.name = 'Use 60 characters or fewer.';
  const slug = s('slug', 60).toLowerCase();
  if (isNew && !SLUG_RE.test(slug)) errors.slug = 'Use lowercase letters, digits and hyphens.';
  const description = s('description', 200);
  if (description.length > 200) errors.description = 'Use 200 characters or fewer.';
  const hint = s('hint', 200);
  if (hint.length > 200) errors.hint = 'Use 200 characters or fewer.';
  const art = s('art', 16);
  if (art.length > 16) errors.art = 'Use a single emoji (or upload an image).';

  const ruleType = String(form.rule_type || '');
  const rule = RULES[ruleType];
  if (!rule) errors.rule_type = 'Choose a rule.';
  const kind = String(form.kind || '');
  if (!['known', 'hidden', 'lucky'].includes(kind)) errors.kind = 'Choose how it shows.';
  else if ((kind === 'lucky') !== (ruleType === 'lucky')) errors.kind = 'Lucky badges use the "lucky" rule, and the "lucky" rule needs a lucky badge.';
  if (kind !== 'known' && !hint) errors.hint = 'Hidden and lucky badges need a hint.';

  const params = {};
  for (const [key, type] of Object.entries(rule?.params || {})) {
    const raw = String(form[`param_${key}`] ?? '').trim();
    if (type === 'number' && key === 'probability') {
      const p = Number(raw);
      if (!(p > 0 && p <= 1)) errors[`param_${key}`] = 'Enter a probability above 0 and up to 1 (e.g. 0.05).';
      else params[key] = p;
    } else if (type === 'number') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 1000) errors[`param_${key}`] = 'Enter a whole number from 1 to 1000.';
      else params[key] = n;
    } else if (type === 'category') {
      if (!Object.hasOwn(CATEGORIES, raw)) errors[`param_${key}`] = 'Choose an amenity.';
      else params[key] = raw;
    } else if (type === 'time') {
      if (!TIME_RE.test(raw)) errors[`param_${key}`] = 'Enter a time like 06:30.';
      else params[key] = raw;
    } else if (type === 'target') {
      if (!targets.includes(raw)) errors[`param_${key}`] = 'Choose which activities count.';
      else params[key] = raw;
    } else if (type === 'metric') {
      if (!['minutes', 'miles'].includes(raw)) errors[`param_${key}`] = 'Choose minutes or miles.';
      else params[key] = raw;
    } else if (type === 'amount') {
      const n = Number(raw);
      if (!(n > 0 && n <= 10000) || raw === '') errors[`param_${key}`] = 'Enter a number above 0 and up to 10000.';
      else params[key] = Math.round(n * 10) / 10;
    } else if (type === 'days') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 365 || raw === '') errors[`param_${key}`] = 'Enter whole days from 0 (all time) to 365.';
      else params[key] = n;
    } else if (type === 'per_week') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 7) errors[`param_${key}`] = 'Enter a number of days from 1 to 7.';
      else params[key] = n;
    }
  }
  if (Object.keys(errors).length) return { errors };
  return {
    badge: {
      slug, name, description, hint, art: art || '🏅', rule_type: ruleType,
      rule_params: JSON.stringify(params), kind, enabled: form.enabled === '1' ? 1 : 0,
    },
  };
}

export function saveBadge(db, id, badge, { now = new Date() } = {}) {
  if (id) {
    db.prepare(`UPDATE badges SET name=@name, description=@description, hint=@hint, art=@art, rule_type=@rule_type,
      rule_params=@rule_params, kind=@kind, enabled=@enabled WHERE id=@id`).run({ ...badge, id });
    return badgeForAdmin(db, id);
  }
  if (db.prepare('SELECT 1 FROM badges WHERE slug = ?').get(badge.slug)) return { error: 'slug_taken' };
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 FROM badges').pluck().get();
  const newId = db.prepare(`INSERT INTO badges (slug, name, description, hint, art, rule_type, rule_params, kind, enabled, sort, created_at)
    VALUES (@slug, @name, @description, @hint, @art, @rule_type, @rule_params, @kind, @enabled, @sort, @created_at)`)
    .run({ ...badge, sort, created_at: now.toISOString() }).lastInsertRowid;
  return badgeForAdmin(db, newId);
}

// ---------- Moderation ----------

// Newest shared (pals or public) photos and reviews with comments, hidden ones included so they can be unhidden.
export function moderationQueue(db, { limit = 50 } = {}) {
  const photos = db.prepare(`SELECT ph.*, u.display_name, u.email, p.name AS park_name, p.slug AS park_slug, (SELECT key FROM city_themes WHERE id = p.city_id) AS city_key
    FROM photos ph JOIN users u ON u.id = ph.user_id JOIN parks p ON p.id = ph.park_id
    WHERE ph.visibility IN ('pals', 'public') ORDER BY ph.created_at DESC, ph.id DESC LIMIT ?`).all(limit);
  const reviews = db.prepare(`SELECT r.*, u.display_name, u.email, p.name AS park_name, p.slug AS park_slug, (SELECT key FROM city_themes WHERE id = p.city_id) AS city_key
    FROM ratings r JOIN users u ON u.id = r.user_id JOIN parks p ON p.id = r.park_id
    WHERE r.visibility IN ('pals', 'public') AND r.comment != '' ORDER BY r.updated_at DESC, r.id DESC LIMIT ?`).all(limit);
  return { photos, reviews };
}

export const setPhotoHidden = (db, id, hidden) =>
  db.prepare('UPDATE photos SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id).changes > 0;
export const setCommentHidden = (db, id, hidden) =>
  db.prepare('UPDATE ratings SET comment_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id).changes > 0;

// ---------- Members ----------

export const allUsersForAdmin = (db) => db.prepare(`SELECT u.id, u.display_name, u.email, u.handle, u.is_admin, u.created_at,
  (SELECT COUNT(DISTINCT park_id) FROM visits v WHERE v.user_id = u.id) AS parks
  FROM users u ORDER BY u.created_at DESC`).all();

/** Promotes or demotes a member. Admins can't demote themselves. Returns { ok } or { error }. */
export function setAdminFlag(db, actor, targetId, makeAdmin) {
  if (!makeAdmin && actor.id === targetId) return { error: "You can't remove your own admin access." };
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(targetId)) return { error: 'not_found' };
  // Demoting checks the count in the same statement, so two admins demoting each other at once
  // can't leave the app with none.
  const changes = makeAdmin
    ? db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(targetId).changes
    : db.prepare('UPDATE users SET is_admin = 0 WHERE id = ? AND (SELECT COUNT(*) FROM users WHERE is_admin = 1) > 1').run(targetId).changes;
  return changes || makeAdmin ? { ok: true } : { error: "There must always be at least one admin." };
}
