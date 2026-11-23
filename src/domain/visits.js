import { evaluateCheckin } from './checkin.js';
import { rebuildParkVisitPoints } from './points.js';
import { localDate, isValidDate } from './time.js';

export const EARLIEST_STAMP_DATE = '2000-01-01';

/**
 * Records a stamp. Returns { visit } or { error, ... }.
 *  - method 'gps': position required; must be at the park; always today, now.
 *  - method 'honor' | 'photo': any date from 2000-01-01 to today (local).
 * One stamp per user, park and local day.
 */
export function stampVisit(db, { user, park, method, position = null, visitedOn = null }, { now = new Date() } = {}) {
  const today = localDate(now);
  let date = today;
  let geo = { lat: null, lng: null, accuracy_m: null, distance_m: null };

  if (method === 'gps') {
    if (!position) return { error: 'no_position' };
    const check = evaluateCheckin(park, position);
    if (!check.ok) return { error: check.reason || 'too_far', distance_m: check.distance_m };
    geo = { lat: position.lat, lng: position.lng, accuracy_m: position.accuracy, distance_m: check.distance_m };
  } else if (method === 'honor' || method === 'photo') {
    if (visitedOn) {
      if (!isValidDate(visitedOn) || visitedOn < EARLIEST_STAMP_DATE) return { error: 'bad_date' };
      if (visitedOn > today) return { error: 'future_date' };
      date = visitedOn;
    }
  } else {
    return { error: 'bad_method' };
  }

  // Backdated stamps get noon local as their time; today's stamps get the real time.
  const visitedAt = date === today ? now.toISOString() : `${date}T16:00:00.000Z`;
  try {
    const visitId = db.transaction(() => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO visits
        (user_id, park_id, visited_on, visited_at, method, lat, lng, accuracy_m, distance_m, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, park.id, date, visitedAt, method,
        geo.lat, geo.lng, geo.accuracy_m, geo.distance_m, now.toISOString());
      rebuildParkVisitPoints(db, user.id, park.id, { now });
      return lastInsertRowid;
    })();
    return { visit: getVisit(db, visitId) };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return { error: 'duplicate_day', date };
    throw err;
  }
}

export const getVisit = (db, id) => db.prepare('SELECT * FROM visits WHERE id = ?').get(id);

// Deletes one of the user's own visits and recalculates their points at that park.
export function deleteVisit(db, { user, visitId }, { now = new Date() } = {}) {
  const visit = db.prepare('SELECT * FROM visits WHERE id = ? AND user_id = ?').get(visitId, user.id);
  if (!visit) return null;
  db.transaction(() => {
    db.prepare("DELETE FROM point_events WHERE source_type = 'visit' AND source_id = ?").run(visit.id);
    db.prepare('DELETE FROM visits WHERE id = ?').run(visit.id);
    rebuildParkVisitPoints(db, user.id, visit.park_id, { now });
  })();
  return visit;
}

// The user's visits to one park, newest first. Public fields only (no coordinates).
export const visitsAtPark = (db, userId, parkId) => db.prepare(`SELECT id, visited_on, method, points
  FROM visits WHERE user_id = ? AND park_id = ? ORDER BY visited_on DESC, id DESC`).all(userId, parkId);

// Set of park ids this user has stamped.
export const stampedParkIds = (db, userId) =>
  new Set(db.prepare('SELECT DISTINCT park_id FROM visits WHERE user_id = ?').pluck().all(userId));

export const METHOD_LABELS = { gps: 'GPS verified', photo: 'Photo', honor: 'Honor system' };
