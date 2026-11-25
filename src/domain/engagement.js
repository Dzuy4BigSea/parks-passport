import { distanceMeters } from './geo.js';
import { dayNumber, mondayOf } from './badges/rules.js';
import { localDate } from './time.js';

// "What next?" signals that pull people back: the weekly streak, the closest unstamped park and
// the badge they're closest to. Everything here is the owner's own data; nothing reveals
// coordinates (distances are between park pins, never from a visit's GPS position).

/**
 * Weekly streak from visit dates (YYYY-MM-DD): consecutive Monday-start weeks with a stamp,
 * counting back from this week (or from last week when this week has none yet: "at risk").
 */
export function weeklyStreak(dates, today) {
  const weeks = new Set(dates.map((d) => mondayOf(dayNumber(d))));
  const thisWeek = mondayOf(dayNumber(today));
  const activeThisWeek = weeks.has(thisWeek);
  let start = activeThisWeek ? thisWeek : thisWeek - 7;
  let count = 0;
  while (weeks.has(start)) { count++; start -= 7; }
  return { weeks: count, activeThisWeek, atRisk: !activeThisWeek && count > 0 };
}

/**
 * The closest unstamped active parks to the park of the user's latest stamp (pins only).
 * Returns [] when the user hasn't stamped yet or every pinned park is stamped.
 */
export function nextParks(db, userId, { limit = 1 } = {}) {
  const anchor = db.prepare(`SELECT p.lat, p.lng FROM visits v JOIN parks p ON p.id = v.park_id
    WHERE v.user_id = ? AND p.lat IS NOT NULL ORDER BY v.visited_on DESC, v.id DESC LIMIT 1`).get(userId);
  if (!anchor) return [];
  const candidates = db.prepare(`SELECT p.id, p.slug, p.name, p.lat, p.lng, (SELECT key FROM city_themes WHERE id = p.city_id) AS city_key FROM parks p
    WHERE p.active = 1 AND p.lat IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.park_id = p.id AND v.user_id = ?)`).all(userId);
  return candidates
    .map((p) => ({ slug: p.slug, city_key: p.city_key, name: p.name, distance_m: distanceMeters(anchor, p) }))
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit);
}

/** The known, unearned badge with the most progress (ties: the smallest target). */
export function closestBadge(board) {
  const open = board.filter((b) => b.state === 'known' && b.target && b.progress < b.target);
  if (!open.length) return null;
  open.sort((a, b) => (b.progress / b.target - a.progress / a.target) || a.target - b.target);
  const b = open[0];
  return { slug: b.slug, name: b.name, art: b.art, progress: b.progress, target: b.target, unit: b.unit, remaining: Math.round((b.target - b.progress) * 10) / 10 };
}

/** Visit dates for the streak (one query, no private fields). */
export function visitDates(db, userId) {
  return db.prepare('SELECT DISTINCT visited_on FROM visits WHERE user_id = ?').pluck().all(userId);
}

/** Everything the home dashboard and the "next up" cards need for one user. */
export function nextUp(db, userId, board, { now = new Date(), timeZone } = {}) {
  return {
    streak: weeklyStreak(visitDates(db, userId), localDate(now, timeZone)),
    nextPark: nextParks(db, userId)[0] || null,
    nextBadge: closestBadge(board),
  };
}

/**
 * The last `n` Monday-start weeks, oldest first, each { label: 'Nov 17', on } where `on` means
 * at least one stamp that week. Drives the streak punch card.
 */
export function weekPunches(dates, today, n = 8) {
  const weeks = new Set(dates.map((d) => mondayOf(dayNumber(d))));
  const thisWeek = mondayOf(dayNumber(today));
  const fmt = (day) => new Date(day * 86400000).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return Array.from({ length: n }, (_, i) => {
    const day = thisWeek - (n - 1 - i) * 7;
    return { label: fmt(day), on: weeks.has(day), current: day === thisWeek };
  });
}
