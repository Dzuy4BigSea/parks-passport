import { canSee, areFriends, VISIBILITY } from './visibility.js';
import { POINTS } from './points.js';

export const MAX_COMMENT = 500;

export function validateRating({ stars, comment }) {
  const n = Number(stars);
  if (!Number.isInteger(n) || n < 1 || n > 5) return 'Choose from 1 to 5 stars.';
  if (String(comment || '').trim().length > MAX_COMMENT) return `Keep your comment to ${MAX_COMMENT} characters.`;
  return null;
}

/**
 * Creates or updates the user's one rating of a park. The first rating of a park earns
 * POINTS.firstRating; updating it doesn't. Returns { rating, created } or { error }.
 */
export function saveRating(db, { user, park, stars, comment = '', visibility }, { now = new Date() } = {}) {
  const error = validateRating({ stars, comment });
  if (error) return { error };
  const existing = db.prepare('SELECT * FROM ratings WHERE user_id = ? AND park_id = ?').get(user.id, park.id);
  const text = String(comment).trim();
  const ts = now.toISOString();
  if (existing) {
    const vis = VISIBILITY.includes(visibility) ? visibility : existing.visibility;
    db.prepare('UPDATE ratings SET stars = ?, comment = ?, visibility = ?, updated_at = ? WHERE id = ?')
      .run(Number(stars), text, vis, ts, existing.id);
    return { rating: db.prepare('SELECT * FROM ratings WHERE id = ?').get(existing.id), created: false };
  }
  const vis = VISIBILITY.includes(visibility) ? visibility : user.default_visibility;
  const id = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(`INSERT INTO ratings (user_id, park_id, stars, comment, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(user.id, park.id, Number(stars), text, vis, ts, ts);
    db.prepare(`INSERT INTO point_events (user_id, source_type, source_id, points, reason, created_at)
      VALUES (?, 'rating', ?, ?, 'first rating', ?)`).run(user.id, lastInsertRowid, POINTS.firstRating, ts);
    return lastInsertRowid;
  })();
  return { rating: db.prepare('SELECT * FROM ratings WHERE id = ?').get(id), created: true };
}

export function deleteRating(db, { user, park }) {
  const r = db.prepare('SELECT * FROM ratings WHERE user_id = ? AND park_id = ?').get(user.id, park.id);
  if (!r) return null;
  db.transaction(() => {
    db.prepare("DELETE FROM point_events WHERE source_type = 'rating' AND source_id = ?").run(r.id);
    db.prepare('DELETE FROM ratings WHERE id = ?').run(r.id);
  })();
  return r;
}

// Average (one decimal) and count over ALL ratings, private ones included: the aggregate is anonymous.
export function ratingSummary(db, parkId) {
  const r = db.prepare('SELECT COUNT(*) AS count, AVG(stars) AS avg FROM ratings WHERE park_id = ?').get(parkId);
  return { count: r.count, average: r.count ? Math.round(r.avg * 10) / 10 : null };
}

// Reviews whose comment the viewer may read (non-empty, not hidden unless own).
export function visibleReviews(db, viewer, parkId) {
  const rows = db.prepare(`SELECT r.*, u.display_name, u.handle FROM ratings r JOIN users u ON u.id = r.user_id
    WHERE r.park_id = ? AND r.comment != '' ORDER BY r.updated_at DESC`).all(parkId);
  return rows.filter((r) => {
    if (viewer?.is_admin) return true;
    if (r.comment_hidden && viewer?.id !== r.user_id) return false;
    return canSee({ viewerId: viewer?.id ?? null, ownerId: r.user_id, visibility: r.visibility,
      isPal: r.visibility === 'pals' && areFriends(db, viewer?.id, r.user_id) });
  });
}

export const myRating = (db, userId, parkId) =>
  db.prepare('SELECT * FROM ratings WHERE user_id = ? AND park_id = ?').get(userId, parkId) || null;
