// Nonprofit spotlights (SPEC Flow 18): local nonprofits that care for a park or its waterways,
// 1% for the Planet nonprofit partners, and other local nonprofits an admin approves. One small
// card per park page. The busiest park pages send the most people to them, so views and clicks
// are counted per park and day (counts only, nothing about who).

export const REASONS = {
  steward: 'Cares for this park',
  one_percent: '1% for the Planet partner',
  local: 'Local nonprofit',
};
export const STATUSES = { suggested: 'Suggested', active: 'Active', paused: 'Paused' };
export const SUGGEST_DAILY_LIMIT = 5;
const LIMITS = { name: 80, mission: 160, serves: 300 };

const one = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max + 1);
const dayOf = (now) => now.toISOString().slice(0, 10);

/** A clean https URL or null. */
export function cleanUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return null;
  return u.href.slice(0, 300);
}

function validate(form, { needsServes = false } = {}) {
  const values = {
    name: one(form.name, LIMITS.name), url: String(form.url ?? '').trim(), mission: one(form.mission, LIMITS.mission),
    reason: String(form.reason ?? ''), serves: one(form.serves, LIMITS.serves),
  };
  const errors = {};
  if (!values.name) errors.name = 'Enter the nonprofit\'s name.';
  else if (values.name.length > LIMITS.name) errors.name = `Use ${LIMITS.name} characters or fewer.`;
  const url = cleanUrl(values.url);
  if (!url) errors.url = 'Enter its website, starting with https://';
  if (!values.mission) errors.mission = 'Say what it does in one sentence.';
  else if (values.mission.length > LIMITS.mission) errors.mission = `Keep it to ${LIMITS.mission} characters or fewer.`;
  if (!Object.hasOwn(REASONS, values.reason)) errors.reason = 'Choose why it belongs here.';
  if (needsServes && !values.serves) errors.serves = 'Say which parks or waterways it looks after.';
  else if (values.serves.length > LIMITS.serves) errors.serves = `Keep it to ${LIMITS.serves} characters or fewer.`;
  return { values: { ...values, url: url || values.url }, errors };
}

/** A member suggests a nonprofit for a city. Returns { id } or { errors, values }. */
export function suggestNonprofit(db, user, cityId, form, { now = new Date() } = {}) {
  const { values, errors } = validate(form, { needsServes: true });
  const since = new Date(now.getTime() - 86400e3).toISOString();
  if (!Object.keys(errors).length
    && db.prepare('SELECT COUNT(*) FROM nonprofits WHERE suggested_by = ? AND created_at > ?').pluck().get(user.id, since) >= SUGGEST_DAILY_LIMIT) {
    errors.form = `That's ${SUGGEST_DAILY_LIMIT} suggestions today. Thank you! Send more tomorrow.`;
  }
  if (Object.keys(errors).length) return { errors, values };
  const ts = now.toISOString();
  const id = Number(db.prepare(`INSERT INTO nonprofits (name, url, mission, reason, city_id, serves, suggested_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(values.name, values.url, values.mission, values.reason, cityId, values.serves, user.id, ts, ts).lastInsertRowid);
  return { id };
}

/** Admin save (new when id is null). parkIds must be parks in the chosen city. Returns { id } or { errors, values }. */
export function saveNonprofit(db, id, form, { now = new Date(), logo } = {}) {
  const { values, errors } = validate(form);
  const cityId = Number(form.city_id);
  if (!db.prepare('SELECT 1 FROM city_themes WHERE id = ?').get(cityId)) errors.city_id = 'Choose a city.';
  const status = Object.hasOwn(STATUSES, form.status) ? form.status : 'active';
  const parkIds = [].concat(form.parks || []).map(Number).filter((n) => Number.isInteger(n));
  const valid = new Set(db.prepare('SELECT id FROM parks WHERE city_id = ?').pluck().all(cityId));
  if (parkIds.some((p) => !valid.has(p))) errors.parks = 'Choose parks in this nonprofit\'s city.';
  if (Object.keys(errors).length) return { errors, values: { ...values, city_id: cityId, status, parks: parkIds } };
  const ts = now.toISOString();
  return db.transaction(() => {
    let npId = id;
    if (id) {
      // `serves` (the suggester's own words) is kept: the admin form doesn't edit it.
      db.prepare(`UPDATE nonprofits SET name = ?, url = ?, mission = ?, reason = ?, city_id = ?, status = ?, updated_at = ?
        ${logo !== undefined ? ', logo = ?' : ''} WHERE id = ?`).run(...[values.name, values.url, values.mission, values.reason, cityId, status,
        ts, ...(logo !== undefined ? [logo] : []), id]);
    } else {
      npId = Number(db.prepare(`INSERT INTO nonprofits (name, url, mission, reason, status, city_id, serves, logo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(values.name, values.url, values.mission, values.reason, status, cityId, values.serves,
        logo ?? null, ts, ts).lastInsertRowid);
    }
    db.prepare('DELETE FROM nonprofit_parks WHERE nonprofit_id = ?').run(npId);
    const add = db.prepare('INSERT INTO nonprofit_parks (nonprofit_id, park_id) VALUES (?, ?)');
    for (const p of new Set(parkIds)) add.run(npId, p);
    return { id: npId };
  })();
}

