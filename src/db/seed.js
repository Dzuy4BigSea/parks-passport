import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importParksCsv } from '../domain/csv-import.js';
import { seedBadgesIfEmpty, addMissingBadges } from '../domain/badges/index.js';
import { seedActivities } from '../domain/activities.js';
import { seedThemeIfEmpty } from '../domain/city.js';

const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed');
export const SEED_PARKS_CSV = path.join(SEED_DIR, 'parks.csv');
export const SEED_BADGES_JSON = path.join(SEED_DIR, 'badges.json');
export const SEED_CITY_JSON = path.join(SEED_DIR, 'city-st-pete.json');
export const SEED_ACTIVITIES_JSON = path.join(SEED_DIR, 'activities.json');
export const SEED_ACTIVITY_BADGES_JSON = path.join(SEED_DIR, 'activity-badges.json');

// Loads the St. Pete city theme (areas and landmark motifs) on first start. Later edits happen in the admin.
export function seedCityTheme(db, file = SEED_CITY_JSON) {
  return seedThemeIfEmpty(db, JSON.parse(fs.readFileSync(file, 'utf8')));
}

// Loads seed/parks.csv on first start (empty parks table). Later edits happen in the admin.
export function seedParksIfEmpty(db, file = SEED_PARKS_CSV) {
  const count = db.prepare('SELECT COUNT(*) FROM parks').pluck().get();
  if (count > 0) return null;
  return importParksCsv(db, fs.readFileSync(file, 'utf8'));
}

// Loads seed/badges.json on first start. Later edits happen in the admin.
export function seedBadges(db, file = SEED_BADGES_JSON) {
  return seedBadgesIfEmpty(db, JSON.parse(fs.readFileSync(file, 'utf8')));
}

// Healthy activities, on every start: new and reworded activities from seed/activities.json, and
// any badges from seed/activity-badges.json the database doesn't have yet. Returns badges added.
export function seedActivityData(db, { activitiesFile = SEED_ACTIVITIES_JSON, badgesFile = SEED_ACTIVITY_BADGES_JSON } = {}) {
  seedActivities(db, JSON.parse(fs.readFileSync(activitiesFile, 'utf8')));
  return addMissingBadges(db, JSON.parse(fs.readFileSync(badgesFile, 'utf8')));
}
