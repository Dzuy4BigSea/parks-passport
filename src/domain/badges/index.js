import { RULES } from './rules.js';

const parseParams = (b) => {
  try { return JSON.parse(b.rule_params || '{}'); } catch { return {}; }
};

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
  return {
    visits, parkCategories, activeParkIds, trigger, random,
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

export function evaluateRule(badge, ctx) {
  const rule = RULES[badge.rule_type];
  if (!rule) return { earned: false };
  return rule.evaluate(parseParams(badge), ctx);
}

/**
 * Awards every enabled badge the user now qualifies for and doesn't have yet.
 * Returns the newly awarded badges. Each badge is awarded at most once per user.
 */
export function awardBadges(db, userId, trigger, { now = new Date(), random = Math.random } = {}) {
  const candidates = db.prepare(`SELECT b.* FROM badges b WHERE b.enabled = 1 AND NOT EXISTS
    (SELECT 1 FROM user_badges ub WHERE ub.user_id = ? AND ub.badge_id = b.id) ORDER BY b.sort, b.id`).all(userId);
  if (!candidates.length) return [];
  const ctx = buildContext(db, userId, { trigger, random });
  const insert = db.prepare(`INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_at, source_type, source_id, rule_snapshot)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const awarded = [];
  for (const badge of candidates) {
    if (evaluateRule(badge, ctx).earned) {
      const snapshot = JSON.stringify({ rule_type: badge.rule_type, rule_params: badge.rule_params });
      if (insert.run(userId, badge.id, now.toISOString(), trigger?.type || 'recheck', trigger?.id ?? null, snapshot).changes) {
        awarded.push(badge);
      }
    }
  }
  return awarded;
}

/**
 * After something is deleted: removes earned badges whose criteria are no longer met, judged by
 * the rule as it was when the badge was awarded (an admin editing the rule later never takes it
 * away). Lucky drops and disabled badges are kept.
 */
export function revokeUnmetBadges(db, userId) {
  const earned = db.prepare(`SELECT b.*, ub.rule_snapshot FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? AND b.enabled = 1`).all(userId);
  const asAwarded = earned.map((b) => {
    let snap;
    try { snap = b.rule_snapshot ? JSON.parse(b.rule_snapshot) : null; } catch { snap = null; }
    return snap ? { ...b, rule_type: snap.rule_type, rule_params: snap.rule_params } : b;
  }).filter((b) => b.rule_type !== 'lucky');
  if (!asAwarded.length) return [];
  const ctx = buildContext(db, userId);
  const del = db.prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?');
  const revoked = asAwarded.filter((b) => !evaluateRule(b, ctx).earned);
  for (const b of revoked) del.run(userId, b.id);
  return revoked;
}

/**
 * The user's badge board: earned (with date), then known (with progress), hidden and lucky
 * (no criteria shown). Disabled badges are shown only if already earned.
 */
export function badgeBoard(db, userId) {
  const rows = db.prepare(`SELECT b.*, ub.awarded_at FROM badges b
    LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ?
    WHERE b.enabled = 1 OR ub.awarded_at IS NOT NULL ORDER BY b.sort, b.id`).all(userId);
  const ctx = buildContext(db, userId, { random: () => 1 });
  return rows.map((b) => {
    if (b.awarded_at) return { ...b, state: 'earned' };
    if (b.kind === 'known') {
      const r = evaluateRule(b, ctx);
      return { ...b, state: 'known', progress: r.progress, target: r.target, unit: r.unit };
    }
    return { ...b, state: b.kind }; // hidden | lucky
  });
}

// Badges awarded but not yet announced; marks them announced.
export function takeUnseenBadges(db, userId, { now = new Date() } = {}) {
  const rows = db.prepare(`SELECT b.* FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? AND ub.seen_at IS NULL ORDER BY ub.awarded_at, b.sort`).all(userId);
  if (rows.length) db.prepare('UPDATE user_badges SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL').run(now.toISOString(), userId);
  return rows;
}

// Loads seed/badges.json into an empty badges table.
export function seedBadgesIfEmpty(db, list, { now = new Date() } = {}) {
  if (db.prepare('SELECT COUNT(*) FROM badges').pluck().get() > 0) return 0;
  const ins = db.prepare(`INSERT INTO badges (slug, name, description, hint, art, rule_type, rule_params, kind, sort, created_at)
    VALUES (@slug, @name, @description, @hint, @art, @rule_type, @rule_params, @kind, @sort, @created_at)`);
  db.transaction(() => list.forEach((b, i) => ins.run({
    description: '', hint: '', art: '🏅', ...b, rule_params: JSON.stringify(b.rule_params || {}), sort: i, created_at: now.toISOString(),
  })))();
  return list.length;
}
