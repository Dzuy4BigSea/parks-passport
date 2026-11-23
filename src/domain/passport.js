// Data for a passport page: every active park with the owner's first visit, and their history.
// No coordinates or other private fields.
export function passportData(db, userId) {
  const parks = db.prepare(`SELECT p.id, p.slug, p.name, p.lat, p.lng,
      MIN(v.visited_on) AS first_visit, COUNT(v.id) AS visit_count
    FROM parks p LEFT JOIN visits v ON v.park_id = p.id AND v.user_id = ?
    WHERE p.active = 1 GROUP BY p.id ORDER BY p.name COLLATE NOCASE`).all(userId);
  const history = db.prepare(`SELECT v.id, v.visited_on, v.method, v.points, p.name AS park_name, p.slug AS park_slug
    FROM visits v JOIN parks p ON p.id = v.park_id WHERE v.user_id = ?
    ORDER BY v.visited_on DESC, v.id DESC`).all(userId);
  return { parks, history };
}
