import fs from 'node:fs';
import { withUploads } from '../lib/uploads.js';
import { safeNext } from '../lib/auth.js';
import { storeBadgeArt, badgeArtPath, removeBadgeArt } from '../lib/images.js';
import { importParksCsv } from '../domain/csv-import.js';
import { cityPackFile } from '../db/seed.js';
import {
  allParksForAdmin, parkForAdmin, saveParkFromForm, allBadgesForAdmin, badgeForAdmin, validateBadgeForm, saveBadge,
  moderationQueue, setPhotoHidden, setCommentHidden, allUsersForAdmin, setAdminFlag,
} from '../domain/admin.js';
import { saveEmailSettings, saveSendgridKey, clearSendgridKey, sendgridKey } from '../domain/settings.js';
import {
  activeThemeRow, listMotifs, saveThemeSettings, cleanMotif, addAdminMotif, updateMotif, setMotifStatus, deleteMotif,
  listCities, cityByKey, cityById,
} from '../domain/city.js';
import { themeJob, startThemeJob } from '../domain/theme-job.js';
import { testEmail, memberEmail } from '../views/email.js';
import { createInvite, recentInvites } from '../domain/invites.js';
import { allActivities, badgeTargets, setActivityActive } from '../domain/activities.js';
import { isSuperAdmin, ideaById, badgePrefill, markBuilt } from '../domain/ideas.js';
import { EMAIL_KINDS, COPY_FIELDS, emailCopy, saveEmailCopy, resetEmailCopy, isCustomized } from '../domain/email-copy.js';
import {
  adminCity, adminEmail, adminEmailMessage, adminHome, adminParks, adminParkForm, adminImport, adminBadges, adminBadgeForm, adminModeration, adminUsers,
  adminActivities, adminStats,
} from '../views/pages/admin.js';
import { adminStats as computeStats } from '../domain/stats.js';

const MAX_CSV_BYTES = 1024 * 1024;

