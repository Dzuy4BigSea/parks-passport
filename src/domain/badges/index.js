// Parks Passport's adapter for the gamification engine (src/gamification/): the context the rules
// need about one member, and which badges show on their board. Awarding, revoking and the board
// itself are the engine's.
import { createBadgeEngine, addMissingBadges as addMissing } from '../../gamification/index.js';
import { RULES, badgeEdition } from './rules.js';
import { DEFAULT_TIME_ZONE } from '../time.js';

export { takeUnseenBadges, seedBadgesIfEmpty } from '../../gamification/index.js';

/**
 * Adds badges from a seed list whose slugs aren't in the table yet. A city pack's badges.json
 * passes its cityId: those badges count that city only (SPEC Flow 14).
 */
export function addMissingBadges(db, list, { now = new Date(), cityId = null } = {}) {
  const had = new Set(db.prepare('SELECT slug FROM badges').pluck().all());
  const added = addMissing(db, list, { now });
  if (cityId != null) {
    const set = db.prepare('UPDATE badges SET city_id = ? WHERE slug = ?');
    for (const b of list) if (!had.has(b.slug)) set.run(cityId, b.slug);
  }
  return added;
}

// Everything the rules need about one user, loaded once per evaluation.
export function buildContext(db, userId, { trigger = null, random = Math.random, palSameDay = null } = {}) {
  // All of the user's visits, including to parks an admin later deactivated, so deactivating a
  // park never takes badges away. Only all_parks is limited to active parks (activeParkIds).
  // Each visit carries its park's city and that city's time zone (time_of_day reads the local clock there).
  const visits = db.prepare(`SELECT v.id, v.park_id, v.visited_on, v.visited_at, v.created_at, v.method,
      p.city_id, COALESCE(c.time_zone, '${DEFAULT_TIME_ZONE}') AS time_zone
    FROM visits v JOIN parks p ON p.id = v.park_id LEFT JOIN city_themes c ON c.id = p.city_id
    WHERE v.user_id = ? ORDER BY v.visited_on, v.id`).all(userId);
  const parkCity = new Map(db.prepare('SELECT id, city_id FROM parks').raw().all());
  const parkCategories = new Map();
  for (const r of db.prepare('SELECT park_id, category FROM park_categories').all()) {
    if (!parkCategories.has(r.park_id)) parkCategories.set(r.park_id, new Set());
    parkCategories.get(r.park_id).add(r.category);
  }
  const activeParkIds = new Set(db.prepare('SELECT id FROM parks WHERE active = 1').pluck().all());
  const activityLogs = db.prepare(`SELECT a.slug, a.pillar, a.edition, a.category, v.park_id, l.logged_on, l.minutes, l.miles
    FROM activity_logs l JOIN activities a ON a.id = l.activity_id JOIN visits v ON v.id = l.visit_id
    WHERE l.user_id = ? ORDER BY l.logged_on, l.id`).all(userId);
  // Reward schedule: first-time actions, and the next lucky drop in line (one roll per stamp).
  const milestones = new Set(db.prepare('SELECT action FROM user_milestones WHERE user_id = ?').pluck().all(userId));
  const openDrops = db.prepare(`SELECT b.rule_params FROM badges b WHERE b.enabled = 1 AND b.rule_type = 'lucky_drop'
    AND NOT EXISTS (SELECT 1 FROM user_badges ub WHERE ub.badge_id = b.id AND ub.user_id = ?)`).pluck().all(userId)
    .map((p) => { try { return JSON.parse(p).order; } catch { return null; } }).filter(Number.isInteger);
  return {
    visits, parkCategories, activeParkIds, parkCity, activityLogs, trigger, random, milestones,
    nextLuckyOrder: openDrops.length ? Math.min(...openDrops) : null,
    luckyRoll: trigger?.type === 'visit' ? random() : 1,
    // Stamps ever made (deleting a stamp doesn't lower it), and whether this stamp already dropped one.
    lucky: { rolls: db.prepare('SELECT lucky_rolls FROM users WHERE id = ?').pluck().get(userId) || 0, dropped: false },
    palSameDay: palSameDay ?? hasPalSameDay(db, userId),
  };
}

// Whether a Park Pal stamped the same park on the same day as one of this user's stamps.
// Only pals who share their passport (pals or public) count: otherwise the badge would reveal
// a private pal's visits (stamp a park and date, see if the badge appears, delete, repeat).
const hasPalSameDay = (db, userId) => Boolean(db.prepare(`SELECT 1 FROM visits mine
  JOIN visits theirs ON theirs.park_id = mine.park_id AND theirs.visited_on = mine.visited_on
  JOIN users pal ON pal.id = theirs.user_id AND pal.default_visibility IN ('pals', 'public')
  WHERE mine.user_id = ? AND theirs.user_id IN
    (SELECT user_b FROM pal_links WHERE user_a = ? UNION SELECT user_a FROM pal_links WHERE user_b = ?)
  LIMIT 1`).get(userId, userId, userId));

// A city badge (badge.city_id set) sees only that city's visits, parks and activity logs, so
// "Stamp 50 parks" or "Every park" mean parks in that city. Other badges count every city.
function scopeToCity(badge, ctx) {
  if (!badge.city_id || !ctx.parkCity) return ctx;
  const inCity = (parkId) => ctx.parkCity.get(parkId) === badge.city_id;
  return {
    ...ctx,
    visits: ctx.visits.filter((v) => inCity(v.park_id)),
    activeParkIds: new Set([...ctx.activeParkIds].filter(inCity)),
    activityLogs: ctx.activityLogs.filter((l) => inCity(l.park_id)),
  };
}

// Paws and Kids badges show only to members who turned that edition on (or already earned them).
// With { cityId }, another city's badges stay off the board (they show once earned).
function editionFilter(db, userId, { cityId = null } = {}) {
  const user = db.prepare('SELECT paws, kids FROM users WHERE id = ?').get(userId) || {};
  const editionOn = { core: true, paws: Boolean(user.paws), kids: Boolean(user.kids) };
  const activityEditions = new Map(db.prepare('SELECT slug, edition FROM activities').raw().all());
  return (b) => editionOn[badgeEdition(b, activityEditions)] !== false && (cityId == null || b.city_id == null || b.city_id === cityId);
}

const engine = createBadgeEngine({ rules: RULES, loadContext: buildContext, boardFilter: editionFilter, scopeContext: scopeToCity });

/** Whether one badge's rule is met for this context: { earned, progress?, target?, unit? }. */
export const { evaluateRule } = engine;
/** Awards every enabled badge the member now qualifies for; returns the new ones (each at most once). */
export const { awardBadges } = engine;
/** After a deletion: takes back badges no longer met (by the rule as awarded). Lucky drops stay. */
export const { revokeUnmetBadges } = engine;
/** Earned, then known (with progress), hidden and lucky; edition badges only when the edition is on. */
export const { badgeBoard } = engine;
