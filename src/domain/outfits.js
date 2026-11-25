// Gary's outfits (SPEC Flow 22): drafts an admin approves, starters for everyone, the rest unlocked
// by holding a badge, and "Dress for the weather" (the default) picking one for today's weather.
import fs from 'node:fs';

const json = (s, fallback) => { try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; } };
export const STATUSES = { draft: 'Draft', approved: 'Approved', hidden: 'Hidden' };
export const WEATHER = ['rain', 'snow', 'cold', 'hot', 'mild'];
export const CLASSIC = 'classic';

const parse = (row) => row && ({
  ...row, art: json(row.art, {}), weather: json(row.weather, []), unlock_badges: json(row.unlock_badges, []), starter: Boolean(row.starter),
});

/** Adds the outfits in the seed file that the database doesn't have yet (by slug). Returns how many. */
export function seedOutfits(db, file, { now = new Date() } = {}) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const at = now.toISOString();
  const ins = db.prepare(`INSERT OR IGNORE INTO gary_outfits (slug, name, blurb, art, weather, starter, unlock_badges, status, sort, created_at, updated_at)
    VALUES (@slug, @name, @blurb, @art, @weather, @starter, @unlock, @status, @sort, @at, @at)`);
  let added = 0;
  db.transaction(() => list.forEach((o, i) => {
    added += ins.run({
      slug: o.slug, name: o.name, blurb: o.blurb || '', art: JSON.stringify(o.art || {}), weather: JSON.stringify(o.weather || []),
      starter: o.starter ? 1 : 0, unlock: JSON.stringify(o.unlock_badges || []), status: o.status === 'approved' ? 'approved' : 'draft', sort: (i + 1) * 10, at,
    }).changes;
  }))();
  return added;
}

export const allOutfits = (db) => db.prepare('SELECT * FROM gary_outfits ORDER BY sort, id').all().map(parse);
export const outfitBySlug = (db, slug) => parse(db.prepare('SELECT * FROM gary_outfits WHERE slug = ?').get(String(slug || '')));

/** Badge slugs a member holds (none for a visitor). */
const heldBadges = (db, userId) => new Set(userId
  ? db.prepare('SELECT b.slug FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ?').pluck().all(userId) : []);

/** Approved outfits, each with `owned` (a starter, or one of its badges is held) for this member. */
export function wardrobe(db, userId) {
  const held = heldBadges(db, userId);
  return allOutfits(db).filter((o) => o.status === 'approved')
    .map((o) => ({ ...o, owned: o.starter || o.slug === CLASSIC || o.unlock_badges.some((b) => held.has(b)) }));
}

/**
 * What Gary wears for this member (or visitor): their choice if they still own it, else the first
 * outfit they own that suits today's weather, else Classic. Returns { outfit, auto, weather }.
 */
export function outfitFor(db, user, weather) {
  const owned = wardrobe(db, user?.id).filter((o) => o.owned);
  const classic = owned.find((o) => o.slug === CLASSIC) || outfitBySlug(db, CLASSIC) || { slug: CLASSIC, name: 'Classic rope hat', art: {} };
  const chosen = user?.gary_outfit && owned.find((o) => o.slug === user.gary_outfit);
  if (chosen) return { outfit: chosen, auto: false, weather };
  const condition = weather?.condition;
  // Special outfits before the starters, so a parka beats Classic on a snowy day.
  const fits = condition ? owned.filter((o) => o.weather.includes(condition)).sort((a, b) => Number(a.starter) - Number(b.starter) || a.sort - b.sort) : [];
  return { outfit: fits[0] || classic, auto: true, weather };
}

/** Saves the member's choice: an outfit they own, or '' for "Dress for the weather". */
export function chooseOutfit(db, userId, slug) {
  if (!slug) { db.prepare('UPDATE users SET gary_outfit = NULL WHERE id = ?').run(userId); return true; }
  const o = wardrobe(db, userId).find((x) => x.slug === slug && x.owned);
  if (!o) return false;
  db.prepare('UPDATE users SET gary_outfit = ? WHERE id = ?').run(o.slug, userId);
  return true;
}

// ---------- Admin › Gary ----------

export function setOutfitStatus(db, slug, status, { now = new Date() } = {}) {
  if (!Object.hasOwn(STATUSES, status) || (slug === CLASSIC && status !== 'approved')) return false; // Classic always stays
  return db.prepare('UPDATE gary_outfits SET status = ?, updated_at = ? WHERE slug = ?').run(status, now.toISOString(), slug).changes > 0;
}

/** Saves an outfit's name, blurb, starter flag and unlock badges. Returns { ok } or { error }. */
export function updateOutfit(db, slug, form, { now = new Date() } = {}) {
  const name = String(form.name || '').replace(/\s+/g, ' ').trim();
  const blurb = String(form.blurb || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 40) return { error: 'Give it a name of up to 40 characters.' };
  if (blurb.length > 160) return { error: 'Keep the blurb to 160 characters.' };
  const slugs = [...new Set([].concat(form.unlock_badges || []).map(String))];
  const known = slugs.length ? db.prepare(`SELECT slug FROM badges WHERE slug IN (${slugs.map(() => '?').join(',')})`).pluck().all(...slugs) : [];
  const r = db.prepare('UPDATE gary_outfits SET name = ?, blurb = ?, starter = ?, unlock_badges = ?, updated_at = ? WHERE slug = ?')
    .run(name, blurb, form.starter === '1' || slug === CLASSIC ? 1 : 0, JSON.stringify(known), now.toISOString(), slug);
  return r.changes ? { ok: true } : { error: 'not_found' };
}
