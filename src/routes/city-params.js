import { getParkBySlug, parksWithSlug } from '../domain/parks.js';
import { parkPath } from '../views/urls.js';

// Route helpers for /:city/... URLs. lib/city-context.js has already set req.city from the first
// path segment; req.cityFromUrl is false when that segment isn't a city (then: 404).

/** The city in the URL, or null (the route should 404). */
export const urlCity = (req) => (req.cityFromUrl ? req.city : null);

/** The active park in the URL's city with req.params.slug, or null (404). */
export function urlPark(db, req) {
  const city = urlCity(req);
  return city ? getParkBySlug(db, city.id, req.params.slug) : null;
}

/**
 * Where an old, city-less park URL (/parks/:slug...) lives now: the park with that slug in the
 * visitor's current city, else the first city that has it. Null when no city does.
 */
export function movedParkPath(db, req, slug, suffix = '') {
  const parks = parksWithSlug(db, slug);
  const park = parks.find((p) => p.city_key === req.city.key) || parks[0];
  return park ? parkPath(park, suffix) : null;
}

/** The query string of a request (with its "?"), or "" — for redirects that keep it. */
export const queryOf = (req) => {
  const i = req.url.indexOf('?');
  return i < 0 ? '' : req.url.slice(i);
};
