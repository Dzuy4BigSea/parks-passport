import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const FULL_EDGE = 2000;
export const THUMB_EDGE = 400;
// 50 MP covers 48 MP phone cameras and stops "decompression bombs" (tiny files, huge pixels).
export const MAX_INPUT_PIXELS = 50_000_000;
const SHARP_OPTS = { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS };
const NOT_A_PHOTO = 'That file is not a photo we can read. Use a JPEG, PNG, WebP or HEIC image.';
const WRONG_TYPE = 'Use a JPEG, PNG, WebP or HEIC image.';
const TOO_BIG_PIXELS = 'That photo is too large (over 50 megapixels).';

// Formats accepted, judged by the file's content (sharp's decoder), not its name or MIME type.
// HEIC (iPhone photos) is decoded separately: sharp's prebuilt binary has no HEVC decoder.
const ACCEPTED = new Set(['jpeg', 'png', 'webp']);

/**
 * Checks an upload and returns { open } (a function giving a fresh sharp pipeline, upright) or
 * { error }. Size and pixel count are checked before any full decode.
 */
async function openImage(buffer) {
  if (!buffer?.length) return { error: 'Choose a photo to upload.' };
  if (buffer.length > MAX_UPLOAD_BYTES) return { error: 'That photo is over 10 MB. Try a smaller one.' };
  if (isHeic(buffer)) return openHeic(buffer);
  let meta;
  try {
    // Header only (no pixel decode), so no limit is needed here; the size check follows.
    meta = await sharp(buffer, { failOn: 'error', limitInputPixels: false }).metadata();
  } catch {
    return { error: NOT_A_PHOTO };
  }
  if (!ACCEPTED.has(meta.format)) return { error: WRONG_TYPE };
  if ((meta.width || 0) * (meta.height || 0) > MAX_INPUT_PIXELS) return { error: TOO_BIG_PIXELS };
  // .rotate() applies the EXIF orientation before the metadata is dropped.
  return { open: () => sharp(buffer, SHARP_OPTS).rotate() };
}

// HEIC (iPhone photos): a worker decodes it and hands back an upright JPEG at most FULL_EDGE px
// (see heic-worker.js). That JPEG then goes through the usual path, which drops all metadata.
async function openHeic(buffer) {
  const result = await new Promise((resolve) => {
    const worker = new Worker(new URL('./heic-worker.js', import.meta.url), {
      workerData: { buffer, maxPixels: MAX_INPUT_PIXELS, edge: FULL_EDGE },
    });
    worker.once('message', (msg) => { resolve(msg); worker.terminate(); });
    worker.once('error', () => resolve({ failed: true }));
    worker.once('exit', () => resolve({ failed: true })); // no-op once resolved
  });
  if (result.tooBig) return { error: TOO_BIG_PIXELS };
  if (result.failed || !result.jpeg) return { error: NOT_A_PHOTO };
  const jpeg = Buffer.from(result.jpeg.buffer, result.jpeg.byteOffset, result.jpeg.byteLength);
  return { open: () => sharp(jpeg, SHARP_OPTS) };
}

sharp.cache(false); // keep memory low in the 512 MB container
sharp.concurrency(1);

// One image at a time: decoding is memory-hungry and the container has 512 MB.
let queue = Promise.resolve();
export function storePhoto(buffer, uploadsDir) {
  const run = queue.then(() => storePhotoNow(buffer, uploadsDir));
  queue = run.catch(() => {});
  return run;
}

/**
 * Validates an uploaded image and writes a re-encoded full-size JPEG (max 2000 px on the long
 * edge) and a 400 px thumbnail. Re-encoding drops all metadata, including EXIF GPS.
 * Returns { fileKey, width, height } or { error }.
 */
async function storePhotoNow(buffer, uploadsDir) {
  const img = await openImage(buffer);
  if (img.error) return img;

  const fileKey = `${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(16).toString('hex')}`;
  const full = path.join(uploadsDir, `${fileKey}.jpg`);
  const thumb = path.join(uploadsDir, `${fileKey}.thumb.jpg`);
  await fs.mkdir(path.dirname(full), { recursive: true });

  // A truncated or corrupt file only fails here, at decode: clean up and report it inline.
  try {
    const base = img.open().flatten({ background: '#ffffff' });
    const info = await base.clone()
      .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(full);
    await base.clone()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'cover' })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(thumb);
    return { fileKey, width: info.width, height: info.height };
  } catch {
    await removePhotoFiles(uploadsDir, fileKey);
    return { error: NOT_A_PHOTO };
  }
}

export const photoPath = (uploadsDir, fileKey, size) =>
  path.join(uploadsDir, `${fileKey}${size === 'thumb' ? '.thumb' : ''}.jpg`);

export async function removePhotoFiles(uploadsDir, fileKey) {
  await Promise.all(['full', 'thumb'].map((s) => fs.rm(photoPath(uploadsDir, fileKey, s), { force: true })));
}

// Profile photos: a 256 px square JPEG (center crop), re-encoded so no metadata survives.
// Same checks and the same one-at-a-time queue as park photos. Returns { key } or { error }.
export const AVATAR_EDGE = 256;
export const avatarPath = (uploadsDir, key) => path.join(uploadsDir, 'avatars', `${key}.jpg`);
export const AVATAR_KEY_RE = /^[a-f0-9]{32}$/;

export function storeAvatar(buffer, uploadsDir) {
  const run = queue.then(() => storeAvatarNow(buffer, uploadsDir));
  queue = run.catch(() => {});
  return run;
}