export default async function adminRoutes(app) {
  const { db } = app;
  const now = () => app.now();
  // ?from_idea=<id>: the super admin turns a kept badge idea into a badge (SPEC Flow 13).
  const keptIdea = (req, raw) => {
    if (!isSuperAdmin(req.user) || !/^\d+$/.test(String(raw ?? ''))) return null;
    const idea = ideaById(db, Number(raw));
    return idea?.status === 'keep' ? idea : null;
  };

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

  // Admin pages for parks, import and the city theme work on one city: ?city= (every form posts
  // back the city it showed, so another tab switching cities can't redirect a save), else the
  // current one (req.city), switched with the city bar (POST /admin/city/use).
  const pageCity = (req) => cityByKey(db, String(req.query.city || '')) || req.city;
  const cityBar = (req) => ({ city: pageCity(req), cities: listCities(db), csrf: req.csrfToken(), back: req.url.split('#')[0] });
  const cityDone = (req, done = '') => `/admin/city?${done ? `done=${done}&` : ''}city=${pageCity(req).key}`;

  function cityRoutes(r) {
    const theme = (req) => activeThemeRow(db, pageCity(req).key);
    r.post('/city/use', async (req, reply) => {
      const city = cityByKey(db, String(req.body.city || ''));
      if (!city) return reply.callNotFound();
      reply.rememberCity(city);
      return reply.redirect(safeNext(req.body.back), 303);
    });
    const show = (req, reply, extra = {}) => {
      const t = theme(req);
      if (!t) return reply.callNotFound();
      return reply.page(adminCity({
        csrf: req.csrfToken(), theme: t, motifs: listMotifs(db, t.id), job: themeJob(db, { now: now() }), cityBar: cityBar(req),
        aiAvailable: Boolean(app.themeAi?.available), ...extra,
      }));
    };
    const motifId = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);

    r.get('/city', async (req, reply) => show(req, reply, {
      notice: { saved: 'Saved.', added: 'Motif added.', approved: 'Approved. It now appears on the site.', unpublished: 'Unpublished.', deleted: 'Deleted.', started: 'Started. Drafts appear here when it finishes.' }[req.query.done] || null,
    }));
    r.post('/city/settings', async (req, reply) => {
      const t = theme(req);
      if (!t) return reply.callNotFound();
      const result = saveThemeSettings(db, t.id, { ...req.body, name: req.body.city_name }, { now: now() });
      if (result.errors) return show(req, reply.code(422), { errors: result.errors, values: result.values });
      return reply.redirect(cityDone(req, 'saved'), 303);
    });
    r.post('/city/generate', async (req, reply) => {
      const job = startThemeJob(db, app.themeAi, { now, log: req.log, cityKey: pageCity(req).key });
      if (job) app.trackJob(job);
      return reply.redirect(cityDone(req, job ? 'started' : ''), 303);
    });
    r.post('/city/motifs/new', async (req, reply) => {
      const t = theme(req);
      if (!t) return reply.callNotFound();
      const { motif, errors } = cleanMotif(req.body);
      if (errors) return show(req, reply.code(422), { motifErrors: errors, motifValues: req.body });
      addAdminMotif(db, t.id, motif, { now: now() });
      return reply.redirect(cityDone(req, 'added'), 303);
    });
    r.post('/city/motifs/:id', async (req, reply) => {
      const t = theme(req);
      const id = motifId(req);
      if (!t || !id) return reply.callNotFound();
      const field = (k) => req.body[`${k}-${id}`];
      const { motif, errors } = cleanMotif({ name: field('name'), blurb: field('blurb'), svg: field('svg') });
      if (errors) {
        return show(req, reply.code(422), { editing: { id, errors, values: { name: field('name') ?? '', blurb: field('blurb') ?? '', svg: field('svg') ?? '' } } });
      }
      if (!updateMotif(db, t.id, id, motif)) return reply.callNotFound();
      return reply.redirect(cityDone(req, 'saved'), 303);
    });
    for (const [action, fn, done] of [
      ['approve', (t, id) => setMotifStatus(db, t.id, id, 'approved'), 'approved'],
      ['unpublish', (t, id) => setMotifStatus(db, t.id, id, 'draft'), 'unpublished'],
      ['delete', (t, id) => deleteMotif(db, t.id, id), 'deleted'],
    ]) {
      r.post(`/city/motifs/:id/${action}`, async (req, reply) => {
        const t = theme(req);
        const id = motifId(req);
        if (!t || !id || !fn(t, id)) return reply.callNotFound();
        return reply.redirect(cityDone(req, done), 303);
      });
    }
  }

  function routes(r) {
    cityRoutes(r);
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
        newIdeas: one("SELECT COUNT(*) FROM badge_ideas WHERE status = 'new'"),
        checkins7: db.prepare('SELECT COUNT(*) FROM visits WHERE created_at >= ?').pluck().get(new Date(now().getTime() - 7 * 86400000).toISOString()),
      } }));
    });
    r.get('/stats', async (req, reply) => reply.page(adminStats({ stats: computeStats(db, { now: now() }) })));

    // Parks
    r.get('/parks', async (req, reply) => {
      const filter = ['needs_pin', 'inactive'].includes(req.query.filter) ? req.query.filter : '';
      return reply.page(adminParks({ parks: allParksForAdmin(db, { filter, cityId: pageCity(req).id }), filter, cityBar: cityBar(req) }));
    });
    r.get('/parks/new', async (req, reply) => reply.page(adminParkForm({ csrf: req.csrfToken(), isNew: true, cityBar: cityBar(req) })));
    r.post('/parks/new', async (req, reply) => {
      const result = saveParkFromForm(db, null, req.body, { now: now(), city: pageCity(req) });
      if (result.error) {
        reply.code(422);
        return reply.page(adminParkForm({ csrf: req.csrfToken(), isNew: true, park: formPark(req.body), error: result.error, cityBar: cityBar(req) }));
      }
      return reply.redirect(`/admin/parks/${result.park.id}?saved=1`, 303);
    });
    r.get('/parks/:id', async (req, reply) => {
      const park = parkForAdmin(db, Number(req.params.id));
      if (!park) return reply.callNotFound();
      return reply.page(adminParkForm({ csrf: req.csrfToken(), park, notice: req.query.saved ? 'Saved.' : null, center: cityById(db, park.city_id)?.center }));
    });
    r.post('/parks/:id', async (req, reply) => {
      const existing = parkForAdmin(db, Number(req.params.id));
      if (!existing) return reply.callNotFound();
      const result = saveParkFromForm(db, existing.id, req.body, { now: now() });
      if (result.error) {
        reply.code(422);
        return reply.page(adminParkForm({ csrf: req.csrfToken(), park: { ...formPark(req.body), id: existing.id, city_key: existing.city_key }, error: result.error, center: cityById(db, existing.city_id)?.center }));
      }
      return reply.redirect(`/admin/parks/${existing.id}?saved=1`, 303);
    });

    // Import
    // The current city's seed file (seed/cities/<key>/parks.csv), if its pack has one.
    const seedCsv = (city) => {
      const file = cityPackFile(city.key, 'parks.csv');
      return fs.existsSync(file) ? file : null;
    };
    r.get('/import', async (req, reply) => reply.page(adminImport({ csrf: req.csrfToken(), cityBar: cityBar(req), seedFile: Boolean(seedCsv(pageCity(req))) })));
    r.post('/import/seed', async (req, reply) => {
      const file = seedCsv(pageCity(req));
      if (!file) return reply.callNotFound();
      return reply.page(adminImport({
        csrf: req.csrfToken(), cityBar: cityBar(req), seedFile: true,
        result: importParksCsv(db, fs.readFileSync(file, 'utf8'), { now, cityId: pageCity(req).id }),
      }));
    });

    // Badges
    r.get('/badges', async (req, reply) => reply.page(adminBadges({ badges: allBadgesForAdmin(db) })));
    r.get('/badges/new', async (req, reply) => {
      const idea = keptIdea(req, req.query.from_idea);
      return reply.page(adminBadgeForm({
        csrf: req.csrfToken(), targets: badgeTargets(db), isNew: true, fromIdea: idea?.id ?? null, values: idea ? badgePrefill(idea) : null,
      }));
    });
    r.get('/badges/:id', async (req, reply) => {
      const badge = badgeForAdmin(db, Number(req.params.id));
      if (!badge) return reply.callNotFound();
      return reply.page(adminBadgeForm({ csrf: req.csrfToken(), targets: badgeTargets(db), badge, notice: req.query.saved ? 'Saved.' : null }));
    });

    // Healthy activities: wording comes from seed/activities.json; admins switch them on or off.
    r.get('/activities', async (req, reply) => reply.page(adminActivities({ activities: allActivities(db), csrf: req.csrfToken() })));
    r.post('/activities/:id', async (req, reply) => {
      const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : null;
      const activity = id && setActivityActive(db, id, req.body.active === '1');
      if (!activity) return reply.callNotFound();
      return reply.redirect(`/admin/activities#act-${activity.slug}`, 303);
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
      key: sendgridKey(db, app.secretBox, { envKey: app.config.sendgridEnvKey || '' }), me: req.user,
      messages: Object.entries(EMAIL_KINDS).map(([kind, def]) => ({
        kind, label: def.label, subject: app.emailSettings()[def.subjectKey], customized: isCustomized(db, kind),
      })), ...extra,
    });

    // Admin › Email › Messages: the wording of each member email, with a preview.
    const copyOf = (kind) => ({ ...emailCopy(db, kind), subject: app.emailSettings()[EMAIL_KINDS[kind].subjectKey] });
    const sample = (req, kind, copy) => memberEmail({
      kind, copy, baseUrl: app.config.baseUrl, tagline: app.theme().tagline, name: req.user.display_name, inviter: req.user.display_name, url: `${app.config.baseUrl}/`,
    });
    const messagePage = (req, kind, extra = {}) => {
      const copy = copyOf(kind);
      return adminEmailMessage({
        csrf: req.csrfToken(), kind, def: EMAIL_KINDS[kind], fields: COPY_FIELDS, values: copy, me: req.user,
        previewHtml: sample(req, kind, copy).html, customized: isCustomized(db, kind), ...extra,
      });
    };
    const kindOf = (req) => (Object.hasOwn(EMAIL_KINDS, req.params.kind) ? req.params.kind : null);
    r.get('/email/messages/:kind', async (req, reply) => {
      const kind = kindOf(req);
      if (!kind) return reply.callNotFound();
      const notice = { saved: 'Saved. New emails use this wording.', reset: 'Back to the default wording.' }[req.query.done] || null;
      return reply.page(messagePage(req, kind, { notice }));
    });
    r.post('/email/messages/:kind', async (req, reply) => {
      const kind = kindOf(req);
      if (!kind) return reply.callNotFound();
      const result = saveEmailCopy(db, kind, req.body, { now: now() });
      if (result.errors) return reply.code(422).page(messagePage(req, kind, { errors: result.errors, values: result.values }));
      return reply.redirect(`/admin/email/messages/${kind}?done=saved`, 303);
    });
    r.post('/email/messages/:kind/reset', async (req, reply) => {
      const kind = kindOf(req);
      if (!kind) return reply.callNotFound();
      resetEmailCopy(db, kind);
      return reply.redirect(`/admin/email/messages/${kind}?done=reset`, 303);
    });
    r.post('/email/messages/:kind/send', async (req, reply) => {
      const kind = kindOf(req);
      if (!kind) return reply.callNotFound();
      const msg = sample(req, kind, copyOf(kind));
      try {
        await app.mailer.send({ to: req.user.email, ...msg, subject: `[Preview] ${msg.subject}` });
        return reply.page(messagePage(req, kind, { notice: `Preview sent to ${req.user.email}.` }));
      } catch (err) {
        req.log.warn({ err: err.message }, 'preview email failed');
        return reply.code(502).page(messagePage(req, kind, { sendError: `Sending failed: ${err.message}` }));
      }
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
          ...testEmail({ baseUrl: app.config.baseUrl, tagline: app.theme().tagline, fromName: s.mail_from_name, fromAddress: s.mail_from_address }),
        });
        return reply.page(emailPage(req, { notice: `Test email sent to ${req.user.email}. Check the inbox (and spam).` }));
      } catch (err) {
        req.log.warn({ err: err.message }, 'test email failed');
        return reply.code(502).page(emailPage(req, { testError: `Sending failed: ${err.message}${err.detail ? ` (${err.detail})` : ''}` }));
      }
    });

    // Members
    const usersPage = (req, extra = {}) => adminUsers({
      users: allUsersForAdmin(db), csrf: req.csrfToken(), me: req.user, invites: recentInvites(db), ...extra,
    });
    r.get('/users', async (req, reply) => reply.page(usersPage(req, {
      notice: { invited: 'Invite sent.' }[req.query.done] || (req.query.done ? 'Saved.' : null),
    })));
    // Invite by email: records the invite, then sends the branded invitation with a /join link.
    r.post('/invites', async (req, reply) => {
      const result = createInvite(db, { email: req.body.invite_email, name: req.body.invite_name, inviter: req.user }, { now: now() });
      if (result.error) return reply.code(422).page(usersPage(req, { inviteError: result.error, inviteValues: result.values }));
      const msg = memberEmail({
        kind: 'invite', copy: copyOf('invite'), baseUrl: app.config.baseUrl, tagline: app.theme().tagline,
        name: result.invite.name || 'there', inviter: req.user.display_name, city: req.city.copy.short,
        url: `${app.config.baseUrl}/join/${result.token}?city=${req.city.key}`, // opens in the admin's current city
      });
      try {
        await app.mailer.send({ to: result.invite.email, ...msg });
      } catch (err) {
        req.log.warn({ err: err.message }, 'invite email failed');
        db.prepare('DELETE FROM invites WHERE id = ?').run(result.invite.id); // so it can be retried right away
        return reply.code(502).page(usersPage(req, { inviteError: `The invite couldn't be sent: ${err.message}`, inviteValues: result.invite }));
      }
      return reply.redirect('/admin/users?done=invited', 303);
    });
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
      // Imports into the current city (the city bar on the page).
      const view = { csrf, cityBar: cityBar(req), seedFile: fs.existsSync(cityPackFile(pageCity(req).key, 'parks.csv')) };
      if (!file?.length) return reply.code(422).page(adminImport({ ...view, error: 'Choose a CSV file.' }));
      if (file.length > MAX_CSV_BYTES) return reply.code(422).page(adminImport({ ...view, error: 'The CSV must be under 1 MB.' }));
      return reply.page(adminImport({ ...view, result: importParksCsv(db, file.toString('utf8'), { now, cityId: pageCity(req).id }) }));
    });

    const saveBadgeRoute = async (req, reply, existing) => {
      const isNew = !existing;
      const values = { ...req.body };
      delete values.art_file;
      const { badge, errors = {} } = validateBadgeForm(values, { isNew, targets: badgeTargets(db).map((t) => t.value) });
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
        return reply.page(adminBadgeForm({ csrf: req.csrfToken(), targets: badgeTargets(db), isNew, badge: existing, errors, values, fromIdea: keptIdea(req, values.from_idea)?.id ?? null }));
      }
      // No new emoji typed: keep an existing uploaded image.
      if (art) badge.art = art;
      else if (!String(values.art || '').trim() && existing?.art?.startsWith('upload:')) badge.art = existing.art;
      const saved = saveBadge(db, existing?.id ?? null, badge, { now: now() });
      if (saved.error === 'slug_taken') {
        if (art) await removeBadgeArt(app.config.uploadsDir, art);
        reply.code(422);
        return reply.page(adminBadgeForm({ csrf: req.csrfToken(), targets: badgeTargets(db), isNew, badge: existing, errors: { slug: 'Another badge already uses that slug.' }, values, fromIdea: keptIdea(req, values.from_idea)?.id ?? null }));
      }
      // Replaced art: remove the old file.
      if (existing?.art?.startsWith('upload:') && saved.art !== existing.art) await removeBadgeArt(app.config.uploadsDir, existing.art);
      const idea = isNew && keptIdea(req, values.from_idea);
      if (idea) markBuilt(db, idea.id, saved.id, { now: now() });
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
    checkin_radius_m: body.checkin_radius_m, loop_mi: body.loop_mi, city_url: body.city_url, active: body.active === '1' ? 1 : 0,
    needs_pin: body.needs_pin === '1' ? 1 : 0, categories: [].concat(body.categories || []),
  };
}
