import crypto from 'node:crypto';
import { awardBadges, revokeUnmetBadges } from './badges/index.js';

const pair = (a, b) => (a < b ? [a, b] : [b, a]);
const newToken = () => crypto.randomBytes(18).toString('base64url');

// The user's invite token, created on first use.
export function inviteTokenFor(db, userId, { now = new Date() } = {}) {
  const row = db.prepare('SELECT token FROM pal_invites WHERE user_id = ?').get(userId);
  if (row) return row.token;
  const token = newToken();
  db.prepare('INSERT INTO pal_invites (user_id, token, created_at) VALUES (?, ?, ?)').run(userId, token, now.toISOString());
  return token;
}

// Replaces the user's invite token; the old link stops working.
export function regenerateInvite(db, userId, { now = new Date() } = {}) {
  const token = newToken();
  db.prepare(`INSERT INTO pal_invites (user_id, token, created_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at`)
    .run(userId, token, now.toISOString());
  return token;
}

export const inviterForToken = (db, token) => (typeof token === 'string' && token.length <= 64
  ? db.prepare(`SELECT u.* FROM pal_invites i JOIN users u ON u.id = i.user_id WHERE i.token = ?`).get(token) || null
  : null);

/**
 * Accepts an invite: makes the two users pals (both directions) and checks badges for both.
 * Returns { ok } or { error: 'self' | 'already' }.
 */
export function acceptInvite(db, inviter, accepter, { now = new Date(), random = Math.random } = {}) {
  if (inviter.id === accepter.id) return { error: 'self' };
  const [a, b] = pair(inviter.id, accepter.id);
  const { changes } = db.prepare('INSERT OR IGNORE INTO pal_links (user_a, user_b, created_at) VALUES (?, ?, ?)')
    .run(a, b, now.toISOString());
  if (!changes) return { error: 'already' };
  for (const id of [inviter.id, accepter.id]) awardBadges(db, id, { type: 'pal', id: id === a ? b : a }, { now, random });
  return { ok: true };
}

// Removes a pal. The remover's invite link is renewed so the removed pal can't simply re-accept it.
export function removePal(db, userId, palId, { now = new Date() } = {}) {
  const [a, b] = pair(userId, palId);
  const { changes } = db.prepare('DELETE FROM pal_links WHERE user_a = ? AND user_b = ?').run(a, b);
  if (changes) {
    regenerateInvite(db, userId, { now });
    for (const id of [userId, palId]) revokeUnmetBadges(db, id);
  }
  return changes > 0;
}

export const palIdsOf = (db, userId) => db.prepare(`SELECT user_b FROM pal_links WHERE user_a = ?
  UNION SELECT user_a FROM pal_links WHERE user_b = ?`).pluck().all(userId, userId);

export const palsOf = (db, userId) => db.prepare(`SELECT u.id, u.display_name, u.handle, u.default_visibility
  FROM users u WHERE u.id IN (SELECT user_b FROM pal_links WHERE user_a = ? UNION SELECT user_a FROM pal_links WHERE user_b = ?)
  ORDER BY u.display_name COLLATE NOCASE`).all(userId, userId);

// Pals who stamped this park on this day (for "Better Together" in either order).
export const palsAtParkOnDay = (db, userId, parkId, day) => db.prepare(`SELECT DISTINCT v.user_id FROM visits v
  WHERE v.park_id = ? AND v.visited_on = ? AND v.user_id IN
    (SELECT user_b FROM pal_links WHERE user_a = ? UNION SELECT user_a FROM pal_links WHERE user_b = ?)`)
  .pluck().all(parkId, day, userId, userId);

/**
 * Leaderboard: me plus pals whose passport I can see (pals or public), ranked by unique parks
 * stamped, then points.
 */
export function leaderboard(db, userId) {
  return db.prepare(`SELECT u.id, u.display_name, u.handle,
      (SELECT COUNT(DISTINCT park_id) FROM visits v WHERE v.user_id = u.id) AS parks,
      (SELECT COALESCE(SUM(points), 0) FROM point_events pe WHERE pe.user_id = u.id) AS points
    FROM users u
    WHERE u.id = ? OR (u.default_visibility IN ('pals', 'public') AND u.id IN
      (SELECT user_b FROM pal_links WHERE user_a = ? UNION SELECT user_a FROM pal_links WHERE user_b = ?))
    ORDER BY parks DESC, points DESC, u.display_name COLLATE NOCASE`).all(userId, userId, userId);
}

/**
 * Pals feed: stamps and badges from pals whose passport I can see, newest first.
 * (Photos join in M7.) page is 1-based; returns { items, hasMore }.
 */
export const FEED_PAGE_SIZE = 20;
export function palsFeed(db, userId, { page = 1 } = {}) {
  const offset = (Math.max(1, page) - 1) * FEED_PAGE_SIZE;
  const rows = db.prepare(`WITH visible AS (
      SELECT u.id FROM users u WHERE u.default_visibility IN ('pals', 'public') AND u.id IN
        (SELECT user_b FROM pal_links WHERE user_a = @me UNION SELECT user_a FROM pal_links WHERE user_b = @me))
    SELECT 'stamp' AS type, v.created_at AS at, v.user_id, v.visited_on, v.method,
           p.name AS park_name, p.slug AS park_slug, NULL AS badge_name, NULL AS badge_art
      FROM visits v JOIN parks p ON p.id = v.park_id WHERE v.user_id IN (SELECT id FROM visible)
    UNION ALL
    SELECT 'badge', ub.awarded_at, ub.user_id, NULL, NULL, NULL, NULL, b.name, b.art
      FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id IN (SELECT id FROM visible)
    ORDER BY at DESC LIMIT @limit OFFSET @offset`).all({ me: userId, limit: FEED_PAGE_SIZE + 1, offset });
  const users = new Map();
  const userOf = (id) => {
    if (!users.has(id)) users.set(id, db.prepare('SELECT display_name, handle FROM users WHERE id = ?').get(id));
    return users.get(id);
  };
  return {
    items: rows.slice(0, FEED_PAGE_SIZE).map((r) => ({ ...r, user: userOf(r.user_id) })),
    hasMore: rows.length > FEED_PAGE_SIZE,
  };
}