export const nonprofitById = (db, id) => {
  const np = db.prepare('SELECT * FROM nonprofits WHERE id = ?').get(id);
  if (np) np.parks = db.prepare('SELECT park_id FROM nonprofit_parks WHERE nonprofit_id = ?').pluck().all(id);
  return np || null;
};

export const deleteNonprofit = (db, id) => db.prepare('DELETE FROM nonprofits WHERE id = ?').run(id).changes > 0;

/**
 * The one spotlight for a park page: active ones chosen for this park win over city-wide ones
 * (active, no parks chosen) in its city. Several at the same level rotate by day.
 */
export function spotlightFor(db, park, { now = new Date() } = {}) {
  const forPark = db.prepare(`SELECT n.* FROM nonprofits n JOIN nonprofit_parks np ON np.nonprofit_id = n.id
    WHERE np.park_id = ? AND n.status = 'active' ORDER BY n.id`).all(park.id);
  const pool = forPark.length ? forPark : db.prepare(`SELECT n.* FROM nonprofits n WHERE n.city_id = ? AND n.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM nonprofit_parks np WHERE np.nonprofit_id = n.id) ORDER BY n.id`).all(park.city_id);
  if (!pool.length) return null;
  const day = Math.floor(now.getTime() / 86400e3);
  return pool[day % pool.length];
}

/** Whether this spotlight can show on this park (its own parks, or every park in its city). */
export function showsOn(db, nonprofit, parkId) {
  const parks = db.prepare('SELECT park_id FROM nonprofit_parks WHERE nonprofit_id = ?').pluck().all(nonprofit.id);
  if (parks.length) return parks.includes(parkId);
  return Boolean(db.prepare('SELECT 1 FROM parks WHERE id = ? AND city_id = ?').get(parkId, nonprofit.city_id));
}

/** Crawlers and link previews: not counted as views or clicks. */
export const isBot = (userAgent) => !userAgent || /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless/i.test(String(userAgent));

const bump = (column) => (db, nonprofitId, parkId, { now = new Date() } = {}) => db.prepare(`INSERT INTO nonprofit_stats (nonprofit_id, park_id, day, ${column})
  VALUES (?, ?, ?, 1) ON CONFLICT (nonprofit_id, park_id, day) DO UPDATE SET ${column} = ${column} + 1`).run(nonprofitId, parkId, dayOf(now));
export const recordView = bump('views');
export const recordClick = bump('clicks');

/** Admin list with totals (all time and the last 30 days) and the top 3 parks by views. */
export function nonprofitsForAdmin(db, { status = '', now = new Date() } = {}) {
  const since = dayOf(new Date(now.getTime() - 29 * 86400e3));
  const rows = db.prepare(`SELECT n.*, c.name AS city_name, u.display_name AS suggester,
      (SELECT COUNT(*) FROM nonprofit_parks np WHERE np.nonprofit_id = n.id) AS park_count,
      COALESCE((SELECT SUM(views) FROM nonprofit_stats s WHERE s.nonprofit_id = n.id), 0) AS views,
      COALESCE((SELECT SUM(clicks) FROM nonprofit_stats s WHERE s.nonprofit_id = n.id), 0) AS clicks,
      COALESCE((SELECT SUM(views) FROM nonprofit_stats s WHERE s.nonprofit_id = n.id AND s.day >= ?), 0) AS views_30,
      COALESCE((SELECT SUM(clicks) FROM nonprofit_stats s WHERE s.nonprofit_id = n.id AND s.day >= ?), 0) AS clicks_30
    FROM nonprofits n JOIN city_themes c ON c.id = n.city_id LEFT JOIN users u ON u.id = n.suggested_by
    ${Object.hasOwn(STATUSES, status) ? 'WHERE n.status = ?' : ''} ORDER BY n.status = 'suggested' DESC, n.updated_at DESC, n.id DESC`)
    .all(since, since, ...(Object.hasOwn(STATUSES, status) ? [status] : []));
  const top = db.prepare(`SELECT p.name, SUM(s.views) AS views, SUM(s.clicks) AS clicks FROM nonprofit_stats s JOIN parks p ON p.id = s.park_id
    WHERE s.nonprofit_id = ? GROUP BY s.park_id ORDER BY views DESC, clicks DESC LIMIT 3`);
  return rows.map((r) => ({ ...r, topParks: top.all(r.id) }));
}

export const nonprofitCounts = (db) => Object.fromEntries(Object.keys(STATUSES).map((s) => [s, 0])
  .concat(db.prepare('SELECT status, COUNT(*) FROM nonprofits GROUP BY status').raw().all()));
