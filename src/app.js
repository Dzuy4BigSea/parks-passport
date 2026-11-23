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
import parkRoutes from './routes/parks.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Builds the app with injected dependencies so tests can supply a temp DB, clock, etc.
export function buildApp({ db, logger = false } = {}) {
  if (!db) throw new Error('buildApp needs a db');
  const app = Fastify({ logger, trustProxy: true });

  app.register(formbody);
  app.register(cookie);
  app.register(fastifyStatic, {
    root: path.join(ROOT, 'public'), prefix: '/', index: false, wildcard: false,
    maxAge: '1h',
  });
  app.register(fastifyStatic, {
    root: path.join(ROOT, 'node_modules', 'leaflet', 'dist'), prefix: '/vendor/leaflet/',
    decorateReply: false, maxAge: '30d', immutable: true,
  });

  app.decorate('db', db);
  app.addHook('onClose', async () => db.close());

  // reply.page({ title, body, ... }) renders a full HTML page in the layout.
  app.decorateReply('page', function page(view) {
    return this.type('text/html; charset=utf-8').send(String(layout(view)));
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

  app.setNotFoundHandler((req, reply) => {
    reply.code(404);
    return reply.page({ title: 'Not found', body: html`<h1>Page not found</h1><p><a href="/parks">Browse all parks</a></p>` });
  });

  return app;
}
