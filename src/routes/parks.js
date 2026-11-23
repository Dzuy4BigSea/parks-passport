import { listParks, getParkBySlug, countActiveParks, categoriesInUse, cleanCategories } from '../domain/parks.js';
import { parseLatLng } from '../domain/geo.js';
import { stampedParkIds, visitsAtPark } from '../domain/visits.js';
import { localDate } from '../domain/time.js';
import { parksPage } from '../views/pages/parks.js';
import { parkPage } from '../views/pages/park.js';

export default async function parkRoutes(app) {
  const { db } = app;

  app.get('/parks', async (req, reply) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const selected = cleanCategories(req.query.cat);
    const near = parseLatLng(req.query.lat, req.query.lng);
    const stamped = req.user ? stampedParkIds(db, req.user.id) : null;
    const unvisited = Boolean(req.user) && req.query.unvisited === '1';
    let parks = listParks(db, { q, categories: selected, near });
    if (unvisited) parks = parks.filter((p) => !stamped.has(p.id));
    return reply.page(parksPage({
      parks, total: countActiveParks(db), q, selected, near, unvisited, stamped,
      categories: categoriesInUse(db), signedIn: Boolean(req.user),
    }));
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
    return reply.page(parkPage({
      park, user, csrf: req.csrfToken(), today: localDate(app.now()),
      myVisits: user ? visitsAtPark(db, user.id, park.id) : [], stamped,
    }));
  });
}
