// Parks Passport's adapter for the gamification engine (src/gamification/): the context the rules
// need about one member, and which badges show on their board. Awarding, revoking and the board
// itself are the engine's.
import { createBadgeEngine, addMissingBadges as addMissing } from '../../gamification/index.js';
import { RULES, badgeEdition } from './rules.js';
import { notify } from '../notifications.js';
import { checkGroupGoals } from '../group-goals.js';
import { DEFAULT_TIME_ZONE } from '../time.js';

export { seedBadgesIfEmpty } from '../../gamification/index.js';

/**
 * Adds badges from a seed list whose slugs aren't in the table yet. A city pack's badges.json
 * passes its cityId: those badges count that city only (SPEC Flow 14).
 */
export function addMissingBadges(db, list, { now = new Date(), cityId = null } = {}) {
  const had = new Set(db.prepare('SELECT slug FROM badges').pluck().all());
  const added = addMissing(db, list, { now });
  const limit = db.prepare('UPDATE badges SET limited_count = ? WHERE slug = ?');
  for (const b of list) if (!had.has(b.slug) && b.limited_count) limit.run(b.limited_count, b.slug);
  const team = db.prepare('UPDATE badges SET is_group = 1 WHERE slug = ?');
  for (const b of list) if (!had.has(b.slug) && b.is_group) team.run(b.slug);
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
/** Awards every enabled badge the member now qualifies for; returns the new ones (each at most once). Each goes in the notification center. */
export function awardBadges(db, userId, trigger, opts = {}) {
  const awarded = engine.awardBadges(db, userId, trigger, opts);
  if (trigger?.type === 'visit' || trigger?.type === 'activity') checkGroupGoals(db, userId, { now: opts.now });
  for (const b of awarded) notify(db, userId, { kind: 'badge', text: `You earned ${b.name}.`, link: '/passport#badges' }, { now: opts.now });
  return awarded;
}

/** Badges awarded but not yet announced, with a gift's note and giver; marks them announced. */
export function takeUnseenBadges(db, userId, { now = new Date() } = {}) {
  const rows = db.prepare(`SELECT b.*, ub.serial, ub.times, CASE WHEN ub.source_type = 'group' THEN ub.note END AS team, CASE WHEN ub.source_type = 'grant' THEN ub.note END AS award_note, CASE WHEN ub.source_type = 'grant' THEN g.display_name END AS given_by
    FROM user_badges ub JOIN badges b ON b.id = ub.badge_id LEFT JOIN users g ON g.id = ub.source_id
    WHERE ub.user_id = ? AND ub.seen_at IS NULL ORDER BY ub.awarded_at, b.sort`).all(userId);
  if (rows.length) db.prepare('UPDATE user_badges SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL').run(now.toISOString(), userId);
  return rows;
}

export const NOTE_MAX = 140;

/**
 * An admin gives a member a badge (any badge, even one the rules would never award). It shows on
 * their next page as a new badge, with the note, and in their notifications. Never taken back by
 * the rules. Returns { ok } or { error: 'not_found' | 'already' | 'note' }.
 */
export function grantBadge(db, { admin, userId, badgeId, note = '' }, { now = new Date() } = {}) {
  const member = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  const badge = db.prepare('SELECT * FROM badges WHERE id = ?').get(badgeId);
  if (!member || !badge) return { error: 'not_found' };
  const text = String(note || '').replace(/\s+/g, ' ').trim();
  if (text.length > NOTE_MAX) return { error: 'note' };
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?').get(userId, badgeId)) return { error: 'already' };
    // A limited edition gets the lowest free number (a taken-back number is given again).
    let serial = null;
    if (badge.limited_count) {
      serial = nextSerial(db, badgeId);
      if (serial > badge.limited_count) return { error: 'sold_out' };
    }
    db.prepare(`INSERT INTO user_badges (user_id, badge_id, awarded_at, source_type, source_id, note, serial)
      VALUES (?, ?, ?, 'grant', ?, ?, ?)`).run(userId, badgeId, now.toISOString(), admin.id, text || null, serial);
    const what = serial ? `${badge.name} badge, #${serial} of ${badge.limited_count}` : `${badge.name} badge`;
    notify(db, userId, { kind: 'gift', text: `{actor} gave you the ${what}${text ? `: “${text}”` : '.'}`, link: '/passport#badges', actorId: admin.id }, { now });
    return { ok: true, badge, serial };
  })();
}

/** The lowest number not yet given for a limited edition (1 if none). */
export function nextSerial(db, badgeId) {
  let n = 1;
  for (const s of db.prepare('SELECT serial FROM user_badges WHERE badge_id = ? AND serial IS NOT NULL ORDER BY serial').pluck().all(badgeId)) {
    if (s !== n) break;
    n += 1;
  }
  return n;
}

/** How many copies of a limited edition are given. */
export const serialsGiven = (db, badgeId) => db.prepare('SELECT COUNT(*) FROM user_badges WHERE badge_id = ? AND serial IS NOT NULL').pluck().get(badgeId);

/**
 * Gives one badge to several members at once (Admin › Members). Limited editions are numbered in
 * the order the members joined. Returns { given, already, soldOut } counts, or { error }.
 */
export function grantBadgeToMany(db, { admin, userIds, badgeId, note = '' }, { now = new Date() } = {}) {
  if (!db.prepare('SELECT 1 FROM badges WHERE id = ?').get(badgeId)) return { error: 'not_found' };
  if (String(note || '').replace(/\s+/g, ' ').trim().length > NOTE_MAX) return { error: 'note' };
  const ids = [...new Set(userIds)];
  if (!ids.length) return { error: 'none' };
  const members = db.prepare(`SELECT id FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, id`).pluck().all(...ids);
  const counts = { given: 0, already: 0, soldOut: 0 };
  for (const userId of members) {
    const r = grantBadge(db, { admin, userId, badgeId, note }, { now });
    if (r.ok) counts.given += 1;
    else if (r.error === 'already') counts.already += 1;
    else if (r.error === 'sold_out') counts.soldOut += 1;
  }
  return counts;
}

/** Takes back a badge an admin gave (only given ones). */
export const takeBackGrant = (db, userId, badgeId) => db.prepare(`DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?
  AND source_type = 'grant'`).run(userId, badgeId).changes > 0;
/** After a deletion: takes back badges no longer met (by the rule as awarded). Lucky drops stay. */
export const { revokeUnmetBadges } = engine;
/**
 * Earned, then known (with progress), hidden and lucky; edition badges only when the edition is on.
 * A limited edition carries the number (serial) of the member's copy.
 */
export function badgeBoard(db, userId, options = {}) {
  const serials = new Map(db.prepare('SELECT badge_id, serial FROM user_badges WHERE user_id = ? AND serial IS NOT NULL').raw().all(userId));
  return engine.badgeBoard(db, userId, options).filter((b) => !b.is_group).map((b) => (serials.has(b.id) ? { ...b, serial: serials.get(b.id) } : b));
}
