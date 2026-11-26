// Nonprofit ads and activity tips (SPEC Flow 25). An ad belongs to a nonprofit (Flow 18) and shows
// in one place: the bottom of park pages, the bottom of the passport page, or as a tip on one
// activity. It's hidden unless switched on and today (in the city's time zone) is between its
// dates. A page shows at most one, picked at random from those that match. Views and clicks are
// counted per ad, park and day: counts only, nothing about who.
import { localDate } from './time.js';
import { areaForPark } from './city.js';
import { CATEGORIES } from './categories.js';

export const PLACEMENTS = {
  park: 'Bottom of park pages',
  passport: 'Bottom of the passport page',
  activity: 'Activity tip (a pop-up on one activity)',
};
export const SCOPES = {
  all: 'Every park',
  categories: 'Parks with these categories',
  areas: 'Parks in these neighborhoods',
  parks: 'These parks',
};
export const AD_LIMITS = { name: 80, title: 80, body: 1200, alt: 160, slides: 5 };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max + 1);
const many = (v) => [].concat(v ?? []).map(String).filter(Boolean);
const validDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** The state an admin sees: Off, Paused (its nonprofit is), Scheduled, Running or Ended (by today's date). */
export function adState(ad, today) {
  if (!ad.active) return 'Off';
  if (ad.nonprofit_status && ad.nonprofit_status !== 'active') return 'Paused';
  if (today < ad.starts_on) return 'Scheduled';
  if (today > ad.ends_on) return 'Ended';
  return 'Running';
}

function validate(db, form) {
  const v = {
    name: one(form.name, AD_LIMITS.name),
    nonprofit_id: Number(form.nonprofit_id) || null,
    placement: String(form.placement ?? ''),
    activity_id: Number(form.activity_id) || null,
    title: one(form.title, AD_LIMITS.title),
    // Tip text keeps its line breaks (paragraphs); runs of spaces are tidied.
    body: String(form.body ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, AD_LIMITS.body + 1),
    starts_on: String(form.starts_on ?? '').trim(),
    ends_on: String(form.ends_on ?? '').trim(),
    active: form.active === '1' ? 1 : 0,
    all_cities: form.all_cities === '0' ? 0 : 1,
    cities: many(form.cities).map(Number).filter(Boolean),
    park_scope: String(form.park_scope ?? 'all'),
    categories: many(form.categories).filter((c) => Object.hasOwn(CATEGORIES, c)),
    areas: many(form.areas).filter((a) => /^\d+:.{1,80}$/.test(a)),
    parks: many(form.parks).map(Number).filter(Boolean),
  };
  const errors = {};
  if (!v.name) errors.name = 'Name this ad (only admins see it).';
  else if (v.name.length > AD_LIMITS.name) errors.name = `Use ${AD_LIMITS.name} characters or fewer.`;
  const np = v.nonprofit_id ? db.prepare('SELECT status FROM nonprofits WHERE id = ?').get(v.nonprofit_id) : null;
  if (!np || np.status === 'suggested') errors.nonprofit_id = 'Choose an approved nonprofit.';
  if (!Object.hasOwn(PLACEMENTS, v.placement)) errors.placement = 'Choose where it shows.';
  if (v.placement === 'activity') {
    if (!v.activity_id || !db.prepare('SELECT 1 FROM activities WHERE id = ?').get(v.activity_id)) errors.activity_id = 'Choose the activity the tip goes with.';
    if (!v.title) errors.title = 'Give the tip a heading.';
    else if (v.title.length > AD_LIMITS.title) errors.title = `Use ${AD_LIMITS.title} characters or fewer.`;
    if (!v.body) errors.body = 'Write the tip.';
    else if (v.body.length > AD_LIMITS.body) errors.body = `Keep it to ${AD_LIMITS.body} characters or fewer.`;
  } else {
    v.activity_id = null;
    v.title = '';
    v.body = '';
  }
  if (!validDate(v.starts_on)) errors.starts_on = 'Choose a start date.';
  if (!validDate(v.ends_on)) errors.ends_on = 'Choose an end date.';
  else if (!errors.starts_on && v.ends_on < v.starts_on) errors.ends_on = 'The end date is before the start date.';
  if (!v.all_cities) {
    const known = new Set(db.prepare('SELECT id FROM city_themes').pluck().all());
    v.cities = v.cities.filter((id) => known.has(id));
    if (!v.cities.length) errors.cities = 'Choose at least one city, or all cities.';
  }
  // The passport page isn't a park: it's targeted by city only.
  if (v.placement === 'passport') v.park_scope = 'all';
  if (!Object.hasOwn(SCOPES, v.park_scope)) errors.park_scope = 'Choose which parks.';
  else if (v.park_scope === 'categories' && !v.categories.length) errors.park_scope = 'Tick at least one category.';
  else if (v.park_scope === 'areas' && !v.areas.length) errors.park_scope = 'Tick at least one neighborhood.';
  else if (v.park_scope === 'parks' && !v.parks.length) errors.park_scope = 'Tick at least one park.';
  return { values: v, errors };
}

/** Creates or updates an ad. Returns { id } or { errors, values }. */
export function saveAd(db, id, form, { now = new Date() } = {}) {
  const { values: v, errors } = validate(db, form);
  if (v.active && !Object.keys(errors).length) {
    const slides = id ? db.prepare('SELECT COUNT(*) FROM ad_slides WHERE ad_id = ?').pluck().get(id) : 0;
    if (!slides) errors.active = 'Add at least one image before switching it on.';
  }
  if (Object.keys(errors).length) return { errors, values: v };
  const at = now.toISOString();
  const row = { ...v, at };
  const saved = db.transaction(() => {
    let adId = id;
    if (adId) {
      db.prepare(`UPDATE ads SET name = @name, nonprofit_id = @nonprofit_id, placement = @placement, activity_id = @activity_id,
        title = @title, body = @body, active = @active, starts_on = @starts_on, ends_on = @ends_on, all_cities = @all_cities,
        park_scope = @park_scope, updated_at = @at WHERE id = @id`).run({ ...row, id: adId });
    } else {
      adId = Number(db.prepare(`INSERT INTO ads (name, nonprofit_id, placement, activity_id, title, body, active, starts_on, ends_on,
        all_cities, park_scope, created_at, updated_at) VALUES (@name, @nonprofit_id, @placement, @activity_id, @title, @body, @active,
        @starts_on, @ends_on, @all_cities, @park_scope, @at, @at)`).run(row).lastInsertRowid);
    }
    db.prepare('DELETE FROM ad_cities WHERE ad_id = ?').run(adId);
    if (!v.all_cities) for (const c of v.cities) db.prepare('INSERT OR IGNORE INTO ad_cities (ad_id, city_id) VALUES (?, ?)').run(adId, c);
    db.prepare('DELETE FROM ad_targets WHERE ad_id = ?').run(adId);
    const kind = { categories: 'category', areas: 'area', parks: 'park' }[v.park_scope];
    if (kind) for (const value of v[v.park_scope]) db.prepare('INSERT OR IGNORE INTO ad_targets (ad_id, kind, value) VALUES (?, ?, ?)').run(adId, kind, String(value));
    return adId;
  })();
  return { id: saved };
}

const slidesOf = (db, adId) => db.prepare('SELECT * FROM ad_slides WHERE ad_id = ? ORDER BY sort, id').all(adId);

/** An ad with its nonprofit, cities, targets and slides; null if there's none. */
export function adById(db, id) {
  const ad = db.prepare(`SELECT a.*, n.name AS nonprofit_name, n.status AS nonprofit_status, ac.name AS activity_name
    FROM ads a JOIN nonprofits n ON n.id = a.nonprofit_id LEFT JOIN activities ac ON ac.id = a.activity_id WHERE a.id = ?`).get(id);
  if (!ad) return null;
  const targets = db.prepare('SELECT kind, value FROM ad_targets WHERE ad_id = ?').all(id);
  const of = (kind) => targets.filter((t) => t.kind === kind).map((t) => t.value);
  return {
    ...ad,
    cities: db.prepare('SELECT city_id FROM ad_cities WHERE ad_id = ?').pluck().all(id),
    categories: of('category'), areas: of('area'), parks: of('park').map(Number),
    slides: slidesOf(db, id),
  };
}

/** Adds a slide (at most AD_LIMITS.slides). Returns { id } or { error }. */
export function addSlide(db, adId, { key, animated, alt }) {
  const text = one(alt, AD_LIMITS.alt);
  if (!text) return { error: 'Describe the image for people who can\'t see it.' };
  if (text.length > AD_LIMITS.alt) return { error: `Keep the description to ${AD_LIMITS.alt} characters or fewer.` };
  const count = db.prepare('SELECT COUNT(*) FROM ad_slides WHERE ad_id = ?').pluck().get(adId);
  if (count >= AD_LIMITS.slides) return { error: `An ad has at most ${AD_LIMITS.slides} images.` };
  const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 FROM ad_slides WHERE ad_id = ?').pluck().get(adId);
  const { lastInsertRowid } = db.prepare('INSERT INTO ad_slides (ad_id, image_key, animated, alt, sort) VALUES (?, ?, ?, ?, ?)')
    .run(adId, key, animated ? 1 : 0, text, sort);
  return { id: Number(lastInsertRowid) };
}

/** Moves a slide one place up (-1) or down (+1). Returns false if it isn't this ad's. */
export function moveSlide(db, adId, slideId, dir) {
  const list = slidesOf(db, adId);
  const i = list.findIndex((s) => s.id === slideId);
  if (i < 0) return false;
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= list.length) return true;
  [list[i], list[j]] = [list[j], list[i]];
  const set = db.prepare('UPDATE ad_slides SET sort = ? WHERE id = ?');
  db.transaction(() => list.forEach((s, n) => set.run(n, s.id)))();
  return true;
}

