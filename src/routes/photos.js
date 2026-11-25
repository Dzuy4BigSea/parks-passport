import fs from 'node:fs';
import { markMilestone } from '../domain/milestones.js';
import { requireUser, safeNext } from '../lib/auth.js';
import { parkPath } from '../views/urls.js';
import { urlPark } from './city-params.js';
import { storePhoto, photoPath, removePhotoFiles } from '../lib/images.js';
import { addPhoto, getPhoto, canSeePhoto, updatePhoto, deletePhoto, todaysVisitAt } from '../domain/photos.js';
import { saveRating, deleteRating } from '../domain/ratings.js';
import { awardBadges } from '../domain/badges/index.js';
import { renderParkPage } from './park-view.js';
import { withUploads } from '../lib/uploads.js';

const fileOf = (body, name) => (Buffer.isBuffer(body?.[name]) ? body[name] : null);
const str = (v, max = 1000) => (typeof v === 'string' ? v.slice(0, max) : '');

export default async function photoRoutes(app) {
  const { db } = app;
  const uploadsDir = app.config.uploadsDir;
  const badgeOpts = () => ({ now: app.now(), random: app.random });

  // Upload a photo to a park (not tied to a stamp). The only photo route that takes uploads.
  withUploads(app, (scope) => scope.post('/:city/parks/:slug/photos', { preHandler: requireUser }, async (req, reply) => {
    const park = urlPark(db, req);
    if (!park) return reply.callNotFound();
    const caption = str(req.body.caption, 400);
    const stored = await storePhoto(fileOf(req.body, 'photo'), uploadsDir);
    if (stored.error) {
      return renderParkPage(app, req, reply, park, { problem: { text: stored.error, area: 'photo', values: { caption } } });
    }
    let photo;
    try {
      // A photo taken on a day you stamped this park counts toward that stamp (+3).
      const visitId = todaysVisitAt(db, req.user.id, park.id, app.now());
      photo = addPhoto(db, { user: req.user, park, visitId, stored, caption, visibility: str(req.body.visibility) }, { now: app.now() });
    } catch (err) {
      await removePhotoFiles(uploadsDir, stored.fileKey);
      throw err;
    }
    markMilestone(db, req.user.id, 'photo', { now: app.now() });
    awardBadges(db, req.user.id, { type: 'photo', id: photo.id }, badgeOpts());
    app.track(req.user.id, 'photo_upload', { park_slug: park.slug });
    return reply.redirect(parkPath(park, '?photo=added#photos'), 303);
  }));

  // Serve a photo only to viewers allowed to see it; everyone else gets 404.
  app.get('/photos/:id/:size', async (req, reply) => {
    const { size } = req.params;
    if (size !== 'full' && size !== 'thumb') return reply.callNotFound();
    const photo = getPhoto(db, Number(req.params.id));
    if (!photo || !canSeePhoto(db, req.user, photo)) return reply.callNotFound();
    const file = photoPath(uploadsDir, photo.file_key, size);
    if (!fs.existsSync(file)) return reply.callNotFound();
    const shared = photo.visibility === 'public' && !photo.hidden;
    return reply.type('image/jpeg')
      .header('Cache-Control', shared ? 'public, max-age=300' : 'private, no-store') // short: may be made private later
      .header('X-Content-Type-Options', 'nosniff')
      .send(fs.createReadStream(file));
  });

  app.post('/photos/:id', { preHandler: requireUser }, async (req, reply) => {
    const photo = updatePhoto(db, { user: req.user, photoId: Number(req.params.id),
      caption: typeof req.body.caption === 'string' ? req.body.caption.slice(0, 400) : undefined,
      visibility: str(req.body.visibility) });
    if (!photo) return reply.callNotFound();
    return reply.redirect(safeNext(req.body.back), 303);
  });

  app.post('/photos/:id/delete', { preHandler: requireUser }, async (req, reply) => {
    const photo = deletePhoto(db, { user: req.user, photoId: Number(req.params.id) }, { now: app.now() });
    if (!photo) return reply.callNotFound();
    await removePhotoFiles(uploadsDir, photo.file_key);
    return reply.redirect(safeNext(req.body.back), 303);
  });

  // Ratings: one per user per park; posting again updates it.
  app.post('/:city/parks/:slug/rating', { preHandler: requireUser }, async (req, reply) => {
    const park = urlPark(db, req);
    if (!park) return reply.callNotFound();
    const result = saveRating(db, { user: req.user, park, stars: req.body.stars, comment: str(req.body.comment, 2000),
      visibility: str(req.body.visibility) }, { now: app.now() });
    if (result.error) {
      return renderParkPage(app, req, reply, park, { problem: { text: result.error, area: 'rating', values: { comment: str(req.body.comment, 2000) } } });
    }
    markMilestone(db, req.user.id, 'rating', { now: app.now() });
    awardBadges(db, req.user.id, { type: 'rating', id: result.rating.id }, badgeOpts());
    app.track(req.user.id, 'rating_submit', { park_slug: park.slug, stars: result.rating.stars });
    return reply.redirect(parkPath(park, '?rated=1#ratings'), 303);
  });

  app.post('/:city/parks/:slug/rating/delete', { preHandler: requireUser }, async (req, reply) => {
    const park = urlPark(db, req);
    if (!park || !deleteRating(db, { user: req.user, park })) return reply.callNotFound();
    return reply.redirect(parkPath(park, '#ratings'), 303);
  });
}
