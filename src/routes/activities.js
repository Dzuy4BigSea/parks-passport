import { requireUser } from '../lib/auth.js';
import { getParkById } from '../domain/parks.js';
import { parkPath } from '../views/urls.js';
import { urlPark } from './city-params.js';
import { logActivity, deleteActivityLog, LIMITS } from '../domain/activities.js';
import { awardBadges, revokeUnmetBadges } from '../domain/badges/index.js';
import { renderParkPage } from './park-view.js';

const PROBLEMS = {
  not_stamped: () => 'Stamp this park today first, then log what you do here.',
  unknown: () => "That activity isn't available here.",
  bad_amount: (a) => ({
    minutes: `Enter the minutes, from 1 to ${LIMITS.minutesPerLog}.`,
    miles: `Enter the miles, from 0.1 to ${LIMITS.milesPerLog}.`,
    count: `Enter a number from 1 to ${LIMITS.countPerLog}.`,
  })[a?.measure] || 'Enter an amount.',
  miles_cap: () => `That would take you over ${LIMITS.milesPerDay} miles today. Log the rest tomorrow.`,
  duplicate: (a) => `You already logged ${a.name} here today.`,
};

export default async function activityRoutes(app) {
  const { db } = app;

  app.post('/:city/parks/:slug/activities', { preHandler: requireUser }, async (req, reply) => {
    const park = urlPark(db, req);
    if (!park) return reply.callNotFound();
    const slug = typeof req.body.activity === 'string' ? req.body.activity : '';
    const result = logActivity(db, { user: req.user, park, slug, amount: req.body.amount }, { now: app.now() });
    if (result.error) {
      return renderParkPage(app, req, reply, park, {
        problem: { area: 'activities', activity: slug, text: PROBLEMS[result.error](result.activity) },
      });
    }
    app.track(req.user.id, 'activity_log', { activity_slug: result.activity.slug, pillar: result.activity.pillar });
    awardBadges(db, req.user.id, { type: 'activity', id: result.log.id }, { now: app.now(), random: app.random });
    return reply.redirect(parkPath(park, `?logged=${result.log.id}#activities`), 303);
  });

  app.post('/activities/:id/delete', { preHandler: requireUser }, async (req, reply) => {
    const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : null;
    const log = id && deleteActivityLog(db, { user: req.user, logId: id });
    const slug = log && db.prepare('SELECT slug FROM activities WHERE id = ?').pluck().get(log.activity_id);
    if (!log) return reply.callNotFound();
    revokeUnmetBadges(db, req.user.id);
    // The park may have been deactivated since; then back to the passport.
    const park = getParkById(db, log.park_id);
    return reply.redirect(park ? parkPath(park, `?undone=${slug}#activities`) : '/passport', 303);
  });

  app.post('/account/editions', { preHandler: requireUser }, async (req, reply) => {
    db.prepare('UPDATE users SET paws = ?, kids = ? WHERE id = ?')
      .run(req.body.paws === '1' ? 1 : 0, req.body.kids === '1' ? 1 : 0, req.user.id);
    return reply.redirect('/account?done=editions#editions', 303);
  });
}