/**
 * Removes a slide; returns its image key (for the files) or null. The last slide of a switched-on
 * ad switches it off, so a live ad never has no image.
 */
export function removeSlide(db, adId, slideId) {
  const s = db.prepare('SELECT * FROM ad_slides WHERE id = ? AND ad_id = ?').get(slideId, adId);
  if (!s) return null;
  db.transaction(() => {
    db.prepare('DELETE FROM ad_slides WHERE id = ?').run(s.id);
    if (!db.prepare('SELECT COUNT(*) FROM ad_slides WHERE ad_id = ?').pluck().get(adId)) db.prepare('UPDATE ads SET active = 0 WHERE id = ?').run(adId);
  })();
  return s.image_key;
}

/** Deletes an ad and its counts; returns its slides' image keys (for the files), or null. */
export function deleteAd(db, id) {
  const keys = db.prepare('SELECT image_key FROM ad_slides WHERE ad_id = ?').pluck().all(id);
  return db.prepare('DELETE FROM ads WHERE id = ?').run(id).changes ? keys : null;
}

// ---------- Matching ----------

/** Switched-on ads for a placement and city that are within their dates today (city time). */
function liveAds(db, placement, theme, now) {
  const today = localDate(now, theme.time_zone);
  return db.prepare(`SELECT a.*, n.name AS nonprofit_name FROM ads a JOIN nonprofits n ON n.id = a.nonprofit_id
    WHERE a.placement = ? AND a.active = 1 AND a.starts_on <= ? AND a.ends_on >= ? AND n.status = 'active'
      AND EXISTS (SELECT 1 FROM ad_slides s WHERE s.ad_id = a.id)
      AND (a.all_cities = 1 OR EXISTS (SELECT 1 FROM ad_cities c WHERE c.ad_id = a.id AND c.city_id = ?))
    ORDER BY a.id`).all(placement, today, today, theme.id);
}

