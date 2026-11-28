import fs from 'node:fs';
import {
  adById, saveAd, deleteAd, addSlide, moveSlide, removeSlide, adShowsAt, recordAdView, recordAdClick, adsForAdmin,
} from '../domain/ads.js';
import { isBot } from '../domain/nonprofits.js';
import { listCities, cityById } from '../domain/city.js';
import { withUploads } from '../lib/uploads.js';
import { storeAdImage, removeAdImage, adImagePath } from '../lib/images.js';
import { tipContent } from '../views/ads.js';
import { adminAdsPage, adminAdForm, tipPage } from '../views/pages/ads-admin.js';
import { parkPath } from '../views/urls.js';
import { activitiesForPark, visitToday } from '../domain/activities.js';
import { localDate } from '../domain/time.js';

// Nonprofit ads and activity tips (SPEC Flow 25).
export default async function adRoutes(app) {
  const { db } = app;
  const now = () => app.now();
  const idOf = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : null);
  const parkOf = (id) => (id ? db.prepare('SELECT * FROM parks WHERE id = ? AND active = 1').get(id) : null);

  // Ad images are public and never change under the same name.
  app.get('/ad-art/:file', async (req, reply) => {
    const m = /^([a-f0-9]{24})(\.still)?\.webp$/.exec(req.params.file);
    if (!m || !db.prepare('SELECT 1 FROM ad_slides WHERE image_key = ?').get(m[1])) return reply.callNotFound();
    const file = adImagePath(app.config.uploadsDir, m[1], Boolean(m[2]));
    if (!fs.existsSync(file)) return reply.callNotFound();
    return reply.type('image/webp').header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff').send(fs.createReadStream(file));
  });

  // Where an ad was seen: ?from=<park id> or ?from=city-<city id> (the passport page).
  const placeOf = (from) => {
    const city = /^city-(\d+)$/.exec(String(from ?? ''));
    if (city) return { park: null, theme: cityById(db, Number(city[1])) };
    const park = parkOf(idOf(from));
    return park ? { park, theme: cityById(db, park.city_id) } : null;
  };

  // A click: counted where the ad can show, then off to the nonprofit's saved website.
  app.get('/go/ad/:id', async (req, reply) => {
    const ad = idOf(req.params.id) ? adById(db, idOf(req.params.id)) : null;
    if (!ad || ad.nonprofit_status !== 'active') return reply.callNotFound();
    const url = db.prepare('SELECT url FROM nonprofits WHERE id = ?').pluck().get(ad.nonprofit_id);
    const place = placeOf(req.query.from);
    if (place && !isBot(req.headers['user-agent']) && adShowsAt(db, ad, { ...place, now: now() })) {
      recordAdClick(db, ad.id, place.park?.id ?? 0, { now: now() });
    }
    return reply.header('Cache-Control', 'no-store').redirect(url, 302);
  });

  // A tip: the pop-up's content (?embed=1, fetched by public/js/ads.js) or a page without JS.
  // Only where its link shows: a member who stamped this park today and has the activity here.
  // Opening it is the view that's counted.
  app.get('/tips/:id', async (req, reply) => {
    const ad = idOf(req.params.id) ? adById(db, idOf(req.params.id)) : null;
    const park = parkOf(idOf(req.query.park));
    const theme = park && cityById(db, park.city_id);
    const user = req.user;
    if (!ad || ad.placement !== 'activity' || !park || !user || !adShowsAt(db, ad, { park, theme, now: now() })) return reply.callNotFound();
    if (!visitToday(db, user.id, park.id, localDate(now(), theme.time_zone))
      || !activitiesForPark(db, user, park).some((a) => a.id === ad.activity_id)) return reply.callNotFound();
    if (req.method === 'GET' && !isBot(req.headers['user-agent'])) recordAdView(db, ad.id, park.id, { now: now() });
    if (req.query.embed === '1') {
      return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(String(tipContent(ad, park)));
    }
    return reply.page(tipPage({ ad, park, back: parkPath(park, '#activities') }));
  });

  // ---------- Admin › Ads ----------
  app.register(async (admin) => {
    admin.addHook('onRequest', async (req, reply) => {
      if (!req.user?.is_admin) return reply.callNotFound();
    });
    const options = () => {
      const cities = listCities(db).filter((c) => c.id);
      return {
        cities,
        nonprofits: db.prepare("SELECT id, name, status FROM nonprofits WHERE status != 'suggested' ORDER BY name COLLATE NOCASE").all(),
        activities: db.prepare('SELECT id, name, edition, category FROM activities WHERE active = 1 ORDER BY name COLLATE NOCASE').all(),
        parksByCity: Object.fromEntries(cities.map((c) => [c.id, db.prepare('SELECT id, name FROM parks WHERE city_id = ? AND active = 1 ORDER BY name COLLATE NOCASE').all(c.id)])),
      };
    };
    // New ads default to today in the current city (not the UTC day).
    const form = (req, extra) => adminAdForm({ csrf: req.csrfToken(), ...options(), today: localDate(now(), req.city?.time_zone), ...extra });
    const adOf = (req) => (idOf(req.params.id) ? adById(db, idOf(req.params.id)) : null);

    admin.get('/ads', async (req, reply) => reply.page(adminAdsPage({
      ads: adsForAdmin(db, { now: now(), timeZone: req.city?.time_zone }),
    })));
    admin.get('/ads/new', async (req, reply) => reply.page(form(req, { isNew: true })));
    admin.post('/ads/new', async (req, reply) => {
      const result = saveAd(db, null, req.body, { now: now() });
      if (result.errors) return reply.code(422).page(form(req, { isNew: true, values: result.values, errors: result.errors }));
      return reply.redirect(`/admin/ads/${result.id}?done=created#images`, 303);
    });
    const NOTICES = { created: 'Ad saved. Add its images next, then switch it on.', saved: 'Saved.', slide: 'Image added.', removed: 'Image removed.' };
    admin.get('/ads/:id', async (req, reply) => {
      const ad = adOf(req);
      if (!ad) return reply.callNotFound();
      return reply.page(form(req, { ad, notice: NOTICES[req.query.done] || null }));
    });
    admin.post('/ads/:id', async (req, reply) => {
      const ad = adOf(req);
      if (!ad) return reply.callNotFound();
      const result = saveAd(db, ad.id, req.body, { now: now() });
      if (result.errors) return reply.code(422).page(form(req, { ad, values: result.values, errors: result.errors }));
      return reply.redirect(`/admin/ads/${ad.id}?done=saved`, 303);
    });
    admin.post('/ads/:id/delete', async (req, reply) => {
      const ad = adOf(req);
      const keys = ad && deleteAd(db, ad.id);
      if (!keys) return reply.callNotFound();
      for (const k of keys) await removeAdImage(app.config.uploadsDir, k);
      return reply.redirect('/admin/ads', 303);
    });
    for (const [action, dir] of [['up', -1], ['down', 1]]) {
      admin.post(`/ads/:id/slides/:sid/${action}`, async (req, reply) => {
        const ad = adOf(req);
        if (!ad || !moveSlide(db, ad.id, idOf(req.params.sid), dir)) return reply.callNotFound();
        return reply.redirect(`/admin/ads/${ad.id}#images`, 303);
      });
    }
    admin.post('/ads/:id/slides/:sid/delete', async (req, reply) => {
      const ad = adOf(req);
      const key = ad && removeSlide(db, ad.id, idOf(req.params.sid));
      if (!key) return reply.callNotFound();
      await removeAdImage(app.config.uploadsDir, key);
      return reply.redirect(`/admin/ads/${ad.id}?done=removed#images`, 303);
    });
    // One image per upload, so the server holds one file at a time (512 MB container).
    withUploads(admin, (r) => r.post('/ads/:id/slides', async (req, reply) => {
      const ad = adOf(req);
      if (!ad) return reply.callNotFound();
      const file = Buffer.isBuffer(req.body.image) && req.body.image.length ? req.body.image : null;
      const alt = String(req.body.alt ?? '');
      const fail = (error) => reply.code(422).page(form(req, { ad, slideError: error, slideAlt: alt }));
      if (ad.slides.length >= 5) return fail('An ad has at most 5 images.');
      const stored = await storeAdImage(file, app.config.uploadsDir);
      if (stored.error) return fail(stored.error);
      const added = addSlide(db, ad.id, { key: stored.key, animated: stored.animated, alt });
      if (added.error) {
        await removeAdImage(app.config.uploadsDir, stored.key);
        return fail(added.error);
      }
      return reply.redirect(`/admin/ads/${ad.id}?done=slide#images`, 303);
    }));
  }, { prefix: '/admin' });
}
