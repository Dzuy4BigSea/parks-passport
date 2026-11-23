import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from './views/html.js';
import { layout } from './views/layout.js';
import { homePage, privacyPage } from './views/pages/static.js';
import { countActiveParks } from './domain/parks.js';
import { authPlugin, requireUser } from './lib/auth.js';
import parkRoutes from './routes/parks.js';
import authRoutes from './routes/auth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Builds the app with injected dependencies so tests can supply a temp DB, mailer, clock, etc.
 * config: { baseUrl, secureCookies }
 */
export function buildApp({
  db, mailer, now = () => new Date(), logger = false,
  config = { baseUrl: 'http://localhost:8080', secureCookies: false },
} = {}) {
  if (!db) throw new Error('buildApp needs a db');
  if (!mailer) throw new Error('buildApp needs a mailer');
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 1024 * 1024 });

  app.decorate('db', db);
  app.decorate('mailer', mailer);
  app.decorate('now', now);
  app.decorate('config', config);
  // Hook for removing a user's stored files before their rows are deleted (photos, M7).
  app.decorate('beforeUserDelete', async () => {});
  app.addHook('onClose', async () => db.close());

  app.register(formbody);
  app.register(cookie);
  app.register(authPlugin, { db, now, secureCookies: config.secureCookies });
  app.register(fastifyStatic, {
    root: path.join(ROOT, 'public'), prefix: '/', index: false, wildcard: false, maxAge: '1h',
  });
  app.register(fastifyStatic, {
    root: path.join(ROOT, 'node_modules', 'leaflet', 'dist'), prefix: '/vendor/leaflet/',
    decorateReply: false, maxAge: '30d', immutable: true,
  });

  // reply.page({ title, body, status?, ... }) renders a full HTML page in the layout.
  app.decorateReply('page', function page(view) {
    if (view.status) this.code(view.status);
    const req = this.request;
    return this.type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(String(layout({ ...view, user: req.user, csrf: req.csrfToken() })));
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
  // Placeholder until M5 builds the passport page.
  app.get('/passport', { preHandler: requireUser }, async (req, reply) => reply.page({
    title: 'My passport', current: 'passport',
    body: html`<h1>${req.user.display_name}'s passport</h1><p>Your stamps will appear here.</p>`,
  }));
  app.register(parkRoutes);
  app.register(authRoutes);

  app.setNotFoundHandler((req, reply) => {
    reply.code(404);
    return reply.page({ title: 'Not found', body: html`<h1>Page not found</h1><p><a href="/parks">Browse all parks</a></p>` });
  });

  return app;
}