/** Whether an ad's park choice includes this park (its categories, neighborhood or the park itself). */
function parkMatches(db, ad, park, theme) {
  if (ad.park_scope === 'all') return true;
  const targets = db.prepare('SELECT value FROM ad_targets WHERE ad_id = ?').pluck().all(ad.id);
  if (ad.park_scope === 'parks') return targets.includes(String(park.id));
  if (ad.park_scope === 'categories') {
    const mine = db.prepare('SELECT category FROM park_categories WHERE park_id = ?').pluck().all(park.id);
    return mine.some((c) => targets.includes(c));
  }
  const area = areaForPark(theme, park);
  return Boolean(area) && targets.includes(`${park.city_id}:${area.name}`);
}

const withSlides = (db, ad) => (ad ? { ...ad, slides: slidesOf(db, ad.id) } : null);
const pickOne = (list, random) => (list.length ? list[Math.floor(random() * list.length) % list.length] : null);

/** The one ad for the bottom of a park page (random among matches), or null. */
export function adForPark(db, park, theme, { now = new Date(), random = Math.random } = {}) {
  return withSlides(db, pickOne(liveAds(db, 'park', theme, now).filter((a) => parkMatches(db, a, park, theme)), random));
}

/** The one ad for the bottom of the passport page in this city, or null. */
export function adForPassport(db, theme, { now = new Date(), random = Math.random } = {}) {
  return withSlides(db, pickOne(liveAds(db, 'passport', theme, now), random));
}

