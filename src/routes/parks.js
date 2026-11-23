import { listParks, getParkBySlug, countActiveParks, categoriesInUse, cleanCategories } from '../domain/parks.js';
import { parseLatLng } from '../domain/geo.js';
import { parksPage } from '../views/pages/parks.js';
import { parkPage } from '../views/pages/park.js';

export default async function parkRoutes(app) {
  app.get('/parks', async (req, reply) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const selected = cleanCategories(req.query.cat);
    const near = parseLatLng(req.query.lat, req.query.lng);
    const parks = listParks(app.db, { q, categories: selected, near });
    return reply.page(parksPage({
      parks, total: countActiveParks(app.db), q, selected, near, categories: categoriesInUse(app.db),
    }));
  });

  app.get('/parks/:slug', async (req, reply) => {
    const park = getParkBySlug(app.db, req.params.slug);
    if (!park) return reply.callNotFound();
    return reply.page(parkPage({ park }));
  });
}
