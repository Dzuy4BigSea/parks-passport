import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importParksCsv, PARK_CSV_COLUMNS } from '../domain/csv-import.js';
import { parseCsv, stringifyCsv } from '../lib/csv.js';
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
export const SEED_GARY_OUTFITS_JSON = path.join(SEED_DIR, 'gary-outfits.json');
export const SEED_REWARD_BADGES_JSON = path.join(SEED_DIR, 'reward-badges.json');
export const SEED_LIMITED_BADGES_JSON = path.join(SEED_DIR, 'limited-badges.json');
export const SEED_GROUP_BADGES_JSON = path.join(SEED_DIR, 'group-badges.json');
export const SEED_TEAM_BADGES_JSON = path.join(SEED_DIR, 'team-badges.json');

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
  addMissingBadges(db, readJson(SEED_LIMITED_BADGES_JSON), { now });
  addMissingBadges(db, readJson(SEED_GROUP_BADGES_JSON), { now }); // Troop Leader: start groups (Flow 23)
  addMissingBadges(db, readJson(SEED_TEAM_BADGES_JSON), { now }); // team badges for group goals (Flow 24) // Early Bird Edition (1–100) and Founding Member
  return cityPackKeys(dir).map((key) => {
    const file = (f) => path.join(dir, key, f);
    const pack = readJson(file('city.json'));
    if (pack.key !== key) throw new Error(`seed/cities/${key}/city.json has key "${pack.key}"`);
    const motifs = seedCityPack(db, pack, { now });
    const cityId = db.prepare('SELECT id FROM city_themes WHERE key = ?').pluck().get(key);
    const hasParks = db.prepare('SELECT 1 FROM parks WHERE city_id = ? LIMIT 1').get(cityId);
    const parks = !hasParks && fs.existsSync(file('parks.csv'))
      ? importParksCsv(db, fs.readFileSync(file('parks.csv'), 'utf8'), { cityId, now: () => now }) : null;
    const extra = addExtraParkFiles(db, path.join(dir, key), key, cityId, { now });
    const extraParks = extra.added;
    const badges = fs.existsSync(file('badges.json')) ? addMissingBadges(db, readJson(file('badges.json')), { cityId, now }) : 0;
    return { key, motifs, parks, extraParks, invalidExtraParks: extra.invalid, badges };
  });
}

/**
 * Extra park files in a pack (`<name>-parks.csv`, e.g. pinellas-county-parks.csv: county parks that
 * fall inside this city). Each file is imported once, even into a city that already has parks, and
 * only adds parks whose slug the city doesn't have: it never changes a park an admin may have edited.
 * Returns { added, invalid } (invalid: rows the import rejected, for the log).
 */
export function addExtraParkFiles(db, packDir, key, cityId, { now = new Date() } = {}) {
  let added = 0;
  const invalid = [];
  const files = fs.readdirSync(packDir).filter((f) => /^[a-z0-9-]+-parks\.csv$/.test(f)).sort();
  for (const f of files) {
    const marker = `pack_parks:${key}/${f}`;
    if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(marker)) continue;
    const have = new Set(db.prepare('SELECT slug FROM parks WHERE city_id = ?').pluck().all(cityId));
    const rows = parseCsv(fs.readFileSync(path.join(packDir, f), 'utf8')).filter((r) => !have.has(String(r.slug || '').toLowerCase()));
    if (rows.length) {
      const r = importParksCsv(db, stringifyCsv(PARK_CSV_COLUMNS, rows), { cityId, now: () => now });
      added += r.added;
      invalid.push(...r.invalid.map((x) => ({ ...x, file: f })));
    }
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(marker, 'imported', now.toISOString());
  }
  return { added, invalid };
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
