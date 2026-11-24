import { listParks, getParkBySlug, countActiveParks, categoriesInUse, cleanCategories } from '../domain/parks.js';
import { parseLatLng } from '../domain/geo.js';
import { stampedParkIds } from '../domain/visits.js';
import { parksPage } from '../views/pages/parks.js';
import { renderParkPage } from './park-view.js';
import { safeNext } from '../lib/auth.js';
import { savedParkIds, setSaved } from '../domain/saved.js';

export default async function parkRoutes(app) {
  const { db } = app;

  app.get('/parks', async (req, reply) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const selected = cleanCategories(req.query.cat);
    const near = parseLatLng(req.query.lat, req.query.lng);
    const stamped = req.user ? stampedParkIds(db, req.user.id) : null;
    const unvisited = Boolean(req.user) && req.query.unvisited === '1';
    // "Want to go" marks and filter: the viewer's own saved parks only.
    const saved = req.user ? savedParkIds(db, req.user.id) : null;
    const onlySaved = Boolean(req.user) && req.query.saved === '1';
    let parks = listParks(db, { q, categories: selected, near });
    if (unvisited) parks = parks.filter((p) => !stamped.has(p.id));
    if (onlySaved) parks = parks.filter((p) => saved.has(p.id));
    const filterCount = selected.length + (unvisited ? 1 : 0) + (onlySaved ? 1 : 0);
    const events = q || filterCount ? [['park_search', { has_query: Boolean(q), filter_count: filterCount }]] : [];
    return reply.page({ events, ...parksPage({
      parks, total: countActiveParks(db), q, selected, near, unvisited, stamped, saved, onlySaved, csrf: req.csrfToken(), back: req.url,
      categories: categoriesInUse(db), signedIn: Boolean(req.user), theme: app.theme(),
    }) });
  });

  // "Want to go" heart. Sets the state sent (saved=1|0) rather than toggling. The JS enhancement
  // asks for JSON; without JS it redirects back to the page the form was on.
  app.post('/parks/:slug/save', async (req, reply) => {
    const park = getParkBySlug(db, req.params.slug);
    if (!park) return reply.callNotFound();
    // Signed out: log in and come back to the park page (a GET of this URL would be a 404).
    if (!req.user) return reply.redirect(`/login?next=${encodeURIComponent(`/parks/${park.slug}`)}`, 303);
    const saved = req.body.saved === '1';
    setSaved(db, req.user.id, park.id, saved, { now: app.now() });
    if (String(req.headers.accept || '').includes('application/json')) return reply.send({ saved });
    const back = typeof req.body.back === 'string' && req.body.back ? safeNext(req.body.back) : `/parks/${park.slug}`;
    return reply.redirect(back, 303);
  });

  app.get('/parks/:slug', async (req, reply) => {
    const park = getParkBySlug(db, req.params.slug);
    if (!park) return reply.callNotFound();
    const user = req.user;
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
    const flash = { added: 'Photo added.' }[req.query.photo] || (req.query.rated ? 'Rating saved.' : null);
    return renderParkPage(app, req, reply, park, { stamped, flash, events: [['park_view', { park_slug: park.slug }]] });
  });
}
