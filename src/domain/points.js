import { setSourcePoints } from '../gamification/index.js';

export { totalPoints } from '../gamification/index.js';

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
  const visits = db.prepare(`SELECT v.id, v.method,
      EXISTS (SELECT 1 FROM photos ph WHERE ph.visit_id = v.id) AS has_photo
    FROM visits v WHERE v.user_id = ? AND v.park_id = ? ORDER BY v.visited_on, v.id`).all(userId, parkId);
  const computed = visitPoints(visits.map((v) => ({ ...v, hasPhoto: v.has_photo === 1 })));

  const setPoints = db.prepare('UPDATE visits SET points = ? WHERE id = ?');
  for (const c of computed) setPoints.run(setSourcePoints(db, userId, 'visit', c.id, c.parts, { now }), c.id);
}
