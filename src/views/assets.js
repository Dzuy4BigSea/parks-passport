import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Asset URLs that change when the file does (/css/app.css?v=1a2b3c4d), so a deploy reaches every
// browser at once instead of after the static files' 1-hour cache runs out. Hashed once per file
// per process: files only change with a deploy, which restarts the app.
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const seen = new Map();

export function asset(url) {
  if (!seen.has(url)) {
    let v = '';
    try {
      v = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC, url.split('?')[0]))).digest('hex').slice(0, 10);
    } catch { /* not a file in public/: leave the URL as it is */ }
    seen.set(url, v && !url.includes('?') ? `${url}?v=${v}` : url);
  }
  return seen.get(url);
}

/**
 * An import map sending every plain /js/… module URL to its versioned one, so a script that's both
 * on the page (versioned src) and imported by another script ('./message.js') loads once, fresh.
 */
let map = null;
export function importMap() {
  if (!map) {
    let files = [];
    try { files = fs.readdirSync(path.join(PUBLIC, 'js')).filter((f) => f.endsWith('.js')); } catch { /* no scripts */ }
    map = JSON.stringify({ imports: Object.fromEntries(files.map((f) => [`/js/${f}`, asset(`/js/${f}`)])) });
  }
  return map;
}
