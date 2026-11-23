import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importParksCsv } from '../domain/csv-import.js';

export const SEED_PARKS_CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed', 'parks.csv');

// Loads seed/parks.csv on first start (empty parks table). Later edits happen in the admin.
export function seedParksIfEmpty(db, file = SEED_PARKS_CSV) {
  const count = db.prepare('SELECT COUNT(*) FROM parks').pluck().get();
  if (count > 0) return null;
  return importParksCsv(db, fs.readFileSync(file, 'utf8'));
}
