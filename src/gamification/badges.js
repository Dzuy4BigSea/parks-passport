// Badge engine core: knows nothing about the app's domain. The app supplies the rule types and a
// context loader (everything the rules need about one user), and the engine awards, revokes and
// lists badges from the `badges` and `user_badges` tables (see schema.sql).
//
// A rule is { label, params: { name: type }, evaluate(params, ctx) -> { earned, progress?, target?, unit? },
// permanent?: true }. A permanent rule's badge is never taken back (e.g. a lucky drop).

/** { earned, progress, target, unit } for "N of target" rules; the progress drives displays like "7 / 10". */
export const countProgress = (n, target, unit) => ({ earned: n >= target, progress: Math.min(n, target), target, unit });

const parseParams = (b) => {
  try { return JSON.parse(b.rule_params || '{}'); } catch { return {}; }
};

/**
 * createBadgeEngine({ rules, loadContext, boardFilter?, scopeContext? })
 *   rules: { [rule_type]: rule }
 *   loadContext(db, userId, { trigger, random }) -> ctx passed to every rule
 *   boardFilter(db, userId, options) -> (badge) => boolean: which unearned badges this user sees on
 *     the board (options: whatever the app passed to badgeBoard)
 *   scopeContext(badge, ctx) -> ctx: narrows the context for one badge (e.g. to one region)
 */
export function createBadgeEngine({ rules, loadContext, boardFilter = null, scopeContext = null }) {
  function evaluateRule(badge, ctx) {
    const rule = rules[badge.rule_type];
    if (!rule) return { earned: false };
    return rule.evaluate(parseParams(badge), scopeContext ? scopeContext(badge, ctx) : ctx);
  }

  /**
   * Awards every enabled badge the user now qualifies for and doesn't have yet.
   * trigger = { type, id } (what happened). Returns the newly awarded badges, each at most once per user.
   */
  function awardBadges(db, userId, trigger, { now = new Date(), random = Math.random } = {}) {
    const candidates = db.prepare(`SELECT b.* FROM badges b WHERE b.enabled = 1 AND NOT EXISTS
      (SELECT 1 FROM user_badges ub WHERE ub.user_id = ? AND ub.badge_id = b.id) ORDER BY b.sort, b.id`).all(userId);
    if (!candidates.length) return [];
    const ctx = loadContext(db, userId, { trigger, random });
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
   * the rule as it was when the badge was awarded (editing a rule later never takes it away).
   * Badges from permanent rules and disabled badges are kept.
   */
  function revokeUnmetBadges(db, userId) {
    // Awards given by hand (source_type 'grant') aren't judged by the rules, so they're never taken back.
    const earned = db.prepare(`SELECT b.*, ub.rule_snapshot FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = ? AND b.enabled = 1 AND ub.source_type != 'grant'`).all(userId);
    const asAwarded = earned.map((b) => {
      let snap;
      try { snap = b.rule_snapshot ? JSON.parse(b.rule_snapshot) : null; } catch { snap = null; }
      return snap ? { ...b, rule_type: snap.rule_type, rule_params: snap.rule_params } : b;
    }).filter((b) => !rules[b.rule_type]?.permanent);
    if (!asAwarded.length) return [];
    const ctx = loadContext(db, userId, {});
    const del = db.prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?');
    const revoked = asAwarded.filter((b) => !evaluateRule(b, ctx).earned);
    for (const b of revoked) del.run(userId, b.id);
    return revoked;
  }

  /**
   * The user's badge board: earned (with date), then known (with progress), hidden and lucky
   * (no criteria shown). Disabled badges are shown only if already earned.
   */
  function badgeBoard(db, userId, options = {}) {
    const rows = db.prepare(`SELECT b.*, ub.awarded_at FROM badges b
      LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ?
      WHERE b.enabled = 1 OR ub.awarded_at IS NOT NULL ORDER BY b.sort, b.id`).all(userId);
    // random: () => 1 so chance-based rules never "earn" while drawing progress.
    const ctx = loadContext(db, userId, { random: () => 1 });
    const visible = boardFilter ? boardFilter(db, userId, options) : () => true;
    return rows.filter((b) => b.awarded_at || visible(b)).map((b) => {
      if (b.awarded_at) return { ...b, state: 'earned' };
      if (b.kind === 'known') {
        const r = evaluateRule(b, ctx);
        return { ...b, state: 'known', progress: r.progress, target: r.target, unit: r.unit };
      }
      return { ...b, state: b.kind }; // hidden | lucky
    });
  }

  return { evaluateRule, awardBadges, revokeUnmetBadges, badgeBoard };
}

/** Badges awarded but not yet announced; marks them announced. */
export function takeUnseenBadges(db, userId, { now = new Date() } = {}) {
  const rows = db.prepare(`SELECT b.* FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? AND ub.seen_at IS NULL ORDER BY ub.awarded_at, b.sort`).all(userId);
  if (rows.length) db.prepare('UPDATE user_badges SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL').run(now.toISOString(), userId);
  return rows;
}

const INSERT_BADGE = `INTO badges (slug, name, description, hint, art, rule_type, rule_params, kind, sort, created_at)
  VALUES (@slug, @name, @description, @hint, @art, @rule_type, @rule_params, @kind, @sort, @created_at)`;
const row = (b, sort, now) => ({
  description: '', hint: '', art: '🏅', ...b, rule_params: JSON.stringify(b.rule_params || {}), sort, created_at: now.toISOString(),
});

/** Adds badges from a seed list whose slugs aren't in the table yet. Returns how many were added. */
export function addMissingBadges(db, list, { now = new Date() } = {}) {
  const ins = db.prepare(`INSERT OR IGNORE ${INSERT_BADGE}`);
  let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) FROM badges').pluck().get();
  let added = 0;
  db.transaction(() => list.forEach((b) => {
    added += ins.run(row(b, sort + 1, now)).changes;
    sort += 1;
  }))();
  return added;
}

/** Loads a seed list into an empty badges table. */
export function seedBadgesIfEmpty(db, list, { now = new Date() } = {}) {
  if (db.prepare('SELECT COUNT(*) FROM badges').pluck().get() > 0) return 0;
  const ins = db.prepare(`INSERT ${INSERT_BADGE}`);
  db.transaction(() => list.forEach((b, i) => ins.run(row(b, i, now))))();
  return list.length;
}
