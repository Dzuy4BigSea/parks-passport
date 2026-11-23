import { canSee, areFriends, VISIBILITY } from './visibility.js';
import { rebuildParkVisitPoints } from './points.js';

export const MAX_CAPTION = 200;

export function addPhoto(db, { user, park, visitId = null, stored, caption = '', visibility }, { now = new Date() } = {}) {
  const vis = VISIBILITY.includes(visibility) ? visibility : user.default_visibility;
  const { lastInsertRowid } = db.prepare(`INSERT INTO photos
    (user_id, park_id, visit_id, file_key, width, height, caption, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, park.id, visitId, stored.fileKey, stored.width, stored.height,
    String(caption).trim().slice(0, MAX_CAPTION), vis, now.toISOString());
  if (visitId) rebuildParkVisitPoints(db, user.id, park.id, { now }); // photo bonus
  return db.prepare('SELECT * FROM photos WHERE id = ?').get(lastInsertRowid);
}

export const getPhoto = (db, id) => db.prepare('SELECT * FROM photos WHERE id = ?').get(id);

/**
 * Whether the viewer may see this photo. Hidden photos are visible only to their owner
 * (with a label) and admins.
 */
export function canSeePhoto(db, viewer, photo) {
  if (!photo) return false;
  if (viewer?.is_admin) return true;
  if (photo.hidden) return viewer?.id === photo.user_id;
  return canSee({ viewerId: viewer?.id ?? null, ownerId: photo.user_id, visibility: photo.visibility,
    isPal: photo.visibility === 'pals' && areFriends(db, viewer?.id, photo.user_id) });
}

// Photos of a park the viewer may see, newest first.
export function photosForPark(db, viewer, parkId) {
  const rows = db.prepare(`SELECT ph.*, u.display_name, u.handle FROM photos ph JOIN users u ON u.id = ph.user_id
    WHERE ph.park_id = ? ORDER BY ph.created_at DESC, ph.id DESC LIMIT 200`).all(parkId);
  return rows.filter((p) => canSeePhoto(db, viewer, p));
}

export function updatePhoto(db, { user, photoId, caption, visibility }) {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?').get(photoId, user.id);
  if (!photo) return null;
  const vis = VISIBILITY.includes(visibility) ? visibility : photo.visibility;
  const cap = caption === undefined ? photo.caption : String(caption).trim().slice(0, MAX_CAPTION);
  db.prepare('UPDATE photos SET caption = ?, visibility = ? WHERE id = ?').run(cap, vis, photo.id);
  return getPhoto(db, photo.id);
}

// Deletes the row and returns it so the caller removes the files. Recomputes the photo bonus.
export function deletePhoto(db, { user, photoId }, { now = new Date() } = {}) {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?').get(photoId, user.id);
  if (!photo) return null;
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  if (photo.visit_id) rebuildParkVisitPoints(db, user.id, photo.park_id, { now });
  return photo;
}

export const fileKeysForUser = (db, userId) => db.prepare('SELECT file_key FROM photos WHERE user_id = ?').pluck().all(userId);
