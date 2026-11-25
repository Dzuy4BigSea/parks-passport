import { requireUser } from '../lib/auth.js';
import { getParkById } from '../domain/parks.js';
import { parkTimeZone } from '../domain/city.js';
import { parkPath } from '../views/urls.js';
import { urlPark } from './city-params.js';
import { parsePosition, evaluateCheckin } from '../domain/checkin.js';
import { distanceMeters } from '../domain/geo.js';
import { stampFinderPage } from '../views/pages/stamp.js';
import { stampVisit, deleteVisit, getVisit } from '../domain/visits.js';
import { withUploads } from '../lib/uploads.js';
import { awardBadges, revokeUnmetBadges } from '../domain/badges/index.js';
import { palsAtParkOnDay } from '../domain/pals.js';
import { formatMiles } from '../domain/geo.js';
import { formatDate, localDate } from '../domain/time.js';
import { storePhoto, removePhotoFiles } from '../lib/images.js';
import { addPhoto, attachSameDayPhotos } from '../domain/photos.js';
import { renderParkPage } from './park-view.js';

const MESSAGES = {
  no_position: "We couldn't read your location. You can stamp on the honor system instead.",
  no_location: "We don't have this park's location yet, so GPS check-in isn't available. You can stamp on the honor system.",
  bad_date: 'Enter a real date.',
  future_date: "You can't stamp a date in the future.",
  bad_method: 'Something went wrong. Try again.',
};

