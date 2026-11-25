// Admin › Stats (SPEC Flow 9): internal counts from data the app already keeps. Counts only:
// never names, emails, coordinates or anything about one member. Check-ins are counted when they
// were made (visits.created_at, UTC days), so a backdated stamp counts on the day it was entered.

const DAY = 86400000;
const isoDay = (d) => d.toISOString().slice(0, 10);

export function adminStats(db, { now = new Date() } = {}) {
  const ago = (days) => new Date(now.getTime() - days * DAY).toISOString();
  const one = (sql, ...a) => db.prepare(sql).pluck().get(...a) ?? 0;

  const totals = {
    members: one('SELECT COUNT(*) FROM users'),
    newMembers7: one('SELECT COUNT(*) FROM users WHERE created_at >= ?', ago(7)),
    newMembers30: one('SELECT COUNT(*) FROM users WHERE created_at >= ?', ago(30)),
    // Active: stamped a park (any method) in the window.
    active7: one('SELECT COUNT(DISTINCT user_id) FROM visits WHERE created_at >= ?', ago(7)),
    active30: one('SELECT COUNT(DISTINCT user_id) FROM visits WHERE created_at >= ?', ago(30)),
    checkins: one('SELECT COUNT(*) FROM visits'),
    checkins7: one('SELECT COUNT(*) FROM visits WHERE created_at >= ?', ago(7)),
    checkins30: one('SELECT COUNT(*) FROM visits WHERE created_at >= ?', ago(30)),
    stampers: one('SELECT COUNT(DISTINCT user_id) FROM visits'),
    palLinks: one('SELECT COUNT(*) FROM pal_links'),
    photos: one('SELECT COUNT(*) FROM photos'),
    ratings: one('SELECT COUNT(*) FROM ratings'),
    activities: one('SELECT COUNT(*) FROM activity_logs'),
    badgesEarned: one('SELECT COUNT(*) FROM user_badges'),
  };

  // The last 14 days, oldest first, including days with none.
  const dayCounts = new Map(db.prepare(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) FROM visits
    WHERE created_at >= ? GROUP BY day`).raw().all(ago(14)));
  const days = Array.from({ length: 14 }, (_, i) => {
    const day = isoDay(new Date(now.getTime() - (13 - i) * DAY));
    return { day, checkins: dayCounts.get(day) || 0 };
  });

  // The last 12 weeks (Monday starts, UTC), oldest first: check-ins and new members.
  const monday = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
  const thisMonday = monday(now);
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(thisMonday.getTime() - (11 - i) * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    return {
      week: isoDay(start),
      checkins: one('SELECT COUNT(*) FROM visits WHERE created_at >= ? AND created_at < ?', start.toISOString(), end.toISOString()),
      members: one('SELECT COUNT(*) FROM users WHERE created_at >= ? AND created_at < ?', start.toISOString(), end.toISOString()),
    };
  });

  const byCity = db.prepare(`SELECT c.name AS city, COUNT(v.id) AS checkins, COUNT(DISTINCT v.user_id) AS members,
      COUNT(DISTINCT v.park_id) AS parks, (SELECT COUNT(*) FROM parks p2 WHERE p2.city_id = c.id AND p2.active = 1) AS total_parks,
      SUM(CASE WHEN v.created_at >= ? THEN 1 ELSE 0 END) AS checkins30
    FROM city_themes c LEFT JOIN parks p ON p.city_id = c.id LEFT JOIN visits v ON v.park_id = p.id
    WHERE c.active = 1 GROUP BY c.id ORDER BY c.sort, c.id`).all(ago(30));

  const byMethod = db.prepare(`SELECT method, COUNT(*) AS checkins, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS checkins30
    FROM visits GROUP BY method ORDER BY checkins DESC`).all(ago(30));

  const topParks = db.prepare(`SELECT p.name, c.name AS city, COUNT(*) AS checkins, COUNT(DISTINCT v.user_id) AS members
    FROM visits v JOIN parks p ON p.id = v.park_id JOIN city_themes c ON c.id = p.city_id
    WHERE v.created_at >= ? GROUP BY p.id ORDER BY checkins DESC, p.name LIMIT 10`).all(ago(30));

  return { totals, days, weeks, byCity, byMethod, topParks };
}
