// Point values (SPEC Flow 7). Changing them here changes every future recalculation.
export const POINTS = {
  firstStamp: 10,     // first stamp at a park
  repeatStamp: 2,     // another day at the same park
  gpsBonus: 5,        // GPS-verified stamp
  photoBonus: 3,      // photo with a stamp
  firstRating: 2,     // first rating of a park
};

/**
 * Points for each of one user's visits to one park, oldest first.
 * visits: [{ id, method, hasPhoto }] in chronological order.
 */
export function visitPoints(visits) {
  return visits.map((v, i) => {
    const parts = [[i === 0 ? POINTS.firstStamp : POINTS.repeatStamp, i === 0 ? 'first stamp' : 'repeat stamp']];
    if (v.method === 'gps') parts.push([POINTS.gpsBonus, 'GPS verified']);
    if (v.hasPhoto) parts.push([POINTS.photoBonus, 'photo']);
    return { id: v.id, total: parts.reduce((s, [p]) => s + p, 0), parts };
  });
}

/**
 * Recomputes the points for every visit this user has at this park and rewrites their ledger
 * rows. Called after any visit is added or removed, so "first stamp" moves if the first is deleted.
 */
export function rebuildParkVisitPoints(db, userId, parkId, { now = new Date() } = {}) {
  const visits = db.prepare(`SELECT id, method FROM visits
    WHERE user_id = ? AND park_id = ? ORDER BY visited_on, id`).all(userId, parkId);
  // The photo bonus (hasPhoto) is added with photos in M7.
  const computed = visitPoints(visits.map((v) => ({ ...v, hasPhoto: false })));

  const del = db.prepare("DELETE FROM point_events WHERE source_type = 'visit' AND source_id = ?");
  const ins = db.prepare(`INSERT INTO point_events (user_id, source_type, source_id, points, reason, created_at)
    VALUES (?, 'visit', ?, ?, ?, ?)`);
  const setPoints = db.prepare('UPDATE visits SET points = ? WHERE id = ?');
  for (const c of computed) {
    del.run(c.id);
    for (const [p, reason] of c.parts) ins.run(userId, c.id, p, reason, now.toISOString());
    setPoints.run(c.total, c.id);
  }
}

export const totalPoints = (db, userId) =>
  db.prepare('SELECT COALESCE(SUM(points), 0) FROM point_events WHERE user_id = ?').pluck().get(userId);
