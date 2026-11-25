import multipart from '@fastify/multipart';
import { html } from '../views/html.js';
import { MAX_UPLOAD_BYTES } from './images.js';

// Uploads in progress across the app. Each holds its whole file (up to 10 MB) in memory while it
// waits for image processing, which runs one at a time, so more than a few at once could push
// the 512 MB container over its limit. Extra uploads get a "busy, try again" page.
export const MAX_ACTIVE_UPLOADS = 3;
let active = 0;
export const activeUploads = () => active;

/**
 * Registers multipart parsing on an encapsulated scope, so only the routes inside it accept
 * uploads; every other POST rejects multipart with 415 before reading the body.
 * Fields land in req.body as strings and the file as a Buffer, so the CSRF check and the
 * handlers treat these forms like any other. The limit is slightly above 10 MB so storePhoto can
 * give a friendly "over 10 MB" message.
 */
export async function withUploads(app, routes) {
  app.register(async (scope) => {
    // Runs before the body is read, so a refused upload costs no memory.
    scope.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'POST') return;
      // Only requests carrying a file count (an honor stamp without a photo is a few hundred bytes).
      const length = Number(req.headers['content-length']);
      if (Number.isFinite(length) && length < 256 * 1024) return;
      if (active >= MAX_ACTIVE_UPLOADS) {
        reply.code(503).header('Retry-After', '5');
        return reply.page({
          title: 'Busy',
          body: html`<div class="narrow"><h1>Lots of uploads right now</h1>
<p role="alert">We couldn't take your photo this second. Go back and send it again in a moment.</p></div>`,
        });
      }
      active++;
      let released = false;
      reply.raw.once('close', () => { if (!released) { released = true; active--; } });
    });
    await scope.register(multipart, {
      attachFieldsToBody: 'keyValues',
      // fields: the admin badge form sends every rule setting (24 today), and the nonprofit form a
      // checkbox per ticked park (a city has up to ~150); room to grow.
      limits: { fileSize: MAX_UPLOAD_BYTES + 1024 * 1024, files: 1, fields: 400, fieldSize: 64 * 1024 },
    });
    routes(scope);
  });
}
