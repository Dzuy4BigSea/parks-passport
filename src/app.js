import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from './views/html.js';
import { layout } from './views/layout.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Builds the app with injected dependencies so tests can supply a temp DB, clock, etc.
export function buildApp({ db, logger = false } = {}) {
  if (!db) throw new Error('buildApp needs a db');
  const app = Fastify({ logger, trustProxy: true });

  app.register(formbody);
  app.register(cookie);
  app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/', index: false, wildcard: false });

  app.decorate('db', db);
  app.addHook('onClose', async () => db.close());

  const sendPage = (reply, page) => reply.type('text/html; charset=utf-8').send(String(layout(page)));

  app.get('/healthz', async (req, reply) => {
    try {
      db.prepare('SELECT 1').get();
      return reply.type('text/plain').send('ok');
    } catch {
      return reply.code(503).type('text/plain').send('db unavailable');
    }
  });

  app.get('/', async (req, reply) => sendPage(reply, {
    title: null,
    body: html`<section class="hero">
  <h1>Your passport to St. Pete parks</h1>
  <p>Stamp every park you visit, collect badges, and explore with your Park Pals.</p>
</section>`,
  }));

  app.setNotFoundHandler((req, reply) => {
    reply.code(404);
    return sendPage(reply, { title: 'Not found', body: html`<h1>Page not found</h1><p><a href="/">Go home</a></p>` });
  });

  return app;
}
