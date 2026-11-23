import { validateParkRow } from './csv-import.js';
import { CATEGORIES } from './categories.js';
import { RULES } from './badges/rules.js';

// ---------- Parks ----------

export const allParksForAdmin = (db, { filter = '' } = {}) => db.prepare(`SELECT p.*,
    (SELECT COUNT(*) FROM visits v WHERE v.park_id = p.id) AS visit_count
  FROM parks p ${filter === 'needs_pin' ? 'WHERE p.needs_pin = 1' : filter === 'inactive' ? 'WHERE p.active = 0' : ''}
  ORDER BY p.name COLLATE NOCASE`).all();

export function parkForAdmin(db, id) {
  const park = db.prepare('SELECT * FROM parks WHERE id = ?').get(id);
  if (!park) return null;
  park.categories = db.prepare('SELECT category FROM park_categories WHERE park_id = ? ORDER BY category').pluck().all(id);
  return park;
}

/**
 * Creates (id = null) or updates a park from the admin form. Uses the CSV import's validation.
 * Saving a park with coordinates clears needs_pin unless "needs a pin check" stays ticked.
 * Returns { park } or { error }.
 */
export function saveParkFromForm(db, id, form, { now = new Date() } = {}) {
  const cats = [].concat(form.categories || []).map(String).filter((c) => Object.hasOwn(CATEGORIES, c));
  // Repeated fields arrive as arrays; only plain strings are accepted.
  const f = (k) => (typeof form[k] === 'string' ? form[k] : '');
  const { park, error } = validateParkRow({
    slug: f('slug').trim(), name: f('name'), address: f('address'), phone: f('phone'),
    lat: f('lat').trim(), lng: f('lng').trim(), checkin_radius_m: f('checkin_radius_m').trim(),
    categories: cats.join('|'), city_url: f('city_url'), needs_pin: form.needs_pin === '1' ? '1' : '0',
  });
  if (error) return { error: error.charAt(0).toUpperCase() + error.slice(1) + '.' };
  const clash = db.prepare('SELECT id FROM parks WHERE slug = ? AND id IS NOT ?').get(park.slug, id);
  if (clash) return { error: 'Another park already uses that slug.' };
  const active = form.active === '1' ? 1 : 0;
  const ts = now.toISOString();
  const saved = db.transaction(() => {
    let parkId = id;
    if (id) {
      db.prepare(`UPDATE parks SET slug=@slug, name=@name, address=@address, phone=@phone, lat=@lat, lng=@lng,
        checkin_radius_m=@checkin_radius_m, city_url=@city_url, needs_pin=@needs_pin, active=@active, updated_at=@ts
        WHERE id=@id`).run({ ...park, active, ts, id });
    } else {
      parkId = db.prepare(`INSERT INTO parks (slug, name, address, phone, lat, lng, checkin_radius_m, city_url,
        needs_pin, active, created_at, updated_at) VALUES (@slug, @name, @address, @phone, @lat, @lng,
        @checkin_radius_m, @city_url, @needs_pin, @active, @ts, @ts)`).run({ ...park, active, ts }).lastInsertRowid;
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
export function validateBadgeForm(form, { isNew }) {
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
  const photos = db.prepare(`SELECT ph.*, u.display_name, u.email, p.name AS park_name, p.slug AS park_slug
    FROM photos ph JOIN users u ON u.id = ph.user_id JOIN parks p ON p.id = ph.park_id
    WHERE ph.visibility IN ('pals', 'public') ORDER BY ph.created_at DESC, ph.id DESC LIMIT ?`).all(limit);
  const reviews = db.prepare(`SELECT r.*, u.display_name, u.email, p.name AS park_name, p.slug AS park_slug
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