/** Activity tips for a park: Map(activity id → tip ad), one per activity (random among matches). */
export function tipsFor(db, park, theme, { now = new Date(), random = Math.random } = {}) {
  const byActivity = new Map();
  for (const a of liveAds(db, 'activity', theme, now).filter((ad) => parkMatches(db, ad, park, theme))) {
    byActivity.set(a.activity_id, [...(byActivity.get(a.activity_id) || []), a]);
  }
  return new Map([...byActivity].map(([id, list]) => [id, withSlides(db, pickOne(list, random))]));
}

/** Whether this ad can show here right now: a park (park pages, tips) or a city's passport (park null). */
export function adShowsAt(db, ad, { park = null, theme, now = new Date() }) {
  if (!ad || !theme) return false;
  if ((ad.placement === 'passport') !== !park) return false;
  if (park && park.city_id !== theme.id) return false;
  return liveAds(db, ad.placement, theme, now).some((a) => a.id === ad.id && (!park || parkMatches(db, a, park, theme)));
}

// ---------- Counts ----------

const dayOf = (now) => now.toISOString().slice(0, 10);
const bump = (column) => (db, adId, parkId, { now = new Date() } = {}) => db.prepare(`INSERT INTO ad_stats (ad_id, park_id, day, ${column})
  VALUES (?, ?, ?, 1) ON CONFLICT (ad_id, park_id, day) DO UPDATE SET ${column} = ${column} + 1`).run(adId, parkId || 0, dayOf(now));
export const recordAdView = bump('views');
export const recordAdClick = bump('clicks');

/** Admin list: every ad with its state and views · clicks (all time and the last 30 days). */
export function adsForAdmin(db, { now = new Date(), timeZone } = {}) {
  const since = dayOf(new Date(now.getTime() - 29 * 86400e3));
  const today = localDate(now, timeZone);
  const sum = (col, recent) => `COALESCE((SELECT SUM(${col}) FROM ad_stats s WHERE s.ad_id = a.id${recent ? ' AND s.day >= @since' : ''}), 0)`;
  return db.prepare(`SELECT a.*, n.name AS nonprofit_name, n.status AS nonprofit_status, ac.name AS activity_name,
      (SELECT COUNT(*) FROM ad_slides s WHERE s.ad_id = a.id) AS slide_count,
      (SELECT image_key FROM ad_slides s WHERE s.ad_id = a.id ORDER BY sort, id LIMIT 1) AS first_key,
      (SELECT GROUP_CONCAT(c.name, ', ') FROM ad_cities x JOIN city_themes c ON c.id = x.city_id WHERE x.ad_id = a.id) AS city_names,
      ${sum('views')} AS views, ${sum('clicks')} AS clicks, ${sum('views', true)} AS views_30, ${sum('clicks', true)} AS clicks_30
    FROM ads a JOIN nonprofits n ON n.id = a.nonprofit_id LEFT JOIN activities ac ON ac.id = a.activity_id
    ORDER BY a.active DESC, a.ends_on DESC, a.id DESC`).all({ since }).map((a) => ({ ...a, state: adState(a, today) }));
}
