// Points ledger core: every point a user has is a row in `point_events` tied to the thing that
// earned it (source_type, source_id), so deleting the thing reverses its points and the total is
// always derived, never stored.

/** Replaces the points one source earned: parts = [[points, reason], ...]. Returns the total. */
export function setSourcePoints(db, userId, sourceType, sourceId, parts, { now = new Date() } = {}) {
  removeSourcePoints(db, sourceType, sourceId);
  const ins = db.prepare(`INSERT INTO point_events (user_id, source_type, source_id, points, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (const [points, reason] of parts) ins.run(userId, sourceType, sourceId, points, reason, now.toISOString());
  return parts.reduce((s, [p]) => s + p, 0);
}

export const removeSourcePoints = (db, sourceType, sourceId) =>
  db.prepare('DELETE FROM point_events WHERE source_type = ? AND source_id = ?').run(sourceType, sourceId).changes;

export const totalPoints = (db, userId) =>
  db.prepare('SELECT COALESCE(SUM(points), 0) FROM point_events WHERE user_id = ?').pluck().get(userId);
