import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const FULL_EDGE = 2000;
export const THUMB_EDGE = 400;

// Formats accepted, judged by the file's content (sharp's decoder), not its name or MIME type.
const ACCEPTED = new Set(['jpeg', 'png', 'webp']);

sharp.cache(false); // keep memory low in the 512 MB container
sharp.concurrency(1);

/**
 * Validates an uploaded image and writes a re-encoded full-size JPEG (max 2000 px on the long
 * edge) and a 400 px thumbnail. Re-encoding drops all metadata, including EXIF GPS.
 * Returns { fileKey, width, height } or { error }.
 */
export async function storePhoto(buffer, uploadsDir) {
  if (!buffer?.length) return { error: 'Choose a photo to upload.' };
  if (buffer.length > MAX_UPLOAD_BYTES) return { error: 'That photo is over 10 MB. Try a smaller one.' };
  let meta;
  try {
    meta = await sharp(buffer, { failOn: 'error' }).metadata();
  } catch {
    if (isHeic(buffer)) return { error: "HEIC photos can't be read here. Upload it from your phone's browser (it converts to JPEG) or export it as JPEG." };
    return { error: 'That file is not a photo we can read. Use a JPEG, PNG or WebP image.' };
  }
  if (!ACCEPTED.has(meta.format)) return { error: 'Use a JPEG, PNG or WebP image.' };

  const fileKey = `${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(16).toString('hex')}`;
  const full = path.join(uploadsDir, `${fileKey}.jpg`);
  const thumb = path.join(uploadsDir, `${fileKey}.thumb.jpg`);
  await fs.mkdir(path.dirname(full), { recursive: true });

  // .rotate() applies the EXIF orientation before the metadata is dropped.
  const base = sharp(buffer, { failOn: 'error' }).rotate().flatten({ background: '#ffffff' });
  const info = await base.clone()
    .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(full);
  await base.clone()
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'cover' })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(thumb);
  return { fileKey, width: info.width, height: info.height };
}

export const photoPath = (uploadsDir, fileKey, size) =>
  path.join(uploadsDir, `${fileKey}${size === 'thumb' ? '.thumb' : ''}.jpg`);

export async function removePhotoFiles(uploadsDir, fileKey) {
  await Promise.all(['full', 'thumb'].map((s) => fs.rm(photoPath(uploadsDir, fileKey, s), { force: true })));
}

// ISO-BMFF "ftyp" box with a HEIC/HEIF brand.
function isHeic(buf) {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  return ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(buf.toString('ascii', 8, 12));
}
