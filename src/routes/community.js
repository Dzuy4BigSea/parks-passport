import { requireUser } from '../lib/auth.js';
import { canSendFeedback } from '../domain/founding.js';
import { sendFeedback, allFeedback, setFeedbackDone, KINDS as FEEDBACK_KINDS } from '../domain/feedback.js';
import { garyReply } from '../views/gary-help.js';
import {
  sunshineParks, defaultSunshinePark, sendSunshine, sunshineForAdmin, sunshineCounts, setSunshineStatus, STATUSES as SUNSHINE_STATUSES,
} from '../domain/sunshine.js';
import { listCities } from '../domain/city.js';
import {
  suggestNonprofit, saveNonprofit, nonprofitById, deleteNonprofit, nonprofitsForAdmin, nonprofitCounts, recordClick, showsOn, isBot, STATUSES as NP_STATUSES,
} from '../domain/nonprofits.js';
import { withUploads } from '../lib/uploads.js';
import { storeBadgeArt, removeBadgeArt, removeAdImage } from '../lib/images.js';
import {
  feedbackPage, adminFeedbackPage, sunshinePage, adminSunshinePage, suggestNonprofitPage, adminNonprofitsPage, adminNonprofitForm,
  adminMissionPage,
} from '../views/pages/community.js';

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
    reply: req.query.done === 'sent' ? garyReply(Object.hasOwn(FEEDBACK_KINDS, req.query.kind) ? req.query.kind : 'idea') : null,
  })));
  app.post('/feedback', feedbackOnly, async (req, reply) => {
    const result = sendFeedback(db, req.user.id, req.body, { now: now() });
    // Gary answers (SPEC Flow 21): a thank-you that fits the kind of feedback.
    const kind = Object.hasOwn(FEEDBACK_KINDS, req.body.kind) ? req.body.kind : 'idea';
    if (wantsJson(req)) return reply.code(result.error ? 422 : 200).send(result.error ? { error: result.error } : { ok: true, reply: garyReply(kind) });
    if (result.error) {
      return reply.code(422).page(feedbackPage({ csrf: req.csrfToken(), page: req.body.page, error: result.error, values: result.values }));
    }
    return reply.redirect(`/feedback?done=sent&kind=${kind}`, 303);
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
  // The form carries its city, so a second tab on another city doesn't change where it goes.
  const formCity = (req) => listCities(db).find((c) => c.key === req.body.city) || req.city;
  app.post('/sunshine', { preHandler: requireUser }, async (req, reply) => {
    req.city = formCity(req);
    const result = sendSunshine(db, req.user, req.city.id, req.body, { now: now() });
    if (result.error) return reply.code(422).page(sunshineView(req, { error: result.error, values: result.values }));
    const slug = result.note.parkId ? db.prepare('SELECT slug FROM parks WHERE id = ?').pluck().get(result.note.parkId) : '';
    return reply.redirect(`/sunshine?sent=1&city=${req.city.key}${slug ? `&to=${encodeURIComponent(slug)}` : ''}`, 303);
  });

  // ---------- Nonprofit spotlights (SPEC Flow 18) ----------
  app.get('/nonprofits/suggest', { preHandler: requireUser }, async (req, reply) => reply.page(suggestNonprofitPage({
    csrf: req.csrfToken(), city: req.city, sent: req.query.done === 'sent',
  })));
  app.post('/nonprofits/suggest', { preHandler: requireUser }, async (req, reply) => {
    req.city = formCity(req);
    const result = suggestNonprofit(db, req.user, req.city.id, req.body, { now: now() });
    if (result.errors) return reply.code(422).page(suggestNonprofitPage({ csrf: req.csrfToken(), city: req.city, errors: result.errors, values: result.values }));
    return reply.redirect('/nonprofits/suggest?done=sent', 303);
  });
  // A spotlight click: counted for the park it was on, then off to the saved website (never a URL
  // from the request). Only active spotlights redirect.
  app.get('/go/nonprofit/:id', async (req, reply) => {
    const n = idOf(req) ? nonprofitById(db, idOf(req)) : null;
    if (!n || n.status !== 'active') return reply.callNotFound();
    const parkId = /^\d+$/.test(String(req.query.park || '')) ? Number(req.query.park) : null;
    // Counted only for a park this spotlight can show on, and not for crawlers or link previews.
    if (parkId && showsOn(db, n, parkId) && !isBot(req.headers['user-agent'])) recordClick(db, n.id, parkId, { now: now() });
    return reply.header('Cache-Control', 'no-store').redirect(n.url, 302);
  });

  // ---------- Admin ----------
  app.register(async (admin) => {
    admin.addHook('onRequest', async (req, reply) => {
      if (!req.user?.is_admin) return reply.callNotFound();
    });
    admin.get('/mission', async (req, reply) => reply.page(adminMissionPage()));
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
      const city = listCities(db).find((c) => c.key === req.body.city_filter);
      return reply.redirect(`/admin/sunshine?status=${back}${city ? `&city=${city.key}` : ''}`, 303);
    });
    // Nonprofits: list with views and clicks; the form (with a logo upload) is below.
    admin.get('/nonprofits', async (req, reply) => {
      const status = Object.hasOwn(NP_STATUSES, req.query.status) ? req.query.status : '';
      return reply.page(adminNonprofitsPage({ items: nonprofitsForAdmin(db, { status, now: now() }), counts: nonprofitCounts(db), status }));
    });
    const formView = (req, extra) => {
      const cities = listCities(db);
      const parksByCity = Object.fromEntries(cities.map((c) => [c.id, db.prepare('SELECT id, name FROM parks WHERE city_id = ? AND active = 1 ORDER BY name COLLATE NOCASE').all(c.id)]));
      return adminNonprofitForm({ csrf: req.csrfToken(), cities, parksByCity, ...extra });
    };
    admin.get('/nonprofits/new', async (req, reply) => reply.page(formView(req, { isNew: true })));
    admin.get('/nonprofits/:id', async (req, reply) => {
      const n = idOf(req) ? nonprofitById(db, idOf(req)) : null;
      if (!n) return reply.callNotFound();
      return reply.page(formView(req, { nonprofit: n, notice: req.query.saved ? 'Saved.' : null }));
    });
    admin.post('/nonprofits/:id/delete', async (req, reply) => {
      const n = idOf(req) ? nonprofitById(db, idOf(req)) : null;
      // Its ads go with it (cascade): note their images first so the files go too.
      const adImages = n ? db.prepare('SELECT s.image_key FROM ad_slides s JOIN ads a ON a.id = s.ad_id WHERE a.nonprofit_id = ?').pluck().all(n.id) : [];
      if (!n || !deleteNonprofit(db, n.id)) return reply.callNotFound();
      if (n.logo) await removeBadgeArt(app.config.uploadsDir, n.logo);
      for (const key of adImages) await removeAdImage(app.config.uploadsDir, key);
      return reply.redirect('/admin/nonprofits', 303);
    });
    withUploads(admin, (r) => {
      const save = async (req, reply, existing) => {
        const values = { ...req.body };
        delete values.logo_file;
        const file = Buffer.isBuffer(req.body.logo_file) && req.body.logo_file.length ? req.body.logo_file : null;
        let logo;
        if (file) {
          const stored = await storeBadgeArt(file, app.config.uploadsDir);
          if (stored.error) return reply.code(422).page(formView(req, { isNew: !existing, nonprofit: existing, values, errors: { logo_file: stored.error } }));
          logo = `upload:${stored.key}`;
        } else if (values.remove_logo === '1') logo = null;
        const result = saveNonprofit(db, existing?.id ?? null, values, { now: now(), logo });
        if (result.errors) {
          if (logo) await removeBadgeArt(app.config.uploadsDir, logo);
          return reply.code(422).page(formView(req, { isNew: !existing, nonprofit: existing, values: { ...values, ...result.values }, errors: result.errors }));
        }
        if (existing?.logo && logo !== undefined && logo !== existing.logo) await removeBadgeArt(app.config.uploadsDir, existing.logo);
        return reply.redirect(`/admin/nonprofits/${result.id}?saved=1`, 303);
      };
      r.post('/nonprofits/new', async (req, reply) => save(req, reply, null));
      r.post('/nonprofits/:id', async (req, reply) => {
        const n = idOf(req) ? nonprofitById(db, idOf(req)) : null;
        if (!n) return reply.callNotFound();
        return save(req, reply, n);
      });
    });
    admin.post('/feedback/:id', async (req, reply) => {
      const id = idOf(req);
      if (!id || !setFeedbackDone(db, id, req.body.done === '1', { now: now() })) return reply.callNotFound();
      return reply.redirect(`/admin/feedback${req.body.done === '1' ? '' : '?show=done'}`, 303);
    });
  }, { prefix: '/admin' });
}
