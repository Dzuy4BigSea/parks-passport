import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { MAX_UPLOAD_BYTES, removePhotoFiles } from './lib/images.js';
import { fileKeysForUser } from './domain/photos.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from './views/html.js';
import { layout } from './views/layout.js';
import { homePage, privacyPage } from './views/pages/static.js';
import { countActiveParks } from './domain/parks.js';
import { takeUnseenBadges } from './domain/badges/index.js';
import { totalPoints } from './domain/points.js';
import { levelFor } from './domain/levels.js';
import { authPlugin } from './lib/auth.js';
import parkRoutes from './routes/parks.js';
import authRoutes from './routes/auth.js';
import visitRoutes from './routes/visits.js';
import passportRoutes from './routes/passport.js';
import palRoutes from './routes/pals.js';
import photoRoutes from './routes/photos.js';
import { shareNudge } from './views/pages/pals.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Builds the app with injected dependencies so tests can supply a temp DB, mailer, clock, etc.
 * config: { baseUrl, secureCookies, uploadsDir }
 */
export function buildApp({
  db, mailer, now = () => new Date(), random = Math.random, logger = false,
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
  // Multipart fields land in req.body as strings and files as Buffers, so the CSRF check and the
  // routes treat both kinds of form the same. The slightly higher limit lets storePhoto give a
  // friendly "over 10 MB" message instead of a bare 413.
  app.register(multipart, {
    attachFieldsToBody: 'keyValues',
    limits: { fileSize: MAX_UPLOAD_BYTES + 1024 * 1024, files: 1, fields: 20, fieldSize: 64 * 1024 },
  });
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
    return this.type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(String(layout({ ...view, user: req.user, csrf: req.csrfToken(), announcements, nudge })));
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

  app.setNotFoundHandler((req, reply) => {
    reply.code(404);
    return reply.page({ title: 'Not found', body: html`<h1>Page not found</h1><p><a href="/parks">Browse all parks</a></p>` });
  });

  return app;
}