async function storeAvatarNow(buffer, uploadsDir) {
  const img = await openImage(buffer);
  if (img.error) return img;
  const key = crypto.randomBytes(16).toString('hex');
  const file = avatarPath(uploadsDir, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await img.open().flatten({ background: '#ffffff' })
      .resize({ width: AVATAR_EDGE, height: AVATAR_EDGE, fit: 'cover', position: 'attention' })
      .jpeg({ quality: 80, mozjpeg: true }).toFile(file);
    return { key };
  } catch {
    await fs.rm(file, { force: true });
    return { error: NOT_A_PHOTO };
  }
}

export async function removeAvatar(uploadsDir, key) {
  if (AVATAR_KEY_RE.test(String(key || ''))) await fs.rm(avatarPath(uploadsDir, key), { force: true });
}

// ISO-BMFF "ftyp" box with a HEIC/HEIF brand.
function isHeic(buf) {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  return ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(buf.toString('ascii', 8, 12));
}

// Badge art: an uploaded SVG or PNG is rasterized to a 128 px PNG. Re-rendering means an
// uploaded SVG can never carry script. Returns { key } or { error }.
export const BADGE_ART_MAX_BYTES = 512 * 1024;
export async function storeBadgeArt(buffer, uploadsDir) {
  if (!buffer?.length) return { error: 'Choose an image.' };
  if (buffer.length > BADGE_ART_MAX_BYTES) return { error: 'Badge art must be under 512 KB.' };
  let meta;
  try {
    meta = await sharp(buffer, { failOn: 'error', limitInputPixels: false }).metadata();
  } catch {
    return { error: 'Use an SVG or PNG image.' };
  }
  if (!['svg', 'png'].includes(meta.format)) return { error: 'Use an SVG or PNG image.' };
  if ((meta.width || 0) * (meta.height || 0) > 16_000_000) return { error: 'That image is too large.' };
  const key = crypto.randomBytes(12).toString('hex');
  const file = path.join(uploadsDir, 'badges', `${key}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await sharp(buffer, SHARP_OPTS).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(file);
  } catch {
    await fs.rm(file, { force: true });
    return { error: 'Use an SVG or PNG image.' };
  }
  return { key };
}

export const badgeArtPath = (uploadsDir, key) => path.join(uploadsDir, 'badges', `${key}.png`);

// art is "upload:<key>"; anything else (an emoji) has no file.
export async function removeBadgeArt(uploadsDir, art) {
  const m = /^upload:([a-f0-9]{24})$/.exec(String(art || ''));
  if (m) await fs.rm(badgeArtPath(uploadsDir, m[1]), { force: true });
}

// ---------- Nonprofit ads (SPEC Flow 25) ----------
// One size, 300×250, stored at 2x (600×500) as WebP. Animated GIF/WebP stay animated (frames
// capped) with a still first frame for reduced motion. Re-encoding drops all metadata.
export const AD_W = 600;
export const AD_H = 500;
const AD_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
const AD_MAX_FRAMES = 120;
const NOT_AN_AD = 'Use a JPEG, PNG, WebP or GIF image.';

export const adImagePath = (uploadsDir, key, still = false) => path.join(uploadsDir, 'ads', `${key}${still ? '.still' : ''}.webp`);

export function storeAdImage(buffer, uploadsDir) {
  const run = queue.then(() => storeAdImageNow(buffer, uploadsDir));
  queue = run.catch(() => {});
  return run;
}

async function storeAdImageNow(buffer, uploadsDir) {
  if (!buffer?.length) return { error: 'Choose an image.' };
  if (buffer.length > MAX_UPLOAD_BYTES) return { error: 'That image is over 10 MB. Try a smaller one.' };
  let meta;
  try {
    meta = await sharp(buffer, { failOn: 'error', limitInputPixels: false, animated: true }).metadata();
  } catch {
    return { error: NOT_AN_AD };
  }
  if (!AD_FORMATS.has(meta.format)) return { error: NOT_AN_AD };
  const pages = meta.pages || 1;
  const frameH = meta.pageHeight || meta.height || 0;
  if ((meta.width || 0) < 300 || frameH < 250) return { error: 'Use an image at least 300×250 pixels.' };
  if (pages > AD_MAX_FRAMES) return { error: `That animation has too many frames (over ${AD_MAX_FRAMES}).` };
  if ((meta.width || 0) * frameH * pages > MAX_INPUT_PIXELS) return { error: 'That image is too large.' };
  const animated = pages > 1;
  const key = crypto.randomBytes(12).toString('hex');
  const file = adImagePath(uploadsDir, key);
  const still = adImagePath(uploadsDir, key, true);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const opts = { ...SHARP_OPTS, limitInputPixels: false };
  try {
    await sharp(buffer, { ...opts, animated }).resize(AD_W, AD_H, { fit: 'cover' }).webp({ quality: 82 }).toFile(file);
    if (animated) await sharp(buffer, { ...opts, pages: 1 }).resize(AD_W, AD_H, { fit: 'cover' }).webp({ quality: 82 }).toFile(still);
  } catch {
    await fs.rm(file, { force: true });
    await fs.rm(still, { force: true });
    return { error: NOT_AN_AD };
  }
  return { key, animated };
}

export async function removeAdImage(uploadsDir, key) {
  if (!/^[a-f0-9]{24}$/.test(String(key))) return;
  await fs.rm(adImagePath(uploadsDir, key), { force: true });
  await fs.rm(adImagePath(uploadsDir, key, true), { force: true });
}
