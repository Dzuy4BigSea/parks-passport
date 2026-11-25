import { requireUser } from '../lib/auth.js';
import { canSendFeedback } from '../domain/founding.js';
import { sendFeedback, allFeedback, setFeedbackDone } from '../domain/feedback.js';
import {
  sunshineParks, defaultSunshinePark, sendSunshine, sunshineForAdmin, sunshineCounts, setSunshineStatus, STATUSES as SUNSHINE_STATUSES,
} from '../domain/sunshine.js';
import { listCities } from '../domain/city.js';
import { feedbackPage, adminFeedbackPage, sunshinePage, adminSunshinePage } from '../views/pages/community.js';

// Community features: feedback from founding explorers (SPEC Flow 16) and Drops of Sunshine
// (Flow 17). Pages that aren't for this member 404 (never 403).
export default async function communityRoutes(app) {
  const { db } = app;
  const now = () => app.now();
  const idOf = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);

  // ---------- Feedback (Founding Members and Early Bird Edition holders) ----------
  const feedbackOnly = { preHandler: [requireUser, async (req, reply) => { if (!canSendFeedback(db, req.user.id)) return reply.callNotFound(); }] };
  const wantsJson = (req) => String(req.headers.accept || '').includes('application/json');

  app.get('/feedback', feedbackOnly, async (req, reply) => reply.page(feedbackPage({
    csrf: req.csrfToken(), page: typeof req.query.from === 'string' ? req.query.from : '', sent: req.query.done === 'sent',
  })));
  app.post('/feedback', feedbackOnly, async (req, reply) => {
    const result = sendFeedback(db, req.user.id, req.body, { now: now() });
    if (wantsJson(req)) return reply.code(result.error ? 422 : 200).send(result.error ? { error: result.error } : { ok: true });
    if (result.error) {
      return reply.code(422).page(feedbackPage({ csrf: req.csrfToken(), page: req.body.page, error: result.error, values: result.values }));
    }
    return reply.redirect('/feedback?done=sent', 303);
  });

  // ---------- Drops of Sunshine ----------
  // The page is for the city being viewed (req.city). ?park=<slug> comes from a park page.
  const sunshineView = (req, extra = {}) => {
    const city = req.city;
    const chosen = defaultSunshinePark(db, req.user.id, city.id, typeof req.query?.park === 'string' ? req.query.park : '');
    return sunshinePage({
      csrf: req.csrfToken(), city, parks: sunshineParks(db, city.id), chosen,
      // Only a park page's own park is "fixed"; otherwise the browser may pick the nearest by GPS.
      fromParkPage: Boolean(req.query?.park && chosen?.slug === req.query.park), ...extra,
    });
  };
  app.get('/sunshine', { preHandler: requireUser }, async (req, reply) => {
    if (req.query.sent === '1') {
      // The park's name comes from the database (by slug in this city), never from the URL.
      const to = typeof req.query.to === 'string'
        ? db.prepare('SELECT name FROM parks WHERE city_id = ? AND slug = ?').pluck().get(req.city.id, req.query.to) || '' : '';
      return reply.page(sunshineView(req, { sent: true, sentTo: to }));
    }
    return reply.page(sunshineView(req));
  });
  app.post('/sunshine', { preHandler: requireUser }, async (req, reply) => {
    const result = sendSunshine(db, req.user, req.city.id, req.body, { now: now() });
    if (result.error) return reply.code(422).page(sunshineView(req, { error: result.error, values: result.values }));
    const slug = result.note.parkId ? db.prepare('SELECT slug FROM parks WHERE id = ?').pluck().get(result.note.parkId) : '';
    return reply.redirect(`/sunshine?sent=1${slug ? `&to=${encodeURIComponent(slug)}` : ''}`, 303);
  });

  // ---------- Admin ----------
  app.register(async (admin) => {
    admin.addHook('onRequest', async (req, reply) => {
      if (!req.user?.is_admin) return reply.callNotFound();
    });
    admin.get('/feedback', async (req, reply) => {
      const done = req.query.show === 'done';
      return reply.page(adminFeedbackPage({ csrf: req.csrfToken(), items: allFeedback(db, { done }), done }));
    });
    admin.get('/sunshine', async (req, reply) => {
      const status = Object.hasOwn(SUNSHINE_STATUSES, req.query.status) ? req.query.status : 'new';
      const cities = listCities(db);
      const city = cities.find((c) => c.key === req.query.city) || null;
      return reply.page(adminSunshinePage({
        csrf: req.csrfToken(), notes: sunshineForAdmin(db, { status, cityId: city?.id ?? null }), counts: sunshineCounts(db), status, cities, city,
      }));
    });
    admin.post('/sunshine/:id', async (req, reply) => {
      const id = idOf(req);
      if (!id || !setSunshineStatus(db, id, String(req.body.status), { now: now() })) return reply.callNotFound();
      const back = Object.hasOwn(SUNSHINE_STATUSES, req.body.back) ? req.body.back : 'new';
      return reply.redirect(`/admin/sunshine?status=${back}`, 303);
    });
    admin.post('/feedback/:id', async (req, reply) => {
      const id = idOf(req);
      if (!id || !setFeedbackDone(db, id, req.body.done === '1', { now: now() })) return reply.callNotFound();
      return reply.redirect(`/admin/feedback${req.body.done === '1' ? '' : '?show=done'}`, 303);
    });
  }, { prefix: '/admin' });
}
