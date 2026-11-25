// Dev-only helpers shared by the city pack seed scripts (scripts/seed-*.js): polite fetches with
// retries, HTML entity decoding, slugs, geocoding and writing a pack's parks.csv.
import fs from 'node:fs';
import path from 'node:path';
import { stringifyCsv } from '../../src/lib/csv.js';
import { PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';

export const UA = 'parks-passport-seed/1.0 (personal project)';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetches a URL (3 tries) and returns its body as text, or as JSON with { json: true }. */
export async function get(url, { json = false, ...init } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init.headers } });
      if (res.ok) return json ? await res.json() : await res.text();
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`, { cause: err });
      await sleep(1500 * attempt);
    }
  }
}

const ENTITIES = { amp: '&', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ndash: '–', mdash: '—', hellip: '…' };
/** Decodes HTML entities (named, decimal and hex) and collapses white space. */
export const decode = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
  .replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

export const slugify = (s) => decode(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const inBounds = (b, { lat, lng }) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;

/** A park's pin from OpenStreetMap by name (Nominatim, at most one request a second), or null. */
export async function osmPark(name, place, bounds) {
  const q = new URLSearchParams({ q: `${name}, ${place}`, format: 'jsonv2', limit: '5', countrycodes: 'us' });
  const hits = await get(`https://nominatim.openstreetmap.org/search?${q}`, { json: true });
  await sleep(1100);
  const hit = hits.find((h) => ['leisure', 'highway', 'natural', 'tourism'].includes(h.category)
    && inBounds(bounds, { lat: +h.lat, lng: +h.lon }));
  return hit ? { lat: +hit.lat, lng: +hit.lon } : null;
}

/** A street address's pin from the US Census geocoder, or null. */
export async function censusPoint(address, bounds) {
  const q = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' });
  const data = await get(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${q}`, { json: true });
  const m = data?.result?.addressMatches?.[0];
  const pin = m && { lat: m.coordinates.y, lng: m.coordinates.x };
  return pin && inBounds(bounds, pin) ? pin : null;
}

export const fixed = (n) => (n == null || n === '' ? '' : Number(n).toFixed(6));

/** Writes seed/cities/<key>/parks.csv, sorted by slug. */
export function writeParksCsv(key, rows) {
  const out = path.join(import.meta.dirname, '..', '..', 'seed', 'cities', key, 'parks.csv');
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.slug)) throw new Error(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
  }
  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, stringifyCsv(PARK_CSV_COLUMNS, rows.map((r) => ({ phone: '', checkin_radius_m: '', needs_pin: r.lat === '' ? '1' : '0', ...r }))));
  console.log(`Wrote ${rows.length} rows to ${path.relative(process.cwd(), out)}`);
}
