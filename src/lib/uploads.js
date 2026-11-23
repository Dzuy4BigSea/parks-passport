import multipart from '@fastify/multipart';
import { MAX_UPLOAD_BYTES } from './images.js';

/**
 * Registers multipart parsing on an encapsulated scope, so only the routes inside it accept
 * uploads; every other POST rejects multipart with 415 before reading the body.
 * Fields land in req.body as strings and the file as a Buffer, so the CSRF check and the
 * handlers treat these forms like any other. The limit is slightly above 10 MB so storePhoto can
 * give a friendly "over 10 MB" message.
 */
export async function withUploads(app, routes) {
  app.register(async (scope) => {
    await scope.register(multipart, {
      attachFieldsToBody: 'keyValues',
      limits: { fileSize: MAX_UPLOAD_BYTES + 1024 * 1024, files: 1, fields: 20, fieldSize: 64 * 1024 },
    });
    routes(scope);
  });
}
