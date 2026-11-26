import { listParks, countActiveParks, categoriesInUse, cleanCategories, parkCardExtras } from '../domain/parks.js';
import { recordMilestone, isNight } from '../domain/milestones.js';
import { parseLatLng } from '../domain/geo.js';
import { stampedParkIds } from '../domain/visits.js';
import { palsWhoStamped } from '../domain/pals.js';
import { parksPage } from '../views/pages/parks.js';
import { cityPath, parkPath } from '../views/urls.js';
import { renderParkPage } from './park-view.js';
import { urlCity, urlPark, movedParkPath, queryOf } from './city-params.js';
import { safeNext } from '../lib/auth.js';
import { savedParkIds, setSaved } from '../domain/saved.js';

export default async function parkRoutes(app) {
  const { db } = app;

  // Before multi-city, parks lived at /parks and /parks/:slug. Those links keep working.
  app.get('/parks', async (req, reply) => reply.redirect(cityPath(req.city, '/parks') + queryOf(req)));
  app.get('/parks/:slug', async (req, reply) => {
    const to = movedParkPath(db, req, req.params.slug);
    return to ? reply.redirect(to + queryOf(req), 301) : reply.callNotFound();
  });

  app.get('/:city/parks', async (req, reply) => {
    const city = urlCity(req);
    if (!city) return reply.callNotFound();
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const selected = cleanCategories(req.query.cat);
    const near = parseLatLng(req.query.lat, req.query.lng);
    const stamped = req.user ? stampedParkIds(db, req.user.id) : null;
    const unvisited = Boolean(req.user) && req.query.unvisited === '1';
    const palsOnly = Boolean(req.user) && req.query.pals === '1';
    // "Want to go" marks and filter: the viewer's own saved parks only.
    const saved = req.user ? savedParkIds(db, req.user.id) : null;
    const onlySaved = Boolean(req.user) && req.query.saved === '1';
    if (req.user && req.method === 'GET' && isNight(app.now(), city.time_zone)) recordMilestone(db, req.user.id, 'night_plan', { now: app.now(), random: app.random });
    let parks = listParks(db, { cityId: city.id, q, categories: selected, near });
    // Pals who stamped each park (only pals who share their passport).
    const palsHere = req.user ? palsWhoStamped(db, req.user.id, parks.map((p) => p.id)) : null;
    const hasPals = Boolean(req.user) && Boolean(db.prepare('SELECT 1 FROM pal_links WHERE user_a = ? OR user_b = ? LIMIT 1').get(req.user.id, req.user.id));
    if (unvisited) parks = parks.filter((p) => !stamped.has(p.id));
    if (palsOnly) parks = parks.filter((p) => palsHere.has(p.id));
    if (onlySaved) parks = parks.filter((p) => saved.has(p.id));
    const filterCount = selected.length + (unvisited ? 1 : 0) + (palsOnly ? 1 : 0) + (onlySaved ? 1 : 0);
    const events = q || filterCount ? [['park_search', { has_query: Boolean(q), filter_count: filterCount }]] : [];
    // First-visit dates for the postmarks on stamped cards (the member's own data).
    const stampDates = req.user ? new Map(db.prepare('SELECT park_id, MIN(visited_on) FROM visits WHERE user_id = ? GROUP BY park_id')
      .raw().all(req.user.id)) : null;
    return reply.page({ events, ...parksPage({
      parks, total: countActiveParks(db, city.id), q, selected, near, unvisited, stamped, stampDates,
      extras: parkCardExtras(db, parks.map((p) => p.id)),
      categories: categoriesInUse(db, city.id), signedIn: Boolean(req.user), theme: city, palsHere, palsOnly, hasPals,
      saved, onlySaved, csrf: req.csrfToken(), back: req.url,
    }) });
  });

  // "Want to go" heart. Sets the state sent (saved=1|0) rather than toggling. The JS enhancement
  // asks for JSON; without JS it redirects back to the page the form was on.
  app.post('/:city/parks/:slug/save', async (req, reply) => {
    const park = urlPark(db, req);
    if (!park || !park.active) return reply.callNotFound();
    // Signed out: log in and come back to the park page (a GET of this URL would be a 404).
    if (!req.user) return reply.redirect(`/login?next=${encodeURIComponent(parkPath(park))}`, 303);
    const saved = req.body.saved === '1';
    setSaved(db, req.user.id, park.id, saved, { now: app.now() });
    if (String(req.headers.accept || '').includes('application/json')) return reply.send({ saved });
    const back = typeof req.body.back === 'string' && req.body.back ? safeNext(req.body.back) : parkPath(park);
    return reply.redirect(back, 303);
  });

  app.get('/:city/parks/:slug', async (req, reply) => {
    const park = urlPark(db, req);
    if (!park) return reply.callNotFound();
    const user = req.user;
    // Surprise badges: the first park page opened, and late-night trip planning.
    if (user && req.method === 'GET') {
      const opts = { now: app.now(), random: app.random };
      recordMilestone(db, user.id, 'park_view', opts);
      if (isNight(app.now(), req.city.time_zone)) recordMilestone(db, user.id, 'night_plan', opts);
    }
    let stamped = null;
    if (user && /^\d+$/.test(String(req.query.stamped || ''))) {
      const visit = db.prepare('SELECT * FROM visits WHERE id = ? AND user_id = ? AND park_id = ?')
        .get(Number(req.query.stamped), user.id, park.id);
      if (visit) {
        const parts = db.prepare(`SELECT reason, points FROM point_events
          WHERE source_type = 'visit' AND source_id = ? ORDER BY id`).all(visit.id);
        stamped = { visit, parts };
      }
    }
    const photos = Math.min(Number.parseInt(req.query.count, 10) || 1, 10);
    const flash = { added: photos > 1 ? `${photos} photos added.` : 'Photo added.' }[req.query.photo] || (req.query.rated ? 'Rating saved.' : null);
    // After an undo: no message, but the activity's group stays open.
    let activityFlash = /^[a-z0-9-]{1,60}$/.test(String(req.query.undone || '')) ? { slug: req.query.undone } : null;
    if (user && /^\d+$/.test(String(req.query.logged || ''))) {
      const logged = db.prepare(`SELECT a.slug, a.name, a.points FROM activity_logs l JOIN activities a ON a.id = l.activity_id
        WHERE l.id = ? AND l.user_id = ?`).get(Number(req.query.logged), user.id);
      if (logged) activityFlash = { text: `Logged ${logged.name}: +${logged.points} points.`, slug: logged.slug };
    }
    return renderParkPage(app, req, reply, park, { stamped, flash, activityFlash, events: [['park_view', { park_slug: park.slug }]] });
  });
}
