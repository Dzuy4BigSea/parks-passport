// Data for a passport page: every active park in a city (every city when cityId is null) with the
// owner's first visit, and their history in every city. No coordinates or other private fields.
export function passportData(db, userId, { cityId = null } = {}) {
  const parks = db.prepare(`SELECT p.id, p.city_id, c.key AS city_key, p.slug, p.name, p.lat, p.lng,
      MIN(v.visited_on) AS first_visit, COUNT(v.id) AS visit_count
    FROM parks p JOIN city_themes c ON c.id = p.city_id LEFT JOIN visits v ON v.park_id = p.id AND v.user_id = ?
    WHERE p.active = 1 AND (? IS NULL OR p.city_id = ?) GROUP BY p.id ORDER BY p.name COLLATE NOCASE`).all(userId, cityId, cityId);
  const history = db.prepare(`SELECT v.id, v.visited_on, v.method, v.points, p.name AS park_name, p.slug AS park_slug,
      c.key AS city_key, c.name AS city_name
    FROM visits v JOIN parks p ON p.id = v.park_id JOIN city_themes c ON c.id = p.city_id WHERE v.user_id = ?
    ORDER BY v.visited_on DESC, v.id DESC`).all(userId);
  return { parks, history };
}

/**
 * The user's progress in every active city: [{ city, stamped, total }], in city order. Drives the
 * passport's city tabs (which show only the cities with stamps) and the cross-city summary.
 */
export function cityProgress(db, userId, cities) {
  const rows = new Map(db.prepare(`SELECT p.city_id, COUNT(DISTINCT p.id) AS total,
      COUNT(DISTINCT CASE WHEN v.id IS NOT NULL THEN p.id END) AS stamped
    FROM parks p LEFT JOIN visits v ON v.park_id = p.id AND v.user_id = ?
    WHERE p.active = 1 GROUP BY p.city_id`).all(userId).map((r) => [r.city_id, r]));
  return cities.map((city) => ({ city, stamped: rows.get(city.id)?.stamped || 0, total: rows.get(city.id)?.total || 0 }));
}
