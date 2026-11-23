import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { removePhotoFiles } from './lib/images.js';
import { fileKeysForUser } from './domain/photos.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from './views/html.js';
import { layout } from './views/layout.js';
import { homePage, privacyPage } from './views/pages/static.js';
import { countActiveParks } from './domain/parks.js';
import { takeUnseenBadges } from './domain/badges/index.js';
import { emailSettings } from './domain/settings.js';
import { buildEvent, queueEvent, takeEvents, parseConsent, CONSENT_COOKIE } from './lib/analytics.js';
import consentRoutes from './routes/consent.js';
import { totalPoints } from './domain/points.js';
import { levelFor } from './domain/levels.js';
import { authPlugin } from './lib/auth.js';
import parkRoutes from './routes/parks.js';
import authRoutes from './routes/auth.js';
import visitRoutes from './routes/visits.js';
import passportRoutes from './routes/passport.js';
import palRoutes from './routes/pals.js';
import photoRoutes from './routes/photos.js';
import adminRoutes from './routes/admin.js';
import { shareNudge } from './views/pages/pals.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Builds the app with injected dependencies so tests can supply a temp DB, mailer, clock, etc.
 * config: { baseUrl, secureCookies, uploadsDir }
 */
export function buildApp({
  db, mailer, secretBox = null, now = () => new Date(), random = Math.random, logger = false,
  config = { baseUrl: 'http://localhost:8080', secureCookies: false, uploadsDir: './data/uploads' },
} = {}) {
  if (!db) throw new Error('buildApp needs a db');
  if (!mailer) throw new Error('buildApp needs a mailer');
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 1024 * 1024 });

  app.decorate('db', db);
  app.decorate('mailer', mailer);
  app.decorate('now', now);
  app.decorate('random', random); // injectable for lucky badges in tests
  app.decorate('config', config);
  app.decorate('secretBox', secretBox); // encrypts the admin-saved SendGrid key
  // app.track(userId, name, params): an analytics event for the user's next page (see lib/analytics.js).
  app.decorate('track', (userId, name, params = {}) => queueEvent(db, userId, name, params, { now: now(), log: app.log }));
  app.decorate('emailSettings', () => emailSettings(db, { envFrom: config.mailFrom || '' }));
  // Removes a user's photo files before their rows are deleted (rows cascade).
  app.decorate('beforeUserDelete', async (userId) => {
    for (const key of fileKeysForUser(db, userId)) await removePhotoFiles(config.uploadsDir, key);
  });

  // Fire-and-forget email; errors are logged. Tests await app.mailIdle().
  const inflight = new Set();
  app.decorate('sendMailInBackground', (message) => {
    const p = Promise.resolve()
      .then(() => mailer.send(message))
      .catch((err) => app.log.error({ err: err.message }, 'email send failed'))
      .finally(() => inflight.delete(p));
    inflight.add(p);
  });
  app.decorate('mailIdle', () => Promise.all(inflight));
  app.addHook('onClose', async () => db.close());

  app.register(formbody);
  // Multipart (uploads) is registered only around the photo routes: see lib/uploads.js.
  app.register(cookie);
  app.register(authPlugin, { db, now, secureCookies: config.secureCookies });
  app.register(fastifyStatic, {
    root: path.join(ROOT, 'public'), prefix: '/', index: false, wildcard: false, maxAge: '1h',
  });
  app.register(fastifyStatic, {
    root: path.join(ROOT, 'node_modules', 'leaflet', 'dist'), prefix: '/vendor/leaflet/',
    decorateReply: false, maxAge: '30d', immutable: true,
  });

  // New badges and level-ups, announced once on the next page the user sees.
  function takeAnnouncements(user) {
    const badges = takeUnseenBadges(db, user.id, { now: now() });
    const level = levelFor(totalPoints(db, user.id));
    let levelUp = null;
    if (level.index > user.level_seen) {
      db.prepare('UPDATE users SET level_seen = ? WHERE id = ?').run(level.index, user.id);
      levelUp = level;
    }
    return badges.length || levelUp ? { badges, levelUp } : null;
  }

  // reply.page({ title, body, status?, ... }) renders a full HTML page in the layout.
  app.decorateReply('page', function page(view) {
    if (view.status) this.code(view.status);
    const req = this.request;
    const announcements = req.user && this.statusCode < 400 ? takeAnnouncements(req.user) : null;
    // After a stamp or a new badge, nudge a private passport towards sharing (until dismissed 3 times).
    const nudge = req.user && (announcements || view.offerShare) && req.user.default_visibility === 'private'
      && req.user.share_nudge_dismissals < 3 ? shareNudge({ csrf: req.csrfToken(), back: req.url }) : null;
    // Analytics: page events, events queued by earlier redirects, and new badges / level-ups.
    const events = [];
    const add = (name, params) => { try { events.push(buildEvent(name, params)); } catch (err) { req.log.warn(err.message); } };
    for (const [name, params] of view.events || []) add(name, params);
    if (req.user && this.statusCode < 400) events.push(...takeEvents(db, req.user.id));
    for (const b of announcements?.badges || []) add('badge_earned', { badge_slug: b.slug, kind: b.kind });
    if (announcements?.levelUp) add('level_up', { level: announcements.levelUp.name });
    const consent = parseConsent(req.cookies[CONSENT_COOKIE]);
    const path = req.url.split('#')[0];
    return this.type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(String(layout({
        ...view, user: req.user, csrf: req.csrfToken(), announcements, nudge, events, consent, path,
        analytics: config.analytics || null,
        // The banner asks only when there is something to consent to (GTM) and no choice yet.
        showConsentBanner: Boolean(config.analytics?.gtmId) && !consent.chosen && !path.startsWith('/consent'),
      })));
  });

  app.get('/healthz', async (req, reply) => {
    try {
      db.prepare('SELECT 1').get();
      return reply.type('text/plain').send('ok');
    } catch {
      return reply.code(503).type('text/plain').send('db unavailable');
    }
  });

  app.get('/', async (req, reply) => reply.page(homePage({ total: countActiveParks(db) })));
  app.get('/privacy', async (req, reply) => reply.page(privacyPage()));
  app.register(parkRoutes);
  app.register(authRoutes);
  app.register(visitRoutes);
  app.register(passportRoutes);
  app.register(palRoutes);
  app.register(photoRoutes);
  app.register(adminRoutes);
  app.register(consentRoutes);

  // Friendly HTML errors instead of Fastify's JSON (e.g. an upload over the size limit).
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    const text = status === 413 || err.code === 'FST_FILES_LIMIT'
      ? 'That upload is too big. Photos can be up to 10 MB, one at a time.'
      : status === 415 ? "This form can't take that kind of upload."
        : status < 500 ? 'Something about that request was wrong. Go back and try again.'
          : 'Something went wrong on our side. Try again in a minute.';
    reply.code(status);
    return reply.page({ title: 'Something went wrong', body: html`<h1>Sorry</h1><p>${text}</p><p><a href="/parks">Back to parks</a></p>` });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404);
    return reply.page({ title: 'Not found', body: html`<h1>Page not found</h1><p><a href="/parks">Browse all parks</a></p>` });
  });

  return app;
}
