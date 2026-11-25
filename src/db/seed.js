import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importParksCsv } from '../domain/csv-import.js';
import { seedBadgesIfEmpty, addMissingBadges } from '../domain/badges/index.js';
import { seedActivities } from '../domain/activities.js';
import { seedCityPack } from '../domain/city.js';

const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed');
export const CITIES_DIR = path.join(SEED_DIR, 'cities');
export const cityPackFile = (key, file) => path.join(CITIES_DIR, key, file);
export const SEED_PARKS_CSV = cityPackFile('st-pete', 'parks.csv');
export const SEED_CITY_JSON = cityPackFile('st-pete', 'city.json');
export const SEED_BADGES_JSON = path.join(SEED_DIR, 'badges.json');
export const SEED_ACTIVITIES_JSON = path.join(SEED_DIR, 'activities.json');
export const SEED_ACTIVITY_BADGES_JSON = path.join(SEED_DIR, 'activity-badges.json');
export const SEED_TRAVEL_BADGES_JSON = path.join(SEED_DIR, 'travel-badges.json');
export const SEED_REWARD_BADGES_JSON = path.join(SEED_DIR, 'reward-badges.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** The city packs that ship with the app: every seed/cities/<key>/ with a city.json. */
export const cityPackKeys = (dir = CITIES_DIR) => fs.readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'city.json'))).map((d) => d.name).sort();

/**
 * Loads every city pack, on every start (SPEC Flow 14): the city (its theme only the first time),
 * its parks when the city has none yet, and any of its badges the database doesn't have.
 * Returns [{ key, motifs, parks, badges }] for the log.
 */
export function seedCities(db, { dir = CITIES_DIR, now = new Date(), travelBadgesFile = SEED_TRAVEL_BADGES_JSON } = {}) {
  // Badges for collecting cities (cities_count) and the reward schedule (surprises, lucky drops,
  // the long climb), for every member.
  addMissingBadges(db, readJson(travelBadgesFile), { now });
  addMissingBadges(db, readJson(SEED_REWARD_BADGES_JSON), { now });
  return cityPackKeys(dir).map((key) => {
    const file = (f) => path.join(dir, key, f);
    const pack = readJson(file('city.json'));
    if (pack.key !== key) throw new Error(`seed/cities/${key}/city.json has key "${pack.key}"`);
    const motifs = seedCityPack(db, pack, { now });
    const cityId = db.prepare('SELECT id FROM city_themes WHERE key = ?').pluck().get(key);
    const hasParks = db.prepare('SELECT 1 FROM parks WHERE city_id = ? LIMIT 1').get(cityId);
    const parks = !hasParks && fs.existsSync(file('parks.csv'))
      ? importParksCsv(db, fs.readFileSync(file('parks.csv'), 'utf8'), { cityId, now: () => now }) : null;
    const badges = fs.existsSync(file('badges.json')) ? addMissingBadges(db, readJson(file('badges.json')), { cityId, now }) : 0;
    return { key, motifs, parks, badges };
  });
}

// St. Pete's theme only (unit tests). Later edits happen in the admin.
export function seedCityTheme(db, file = SEED_CITY_JSON) {
  return seedCityPack(db, readJson(file));
}

// Loads St. Pete's parks.csv into an empty parks table (unit tests). Later edits happen in the admin.
export function seedParksIfEmpty(db, file = SEED_PARKS_CSV) {
  const count = db.prepare('SELECT COUNT(*) FROM parks').pluck().get();
  if (count > 0) return null;
  return importParksCsv(db, fs.readFileSync(file, 'utf8'));
}

// Loads seed/badges.json (badges for every city) on first start. Later edits happen in the admin.
export function seedBadges(db, file = SEED_BADGES_JSON) {
  return seedBadgesIfEmpty(db, readJson(file));
}

// Healthy activities, on every start: new and reworded activities from seed/activities.json, and
// any badges from seed/activity-badges.json the database doesn't have yet. Returns badges added.
export function seedActivityData(db, { activitiesFile = SEED_ACTIVITIES_JSON, badgesFile = SEED_ACTIVITY_BADGES_JSON } = {}) {
  seedActivities(db, readJson(activitiesFile));
  return addMissingBadges(db, readJson(badgesFile));
}
