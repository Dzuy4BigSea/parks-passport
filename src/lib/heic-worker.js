// Turns one HEIC image into a JPEG no larger than the app keeps (FULL_EDGE), off the main thread.
// libheif (WebAssembly) blocks while it works and keeps its grown memory for the life of the
// thread, so images.js runs a fresh worker per photo and ends it afterwards, which hands that
// memory back. Only the small JPEG crosses back, so the main thread never holds the full-size
// pixels. libheif applies the file's rotation and mirroring, so the result is upright.
import { parentPort, workerData } from 'node:worker_threads';
import heicDecode from 'heic-decode';
import sharp from 'sharp';

const { buffer, maxPixels, edge } = workerData;
sharp.cache(false);
sharp.concurrency(1);

async function run() {
  let images;
  let decoded;
  try {
    images = await heicDecode.all({ buffer: Buffer.from(buffer) });
    const first = images[0];
    if (first.width * first.height > maxPixels) return { tooBig: true };
    decoded = await first.decode();
  } finally {
    images?.dispose();
  }
  const { width, height, data } = decoded;
  const jpeg = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } })
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { jpeg };
}

try {
  const result = await run();
  parentPort.postMessage(result); // the JPEG is copied: sharp's buffers can't be transferred
} catch {
  parentPort.postMessage({ failed: true });
}
