// "Want to go": parks a member saved. Private: only the owner ever sees their list, so nothing
// here takes a viewer; callers pass the signed-in user's own id.

/** Saves (saved = true) or unsaves a park. Idempotent, so a double submit does no harm. */
export function setSaved(db, userId, parkId, saved, { now = new Date() } = {}) {
  if (saved) {
    db.prepare('INSERT OR IGNORE INTO saved_parks (user_id, park_id, created_at) VALUES (?, ?, ?)')
      .run(userId, parkId, now.toISOString());
  } else {
    db.prepare('DELETE FROM saved_parks WHERE user_id = ? AND park_id = ?').run(userId, parkId);
  }
}

export const savedParkIds = (db, userId) =>
  new Set(db.prepare('SELECT park_id FROM saved_parks WHERE user_id = ?').pluck().all(userId));

export const isSaved = (db, userId, parkId) =>
  Boolean(db.prepare('SELECT 1 FROM saved_parks WHERE user_id = ? AND park_id = ?').get(userId, parkId));

/** Saved active parks the member hasn't stamped yet, A–Z. */
export function wantToGo(db, userId) {
  return db.prepare(`SELECT p.id, p.slug, p.name, p.address FROM saved_parks s JOIN parks p ON p.id = s.park_id
    WHERE s.user_id = ? AND p.active = 1
      AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.park_id = p.id AND v.user_id = s.user_id)
    ORDER BY p.name COLLATE NOCASE`).all(userId);
}
