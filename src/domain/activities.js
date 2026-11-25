// Healthy activities (docs/healthy-activities.md): things to do at a park once it's stamped today.
// Logs are private to the member. Only badges earned from them follow the passport's visibility.
import { parkTimeZone } from './city.js';
import { localDate } from './time.js';
import { dayNumber, mondayOf } from './badges/rules.js';

export const PILLARS = {
  move: { label: 'Move', icon: '🚶' },
  nature: { label: 'Nature', icon: '🌿' },
  calm: { label: 'Calm', icon: '🧘' },
  connect: { label: 'Connect', icon: '🤝' },
  learn: { label: 'Learn', icon: '🔎' },
  give: { label: 'Give', icon: '💚' },
};
export const EDITIONS = { core: 'Everyone', paws: 'Paws', kids: 'Kids' };
export const MEASURES = ['check', 'minutes', 'miles', 'count'];

// Caps that keep the honor system honest without getting in anyone's way.
export const LIMITS = { minutesPerLog: 180, minutesPerDay: 180, milesPerLog: 15, milesPerDay: 15, countPerLog: 100 };
export const MINUTES_PER_MILE = 20; // brisk walk, for the weekly minute goals
// Weekly goals shown on the passport (US activity guidelines; White et al. 2019).
export const WEEKLY_GOALS = { moveMinutes: 150, parkMinutes: 120 };

/**
 * Loads seed/activities.json on every start: adds new activities and refreshes the wording of
 * existing ones, but never changes `active`, which belongs to the admin.
 */
export function seedActivities(db, list) {
  const up = db.prepare(`INSERT INTO activities (slug, name, description, pillar, edition, category, measure, minutes, points, sort)
    VALUES (@slug, @name, @description, @pillar, @edition, @category, @measure, @minutes, @points, @sort)
    ON CONFLICT(slug) DO UPDATE SET name=excluded.name, description=excluded.description, pillar=excluded.pillar,
      edition=excluded.edition, category=excluded.category, measure=excluded.measure, minutes=excluded.minutes,
      points=excluded.points, sort=excluded.sort`);
  db.transaction(() => list.forEach((a, i) => up.run({
    description: '', edition: 'core', category: null, minutes: 0, ...a, sort: i,
  })))();
  return list.length;
}

export const allActivities = (db) => db.prepare('SELECT * FROM activities ORDER BY sort, id').all();

export const userEditions = (user) => ['core', ...(user?.paws ? ['paws'] : []), ...(user?.kids ? ['kids'] : [])];

// Active activities this member can do at this park: any-park ones plus the park's facilities,
// limited to the editions they turned on.
export function activitiesForPark(db, user, park) {
  const editions = new Set(userEditions(user));
  const cats = new Set(park.categories || []);
  return db.prepare('SELECT * FROM activities WHERE active = 1 ORDER BY sort, id').all()
    .filter((a) => editions.has(a.edition) && (!a.category || cats.has(a.category)));
}

export const visitToday = (db, userId, parkId, today) =>
  db.prepare('SELECT * FROM visits WHERE user_id = ? AND park_id = ? AND visited_on = ?').get(userId, parkId, today);

export const logsForVisit = (db, visitId) => db.prepare(`SELECT l.*, a.slug, a.name FROM activity_logs l
  JOIN activities a ON a.id = l.activity_id WHERE l.visit_id = ? ORDER BY l.id`).all(visitId);

// Parses the amount typed for an activity. Returns a number or null.
export function parseAmount(measure, raw) {
  if (measure === 'check') return 1;
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  if (measure === 'minutes') return Number.isInteger(n) && n <= LIMITS.minutesPerLog ? n : null;
  if (measure === 'count') return Number.isInteger(n) && n <= LIMITS.countPerLog ? n : null;
  if (measure === 'miles') return n <= LIMITS.milesPerLog ? Math.round(n * 10) / 10 || null : null;
  return null;
}

const dayTotals = (db, userId, day) => db.prepare(`SELECT COALESCE(SUM(minutes), 0) AS minutes, COALESCE(SUM(miles), 0) AS miles
  FROM activity_logs WHERE user_id = ? AND logged_on = ?`).get(userId, day);

/**
 * Logs one activity at a park the member stamped today. Returns { log, activity } or { error }.
 * Errors: not_stamped, unknown, bad_amount, miles_cap, duplicate.
 */
