// Drops of Sunshine (SPEC Flow 17): a quick thank-you to the people who look after a park, or to the
// whole parks department. The park is chosen for the member (the park page's, else their latest
// stamp in this city; the browser may pick the closest one by GPS, which never leaves the device).
// Notes wait for admin review.

export const MAX_LENGTH = 500;
export const DAILY_LIMIT = 10;
export const STATUSES = { new: 'New', approved: 'Approved', hidden: 'Hidden' };
export const DEPARTMENT = 'department'; // the form value for "the whole parks department"

/** Active parks in a city for the picker (and the browser's nearest-park choice), A–Z. */
export const sunshineParks = (db, cityId) => db.prepare(`SELECT id, slug, name, lat, lng FROM parks
  WHERE city_id = ? AND active = 1 ORDER BY name COLLATE NOCASE`).all(cityId);

/** The park to suggest: the one asked for (by slug), else the latest stamped park in this city, else null. */
export function defaultSunshinePark(db, userId, cityId, slug = '') {
  if (slug) {
    const p = db.prepare('SELECT id, slug, name FROM parks WHERE city_id = ? AND slug = ? AND active = 1').get(cityId, String(slug));
    if (p) return p;
  }
  return db.prepare(`SELECT p.id, p.slug, p.name FROM visits v JOIN parks p ON p.id = v.park_id
    WHERE v.user_id = ? AND p.city_id = ? AND p.active = 1 ORDER BY v.visited_on DESC, v.id DESC LIMIT 1`).get(userId, cityId) || null;
}

/**
 * Saves a note. form.park is a park slug in this city or 'department'. Returns { note } or
 * { error, values }.
 */
export function sendSunshine(db, user, cityId, form, { now = new Date() } = {}) {
  const values = { text: String(form.text ?? '').replace(/\r\n?/g, '\n').trim(), park: String(form.park ?? '') };
  if (!values.text) return { error: 'Write a few words of thanks first.', values };
  if (values.text.length > MAX_LENGTH) return { error: `Keep it to ${MAX_LENGTH} characters or fewer.`, values };
  let parkId = null;
  if (values.park !== DEPARTMENT) {
    const park = db.prepare('SELECT id FROM parks WHERE city_id = ? AND slug = ? AND active = 1').get(cityId, values.park);
    if (!park) return { error: 'Choose a park, or the whole parks department.', values };
    parkId = park.id;
  }
  const since = new Date(now.getTime() - 86400e3).toISOString();
  if (db.prepare('SELECT COUNT(*) FROM sunshine_notes WHERE user_id = ? AND created_at > ?').pluck().get(user.id, since) >= DAILY_LIMIT) {
    return { error: "That's a lot of sunshine for one day. Thank you! Send more tomorrow.", values };
  }
  const id = Number(db.prepare('INSERT INTO sunshine_notes (user_id, city_id, park_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, cityId, parkId, values.text, now.toISOString()).lastInsertRowid);
  return { note: { id, parkId } };
}

/** Admin review list, newest first. */
export function sunshineForAdmin(db, { status = 'new', cityId = null } = {}) {
  return db.prepare(`SELECT n.*, u.display_name, u.handle, p.name AS park_name, c.name AS city_name FROM sunshine_notes n
    JOIN users u ON u.id = n.user_id JOIN city_themes c ON c.id = n.city_id LEFT JOIN parks p ON p.id = n.park_id
    WHERE n.status = ? AND (? IS NULL OR n.city_id = ?) ORDER BY n.created_at DESC, n.id DESC LIMIT 300`).all(status, cityId, cityId);
}

export const sunshineCounts = (db) => Object.fromEntries(Object.keys(STATUSES).map((s) => [s, 0])
  .concat(db.prepare('SELECT status, COUNT(*) FROM sunshine_notes GROUP BY status').raw().all()));

export const setSunshineStatus = (db, id, status, { now = new Date() } = {}) => Object.hasOwn(STATUSES, status)
  && db.prepare('UPDATE sunshine_notes SET status = ?, reviewed_at = ? WHERE id = ?').run(status, now.toISOString(), id).changes > 0;
