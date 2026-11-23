import { requireUser } from '../lib/auth.js';
import { getParkBySlug } from '../domain/parks.js';
import { parsePosition } from '../domain/checkin.js';
import { stampVisit, deleteVisit, getVisit } from '../domain/visits.js';
import { withUploads } from '../lib/uploads.js';
import { awardBadges, revokeUnmetBadges } from '../domain/badges/index.js';
import { palsAtParkOnDay } from '../domain/pals.js';
import { formatMiles } from '../domain/geo.js';
import { formatDate, localDate } from '../domain/time.js';
import { storePhoto, removePhotoFiles } from '../lib/images.js';
import { addPhoto } from '../domain/photos.js';
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
  function afterStamp(user, visit) {
    const opts = { now: app.now(), random: app.random };
    awardBadges(db, user.id, { type: 'visit', id: visit.id }, opts);
    for (const palId of palsAtParkOnDay(db, user.id, visit.park_id, visit.visited_on)) {
      awardBadges(db, palId, { type: 'pal', id: user.id }, { ...opts, random: () => 1 });
    }
  }

  function problemFor(result) {
    if (result.error === 'duplicate_day') {
      return result.date === localDate(app.now())
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

  app.post('/parks/:slug/checkin', { preHandler: requireUser }, async (req, reply) => {
    const park = getParkBySlug(db, req.params.slug);
    if (!park) return reply.callNotFound();
    const result = stampVisit(db, { user: req.user, park, method: 'gps', position: parsePosition(req.body) }, { now: app.now() });
    if (result.error) return parkWithProblem(req, reply, park, problemFor(result));
    afterStamp(req.user, result.visit);
    return reply.redirect(`/parks/${park.slug}?stamped=${result.visit.id}`, 303);
  });

  // Honor stamp, optionally with a photo (a photo stamp). The only visit route that takes uploads.
  withUploads(app, (scope) => scope.post('/parks/:slug/stamp', { preHandler: requireUser }, async (req, reply) => {
    const park = getParkBySlug(db, req.params.slug);
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
          addPhoto(db, { user: req.user, park, visitId: r.visit.id, stored,
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
      return parkWithProblem(req, reply, park, problemFor(result));
    }
    afterStamp(req.user, result.visit);
    return reply.redirect(`/parks/${park.slug}?stamped=${result.visit.id}`, 303);
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