export function logActivity(db, { user, park, slug, amount: raw }, { now = new Date() } = {}) {
  const today = localDate(now, parkTimeZone(db, park.id));
  const visit = visitToday(db, user.id, park.id, today);
  if (!visit) return { error: 'not_stamped' };
  const activity = activitiesForPark(db, user, park).find((a) => a.slug === slug);
  if (!activity) return { error: 'unknown' };
  const amount = parseAmount(activity.measure, raw);
  if (amount == null) return { error: 'bad_amount', activity };
  if (db.prepare('SELECT 1 FROM activity_logs WHERE visit_id = ? AND activity_id = ?').get(visit.id, activity.id)) {
    return { error: 'duplicate', activity };
  }
  const day = dayTotals(db, user.id, today);
  const miles = activity.measure === 'miles' ? amount : 0;
  if (miles && day.miles + miles > LIMITS.milesPerDay + 1e-9) return { error: 'miles_cap', activity };
  const rawMinutes = activity.measure === 'minutes' ? amount : activity.measure === 'miles' ? amount * MINUTES_PER_MILE : activity.minutes;
  // Time credited toward weekly goals tops out at the daily cap; the activity still counts.
  const minutes = Math.max(0, Math.min(rawMinutes, LIMITS.minutesPerDay - day.minutes));
  const ts = now.toISOString();
  const log = db.transaction(() => {
    const id = db.prepare(`INSERT INTO activity_logs (user_id, visit_id, activity_id, amount, minutes, miles, logged_on, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, visit.id, activity.id, amount, minutes, miles, today, ts).lastInsertRowid;
    db.prepare(`INSERT INTO point_events (user_id, source_type, source_id, points, reason, created_at)
      VALUES (?, 'activity', ?, ?, ?, ?)`).run(user.id, id, activity.points, activity.name, ts);
    return db.prepare('SELECT * FROM activity_logs WHERE id = ?').get(id);
  })();
  return { log, activity };
}

// Removes one of the member's own logs and its points. Returns the log (with park_id) or null.
export function deleteActivityLog(db, { user, logId }) {
  const log = db.prepare(`SELECT l.*, v.park_id FROM activity_logs l JOIN visits v ON v.id = l.visit_id
    WHERE l.id = ? AND l.user_id = ?`).get(logId, user.id);
  if (!log) return null;
  db.transaction(() => {
    db.prepare("DELETE FROM point_events WHERE source_type = 'activity' AND source_id = ?").run(log.id);
    db.prepare('DELETE FROM activity_logs WHERE id = ?').run(log.id);
  })();
  return log;
}

// Points rows for a visit's activities, removed before the visit (whose logs cascade) is deleted.
export const deleteVisitActivityPoints = (db, visitId) => db.prepare(`DELETE FROM point_events
  WHERE source_type = 'activity' AND source_id IN (SELECT id FROM activity_logs WHERE visit_id = ?)`).run(visitId);

/** This week's (Monday to Sunday, local) totals for the passport. */
export function weekSummary(db, userId, { now = new Date(), timeZone } = {}) {
  const today = dayNumber(localDate(now, timeZone)); // the week of the city being viewed
  const monday = mondayOf(today);
  const rows = db.prepare(`SELECT l.logged_on, l.minutes, l.miles, a.pillar FROM activity_logs l
    JOIN activities a ON a.id = l.activity_id WHERE l.user_id = ?`).all(userId)
    .filter((r) => dayNumber(r.logged_on) >= monday && dayNumber(r.logged_on) <= today);
  const sum = (list, k) => Math.round(list.reduce((s, r) => s + r[k], 0) * 10) / 10;
  return {
    moveMinutes: sum(rows.filter((r) => r.pillar === 'move'), 'minutes'),
    parkMinutes: sum(rows, 'minutes'),
    miles: sum(rows, 'miles'),
    count: rows.length,
    pillars: new Set(rows.map((r) => r.pillar)).size,
  };
}

/** Choices for a badge rule's `target`: [{ value, label }]. */
export function badgeTargets(db) {
  return [
    { value: 'any', label: 'Any activity' },
    ...Object.entries(PILLARS).map(([k, p]) => ({ value: `pillar:${k}`, label: `Pillar: ${p.label}` })),
    { value: 'edition:paws', label: 'Edition: Paws' },
    { value: 'edition:kids', label: 'Edition: Kids' },
    ...allActivities(db).map((a) => ({ value: `activity:${a.slug}`, label: `Activity: ${a.name}` })),
  ];
}

// Admin: switches an activity on or off. Returns the activity or null.
export function setActivityActive(db, id, active) {
  const changed = db.prepare('UPDATE activities SET active = ? WHERE id = ?').run(active ? 1 : 0, id).changes;
  return changed ? db.prepare('SELECT * FROM activities WHERE id = ?').get(id) : null;
}