export default async function visitRoutes(app) {
  const { db } = app;

  const parkWithProblem = (req, reply, park, problem) =>
    renderParkPage(app, req, reply, park, { problem: { area: 'stamp', ...problem } });

  // Badges for the stamper, and "Better Together" for pals who stamped here the same day.
  function afterStamp(user, visit, park) {
    app.track(user.id, 'check_in', { park_slug: park.slug, method: visit.method });
    const opts = { now: app.now(), random: app.random };
    // Photos already uploaded here that day count toward this stamp (+3).
    attachSameDayPhotos(db, user.id, visit, { now: app.now() });
    awardBadges(db, user.id, { type: 'visit', id: visit.id }, opts);
    for (const palId of palsAtParkOnDay(db, user.id, visit.park_id, visit.visited_on)) {
      awardBadges(db, palId, { type: 'pal', id: user.id }, { ...opts, random: () => 1 });
    }
  }

  function problemFor(result, park) {
    if (result.error === 'duplicate_day') {
      return result.date === localDate(app.now(), parkTimeZone(db, park.id))
        ? { text: 'Already stamped today. Come back tomorrow for another stamp.' }
        : { text: `You already stamped this park on ${formatDate(result.date)}.` };
    }
    if (result.error === 'too_far') {
      return {
        text: `You're ${formatMiles(result.distance_m)} from this park, a bit too far for a GPS check-in.`,
        offerHonor: true,
      };
    }
    return { text: MESSAGES[result.error] || MESSAGES.bad_method, offerHonor: result.error !== 'future_date' && result.error !== 'bad_date' };
  }

  app.post('/:city/parks/:slug/checkin', { preHandler: requireUser }, async (req, reply) => {
    const park = urlPark(db, req);
    if (!park) return reply.callNotFound();
    const result = stampVisit(db, { user: req.user, park, method: 'gps', position: parsePosition(req.body) }, { now: app.now() });
    if (result.error) return parkWithProblem(req, reply, park, problemFor(result, park));
    afterStamp(req.user, result.visit, park);
    return reply.redirect(parkPath(park, `?stamped=${result.visit.id}`), 303);
  });

  // One-tap stamp (the tab bar's Stamp button): GPS position -> the nearest park in any city -> a GPS stamp.
  app.get('/stamp', { preHandler: requireUser }, async (req, reply) => reply.page(stampFinderPage({ csrf: req.csrfToken() })));

  app.post('/stamp', { preHandler: requireUser }, async (req, reply) => {
    const finder = (problem) => reply.code(422).page(stampFinderPage({ csrf: req.csrfToken(), problem }));
    const position = parsePosition(req.body);
    if (!position) return finder({ text: "We couldn't read your location. Allow location and try again, or pick your park from the list." });
    const nearby = db.prepare(`SELECT p.*, (SELECT key FROM city_themes WHERE id = p.city_id) AS city_key FROM parks p
      WHERE p.active = 1 AND p.lat IS NOT NULL AND p.lng IS NOT NULL`).all()
      .map((p) => ({ park: p, distance_m: distanceMeters(position, p) }))
      .sort((a, b) => a.distance_m - b.distance_m);
    const closest = nearby[0];
    const list = nearby.slice(0, 3).map(({ park: p, distance_m }) => ({ slug: p.slug, city_key: p.city_key, name: p.name, distance_m }));
    if (!closest) return finder({ text: 'No parks have a location yet.', nearby: [] });
    // Radii differ per park, so the park to stamp is the nearest one whose check-in area holds the
    // member, not just the nearest center.
    const inside = nearby.find(({ park: p }) => evaluateCheckin(p, position).ok);
    if (!inside) {
      return finder({ text: `You're ${formatMiles(closest.distance_m)} from the closest park, ${closest.park.name}. Get a little closer, or stamp it on the honor system.`, nearby: list });
    }
    const park = getParkById(db, inside.park.id);
    const result = stampVisit(db, { user: req.user, park, method: 'gps', position }, { now: app.now() });
    if (result.error) return finder({ ...problemFor(result, park), text: `${park.name}: ${problemFor(result, park).text}`, nearby: list });
    afterStamp(req.user, result.visit, park);
    return reply.redirect(parkPath(park, `?stamped=${result.visit.id}`), 303);
  });

  // Honor stamp, optionally with a photo (a photo stamp). The only visit route that takes uploads.
  withUploads(app, (scope) => scope.post('/:city/parks/:slug/stamp', { preHandler: requireUser }, async (req, reply) => {
    const park = urlPark(db, req);
    if (!park) return reply.callNotFound();
    const visitedOn = typeof req.body.visited_on === 'string' && req.body.visited_on ? req.body.visited_on : null;
    // An optional photo makes this a photo stamp; a bad photo stops the stamp.
    const file = Buffer.isBuffer(req.body.photo) && req.body.photo.length ? req.body.photo : null;
    const stored = file ? await storePhoto(file, app.config.uploadsDir) : null;
    if (stored?.error) return parkWithProblem(req, reply, park, { text: stored.error, offerHonor: true });
    let result;
    try {
      // The visit and its photo are saved together, or not at all.
      result = db.transaction(() => {
        const r = stampVisit(db, { user: req.user, park, method: stored ? 'photo' : 'honor', visitedOn }, { now: app.now() });
        if (!r.error && stored) {
          // Kids edition: stamp photos start private (they may show children).
          addPhoto(db, { user: req.user, park, visitId: r.visit.id, stored, visibility: req.user.kids ? 'private' : undefined,
            caption: typeof req.body.caption === 'string' ? req.body.caption : '' }, { now: app.now() });
          r.visit = getVisit(db, r.visit.id); // points now include the photo bonus
        }
        return r;
      })();
    } catch (err) {
      if (stored) await removePhotoFiles(app.config.uploadsDir, stored.fileKey);
      throw err;
    }
    if (result.error) {
      if (stored) await removePhotoFiles(app.config.uploadsDir, stored.fileKey);
      return parkWithProblem(req, reply, park, problemFor(result, park));
    }
    afterStamp(req.user, result.visit, park);
    if (stored) app.track(req.user.id, 'photo_upload', { park_slug: park.slug });
    return reply.redirect(parkPath(park, `?stamped=${result.visit.id}`), 303);
  }));

  app.post('/visits/:id/delete', { preHandler: requireUser }, async (req, reply) => {
    const visit = deleteVisit(db, { user: req.user, visitId: Number(req.params.id) }, { now: app.now() });
    if (!visit) return reply.callNotFound();
    revokeUnmetBadges(db, req.user.id);
    // Pals who stamped here that day may have earned Better Together from this visit.
    for (const palId of palsAtParkOnDay(db, req.user.id, visit.park_id, visit.visited_on)) revokeUnmetBadges(db, palId);
    const back = typeof req.body.back === 'string' && /^\/[a-z0-9/-]*$/.test(req.body.back) ? req.body.back : '/passport';
    return reply.redirect(back, 303);
  });
}
