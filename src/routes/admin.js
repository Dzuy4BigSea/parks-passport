import fs from 'node:fs';
import { withUploads } from '../lib/uploads.js';
import { safeNext } from '../lib/auth.js';
import { storeBadgeArt, badgeArtPath, removeBadgeArt } from '../lib/images.js';
import { importParksCsv } from '../domain/csv-import.js';
import { SEED_PARKS_CSV } from '../db/seed.js';
import {
  allParksForAdmin, parkForAdmin, saveParkFromForm, allBadgesForAdmin, badgeForAdmin, validateBadgeForm, saveBadge,
  moderationQueue, setPhotoHidden, setCommentHidden, allUsersForAdmin, setAdminFlag,
} from '../domain/admin.js';
import { saveEmailSettings, saveSendgridKey, clearSendgridKey, sendgridKey } from '../domain/settings.js';
import {
  adminEmail, adminHome, adminParks, adminParkForm, adminImport, adminBadges, adminBadgeForm, adminModeration, adminUsers,
} from '../views/pages/admin.js';

const MAX_CSV_BYTES = 1024 * 1024;

export default async function adminRoutes(app) {
  const { db } = app;
  const now = () => app.now();

  // Everything here is admins-only and 404s for everyone else (never 403). onRequest runs before
  // the body (uploads included) is read and before the CSRF check; req.user is already set.
  app.register(async (admin) => {
    admin.addHook('onRequest', async (req, reply) => {
      if (!req.user?.is_admin) return reply.callNotFound();
    });
    routes(admin);
    withUploads(admin, uploadRoutes);
  }, { prefix: '/admin' });

  // Uploaded badge art is public (badges are shown on public passports).
  app.get('/badge-art/:file', async (req, reply) => {
    const m = /^([a-f0-9]{24})\.png$/.exec(req.params.file);
    const file = m && badgeArtPath(app.config.uploadsDir, m[1]);
    if (!file || !fs.existsSync(file)) return reply.callNotFound();
    return reply.type('image/png').header('Cache-Control', 'public, max-age=86400').header('X-Content-Type-Options', 'nosniff')
      .send(fs.createReadStream(file));
  });

  function routes(r) {
    r.get('/', async (req, reply) => {
      const one = (sql) => db.prepare(sql).pluck().get();
      return reply.page(adminHome({ counts: {
        active: one('SELECT COUNT(*) FROM parks WHERE active = 1'),
        inactive: one('SELECT COUNT(*) FROM parks WHERE active = 0'),
        needsPin: one('SELECT COUNT(*) FROM parks WHERE needs_pin = 1'),
        badges: one('SELECT COUNT(*) FROM badges'),
        shared: one("SELECT (SELECT COUNT(*) FROM photos WHERE visibility != 'private') + (SELECT COUNT(*) FROM ratings WHERE visibility != 'private' AND comment != '')"),
        users: one('SELECT COUNT(*) FROM users'),
        admins: one('SELECT COUNT(*) FROM users WHERE is_admin = 1'),
      } }));
    });

    // Parks
    r.get('/parks', async (req, reply) => {
      const filter = ['needs_pin', 'inactive'].includes(req.query.filter) ? req.query.filter : '';
      return reply.page(adminParks({ parks: allParksForAdmin(db, { filter }), filter }));
    });
    r.get('/parks/new', async (req, reply) => reply.page(adminParkForm({ csrf: req.csrfToken(), isNew: true })));
    r.post('/parks/new', async (req, reply) => {
      const result = saveParkFromForm(db, null, req.body, { now: now() });
      if (result.error) {
        reply.code(422);
        return reply.page(adminParkForm({ csrf: req.csrfToken(), isNew: true, park: formPark(req.body), error: result.error }));
      }
      return reply.redirect(`/admin/parks/${result.park.id}?saved=1`, 303);
    });
    r.get('/parks/:id', async (req, reply) => {
      const park = parkForAdmin(db, Number(req.params.id));
      if (!park) return reply.callNotFound();
      return reply.page(adminParkForm({ csrf: req.csrfToken(), park, notice: req.query.saved ? 'Saved.' : null }));
    });
    r.post('/parks/:id', async (req, reply) => {
      const existing = parkForAdmin(db, Number(req.params.id));
      if (!existing) return reply.callNotFound();
      const result = saveParkFromForm(db, existing.id, req.body, { now: now() });
      if (result.error) {
        reply.code(422);
        return reply.page(adminParkForm({ csrf: req.csrfToken(), park: { ...formPark(req.body), id: existing.id }, error: result.error }));
      }
      return reply.redirect(`/admin/parks/${existing.id}?saved=1`, 303);
    });

    // Import
    r.get('/import', async (req, reply) => reply.page(adminImport({ csrf: req.csrfToken() })));
    r.post('/import/seed', async (req, reply) => reply.page(adminImport({
      csrf: req.csrfToken(), result: importParksCsv(db, fs.readFileSync(SEED_PARKS_CSV, 'utf8'), { now }),
    })));

    // Badges
    r.get('/badges', async (req, reply) => reply.page(adminBadges({ badges: allBadgesForAdmin(db) })));
    r.get('/badges/new', async (req, reply) => reply.page(adminBadgeForm({ csrf: req.csrfToken(), isNew: true })));
    r.get('/badges/:id', async (req, reply) => {
      const badge = badgeForAdmin(db, Number(req.params.id));
      if (!badge) return reply.callNotFound();
      return reply.page(adminBadgeForm({ csrf: req.csrfToken(), badge, notice: req.query.saved ? 'Saved.' : null }));
    });

    // Moderation
    r.get('/moderation', async (req, reply) => reply.page(adminModeration({ queue: moderationQueue(db), csrf: req.csrfToken() })));
    r.post('/photos/:id/hidden', async (req, reply) => {
      if (!setPhotoHidden(db, Number(req.params.id), req.body.hidden === '1')) return reply.callNotFound();
      return reply.redirect(safeNext(req.body.back), 303);
    });
    r.post('/reviews/:id/hidden', async (req, reply) => {
      if (!setCommentHidden(db, Number(req.params.id), req.body.hidden === '1')) return reply.callNotFound();
      return reply.redirect(safeNext(req.body.back), 303);
    });

    // Email: sender, subjects, SendGrid key, test send.
    const emailPage = (req, extra = {}) => adminEmail({
      csrf: req.csrfToken(), settings: app.emailSettings(), transport: app.config.mailTransport,
      key: sendgridKey(db, app.secretBox, { envKey: app.config.sendgridEnvKey || '' }), me: req.user, ...extra,
    });
    r.get('/email', async (req, reply) => reply.page(emailPage(req, { notice: { saved: 'Email settings saved.', key: 'SendGrid key saved.', removed: 'Saved key removed.' }[req.query.done] })));
    r.post('/email', async (req, reply) => {
      const result = saveEmailSettings(db, req.body, { now: now() });
      if (result.errors) return reply.code(422).page(emailPage(req, { errors: result.errors, values: result.values }));
      return reply.redirect('/admin/email?done=saved', 303);
    });
    r.post('/email/key', async (req, reply) => {
      const result = saveSendgridKey(db, app.secretBox, req.body.sendgrid_key, { now: now() });
      if (result.error) return reply.code(422).page(emailPage(req, { keyError: result.error }));
      return reply.redirect('/admin/email?done=key', 303);
    });
    r.post('/email/key/delete', async (req, reply) => {
      clearSendgridKey(db);
      return reply.redirect('/admin/email?done=removed', 303);
    });
    r.post('/email/test', async (req, reply) => {
      const s = app.emailSettings();
      try {
        await app.mailer.send({
          to: req.user.email,
          subject: `${s.mail_from_name}: test email`,
          text: `This is a test from Parks Passport's admin. If you're reading it, email sending works.\n\nSender: ${s.mail_from_name} <${s.mail_from_address}>\n`,
        });
        return reply.page(emailPage(req, { notice: `Test email sent to ${req.user.email}. Check the inbox (and spam).` }));
      } catch (err) {
        req.log.warn({ err: err.message }, 'test email failed');
        return reply.code(502).page(emailPage(req, { testError: `Sending failed: ${err.message}${err.detail ? ` (${err.detail})` : ''}` }));
      }
    });

    // Members
    r.get('/users', async (req, reply) => reply.page(adminUsers({
      users: allUsersForAdmin(db), csrf: req.csrfToken(), me: req.user,
      notice: req.query.done ? 'Saved.' : null,
    })));
    r.post('/users/:id/admin', async (req, reply) => {
      const result = setAdminFlag(db, req.user, Number(req.params.id), req.body.admin === '1');
      if (result.error === 'not_found') return reply.callNotFound();
      if (result.error) {
        reply.code(422);
        return reply.page(adminUsers({ users: allUsersForAdmin(db), csrf: req.csrfToken(), me: req.user, error: result.error }));
      }
      return reply.redirect('/admin/users?done=1', 303);
    });
  }

  // Routes that take file uploads (CSV, badge art).
  function uploadRoutes(r) {
    r.post('/import', async (req, reply) => {
      const file = Buffer.isBuffer(req.body.csv) ? req.body.csv : null;
      const csrf = req.csrfToken();
      if (!file?.length) return reply.code(422).page(adminImport({ csrf, error: 'Choose a CSV file.' }));
      if (file.length > MAX_CSV_BYTES) return reply.code(422).page(adminImport({ csrf, error: 'The CSV must be under 1 MB.' }));
      return reply.page(adminImport({ csrf, result: importParksCsv(db, file.toString('utf8'), { now }) }));
    });

    const saveBadgeRoute = async (req, reply, existing) => {
      const isNew = !existing;
      const values = { ...req.body };
      delete values.art_file;
      const { badge, errors = {} } = validateBadgeForm(values, { isNew });
      const artFile = Buffer.isBuffer(req.body.art_file) && req.body.art_file.length ? req.body.art_file : null;
      if (isNew && badge && db.prepare('SELECT 1 FROM badges WHERE slug = ?').get(badge.slug)) {
        errors.slug = 'Another badge already uses that slug.';
      }
      // Store uploaded art only once the rest of the form is valid, so a 422 leaves no file.
      let art = null;
      if (artFile && badge && !Object.keys(errors).length) {
        const stored = await storeBadgeArt(artFile, app.config.uploadsDir);
        if (stored.error) errors.art_file = stored.error;
        else art = `upload:${stored.key}`;
      }
      if (!badge || Object.keys(errors).length) {
        reply.code(422);
        return reply.page(adminBadgeForm({ csrf: req.csrfToken(), isNew, badge: existing, errors, values }));
      }
      // No new emoji typed: keep an existing uploaded image.
      if (art) badge.art = art;
      else if (!String(values.art || '').trim() && existing?.art?.startsWith('upload:')) badge.art = existing.art;
      const saved = saveBadge(db, existing?.id ?? null, badge, { now: now() });
      if (saved.error === 'slug_taken') {
        if (art) await removeBadgeArt(app.config.uploadsDir, art);
        reply.code(422);
        return reply.page(adminBadgeForm({ csrf: req.csrfToken(), isNew, badge: existing, errors: { slug: 'Another badge already uses that slug.' }, values }));
      }
      // Replaced art: remove the old file.
      if (existing?.art?.startsWith('upload:') && saved.art !== existing.art) await removeBadgeArt(app.config.uploadsDir, existing.art);
      return reply.redirect(`/admin/badges/${saved.id}?saved=1`, 303);
    };
    r.post('/badges/new', async (req, reply) => saveBadgeRoute(req, reply, null));
    r.post('/badges/:id', async (req, reply) => {
      const existing = badgeForAdmin(db, Number(req.params.id));
      if (!existing) return reply.callNotFound();
      return saveBadgeRoute(req, reply, existing);
    });
  }
}

// Re-shows a park form with what was typed after a validation error.
function formPark(body) {
  return {
    name: body.name, slug: body.slug, address: body.address, phone: body.phone, lat: body.lat, lng: body.lng,
    checkin_radius_m: body.checkin_radius_m, city_url: body.city_url, active: body.active === '1' ? 1 : 0,
    needs_pin: body.needs_pin === '1' ? 1 : 0, categories: [].concat(body.categories || []),
  };
}
