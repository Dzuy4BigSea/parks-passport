// Parks Passport's adapter for the gamification engine (src/gamification/): the context the rules
// need about one member, and which badges show on their board. Awarding, revoking and the board
// itself are the engine's.
import { createBadgeEngine } from '../../gamification/index.js';
import { RULES, badgeEdition } from './rules.js';

export { takeUnseenBadges, addMissingBadges, seedBadgesIfEmpty } from '../../gamification/index.js';

// Everything the rules need about one user, loaded once per evaluation.
export function buildContext(db, userId, { trigger = null, random = Math.random, palSameDay = null } = {}) {
  // All of the user's visits, including to parks an admin later deactivated, so deactivating a
  // park never takes badges away. Only all_parks is limited to active parks (activeParkIds).
  const visits = db.prepare(`SELECT id, park_id, visited_on, visited_at, created_at, method
    FROM visits WHERE user_id = ? ORDER BY visited_on, id`).all(userId);
  const parkCategories = new Map();
  for (const r of db.prepare('SELECT park_id, category FROM park_categories').all()) {
    if (!parkCategories.has(r.park_id)) parkCategories.set(r.park_id, new Set());
    parkCategories.get(r.park_id).add(r.category);
  }
  const activeParkIds = new Set(db.prepare('SELECT id FROM parks WHERE active = 1').pluck().all());
  const activityLogs = db.prepare(`SELECT a.slug, a.pillar, a.edition, a.category, v.park_id, l.logged_on, l.minutes, l.miles
    FROM activity_logs l JOIN activities a ON a.id = l.activity_id JOIN visits v ON v.id = l.visit_id
    WHERE l.user_id = ? ORDER BY l.logged_on, l.id`).all(userId);
  return {
    visits, parkCategories, activeParkIds, activityLogs, trigger, random,
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

// Paws and Kids badges show only to members who turned that edition on (or already earned them).
function editionFilter(db, userId) {
  const user = db.prepare('SELECT paws, kids FROM users WHERE id = ?').get(userId) || {};
  const editionOn = { core: true, paws: Boolean(user.paws), kids: Boolean(user.kids) };
  const activityEditions = new Map(db.prepare('SELECT slug, edition FROM activities').raw().all());
  return (b) => editionOn[badgeEdition(b, activityEditions)] !== false;
}

const engine = createBadgeEngine({ rules: RULES, loadContext: buildContext, boardFilter: editionFilter });

/** Whether one badge's rule is met for this context: { earned, progress?, target?, unit? }. */
export const { evaluateRule } = engine;
/** Awards every enabled badge the member now qualifies for; returns the new ones (each at most once). */
export const { awardBadges } = engine;
/** After a deletion: takes back badges no longer met (by the rule as awarded). Lucky drops stay. */
export const { revokeUnmetBadges } = engine;
/** Earned, then known (with progress), hidden and lucky; edition badges only when the edition is on. */
export const { badgeBoard } = engine;
