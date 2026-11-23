import { requireUser } from '../lib/auth.js';
import { getParkBySlug } from '../domain/parks.js';
import { parsePosition } from '../domain/checkin.js';
import { stampVisit, deleteVisit, visitsAtPark } from '../domain/visits.js';
import { awardBadges, revokeUnmetBadges } from '../domain/badges/index.js';
import { palsAtParkOnDay } from '../domain/pals.js';
import { formatMiles } from '../domain/geo.js';
import { formatDate, localDate } from '../domain/time.js';
import { parkPage } from '../views/pages/park.js';

const MESSAGES = {
  no_position: "We couldn't read your location. You can stamp on the honor system instead.",
  no_location: "We don't have this park's location yet, so GPS check-in isn't available. You can stamp on the honor system.",
  bad_date: 'Enter a real date.',
  future_date: "You can't stamp a date in the future.",
  bad_method: 'Something went wrong. Try again.',
};

export default async function visitRoutes(app) {
  const { db } = app;

  // Renders the park page for the signed-in user with a stamp problem message.
  function parkWithProblem(req, reply, park, problem) {
    reply.code(422);
    return reply.page(parkPage({
      park, user: req.user, csrf: req.csrfToken(), today: localDate(app.now()),
      myVisits: visitsAtPark(db, req.user.id, park.id), problem,
    }));
  }

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

  app.post('/parks/:slug/stamp', { preHandler: requireUser }, async (req, reply) => {
    const park = getParkBySlug(db, req.params.slug);
    if (!park) return reply.callNotFound();
    const visitedOn = typeof req.body.visited_on === 'string' && req.body.visited_on ? req.body.visited_on : null;
    const result = stampVisit(db, { user: req.user, park, method: 'honor', visitedOn }, { now: app.now() });
    if (result.error) return parkWithProblem(req, reply, park, problemFor(result));
    afterStamp(req.user, result.visit);
    return reply.redirect(`/parks/${park.slug}?stamped=${result.visit.id}`, 303);
  });

  app.post('/visits/:id/delete', { preHandler: requireUser }, async (req, reply) => {
    const visit = deleteVisit(db, { user: req.user, visitId: Number(req.params.id) }, { now: app.now() });
    if (!visit) return reply.callNotFound();
    revokeUnmetBadges(db, req.user.id);
    const back = typeof req.body.back === 'string' && /^\/[a-z0-9/-]*$/.test(req.body.back) ? req.body.back : '/passport';
    return reply.redirect(back, 303);
  });
}
