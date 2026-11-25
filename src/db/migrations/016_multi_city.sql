-- migrate:foreign-keys-off
-- Multi-city (SPEC Flow 14). A city is a city_themes row: its theme plus what makes the app work
-- there (time zone, map bounds, copy). Parks and some badges belong to a city.
-- The parks table is rebuilt (slugs become unique per city), so this migration runs with foreign
-- keys off: dropping the old table must not cascade to visits, photos or ratings. The runner
-- checks foreign keys before committing.

ALTER TABLE city_themes ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE city_themes ADD COLUMN bounds TEXT NOT NULL DEFAULT '{}';   -- {minLat, maxLat, minLng, maxLng}
ALTER TABLE city_themes ADD COLUMN copy TEXT NOT NULL DEFAULT '{}';     -- page copy from the city pack
ALTER TABLE city_themes ADD COLUMN listed INTEGER NOT NULL DEFAULT 1;   -- shown in the city switcher
ALTER TABLE city_themes ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
ALTER TABLE city_themes ADD COLUMN seeded_at TEXT;                      -- when the pack's theme was loaded

-- Existing rows were seeded by the single-city version.
UPDATE city_themes SET seeded_at = updated_at;
-- St. Pete is the first city. A fresh database gets a bare row here; its pack fills it at startup.
INSERT INTO city_themes (key, name, active, updated_at)
  SELECT 'st-pete', 'St. Petersburg', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NOT EXISTS (SELECT 1 FROM city_themes WHERE key = 'st-pete');
-- Before this, "active" meant "the one theme in use"; now every enabled city is active.
UPDATE city_themes SET active = 1 WHERE key = 'st-pete';

CREATE TABLE parks_new (
  id               INTEGER PRIMARY KEY,
  city_id          INTEGER NOT NULL REFERENCES city_themes(id),
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  address          TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  lat              REAL,
  lng              REAL,
  checkin_radius_m INTEGER NOT NULL DEFAULT 150,
  city_url         TEXT NOT NULL DEFAULT '',
  needs_pin        INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  loop_mi          REAL,
  UNIQUE (city_id, slug)
);
INSERT INTO parks_new (id, city_id, slug, name, address, phone, lat, lng, checkin_radius_m, city_url,
    needs_pin, active, created_at, updated_at, loop_mi)
  SELECT id, (SELECT id FROM city_themes WHERE key = 'st-pete'), slug, name, address, phone, lat, lng,
    checkin_radius_m, city_url, needs_pin, active, created_at, updated_at, loop_mi FROM parks;
DROP TABLE parks;
ALTER TABLE parks_new RENAME TO parks;
CREATE INDEX parks_city ON parks(city_id, active);

-- A badge with a city counts only that city's parks (e.g. "Every Park in St. Pete"); without one
-- it counts every city.
ALTER TABLE badges ADD COLUMN city_id INTEGER REFERENCES city_themes(id);
UPDATE badges SET city_id = (SELECT id FROM city_themes WHERE key = 'st-pete')
  WHERE slug IN ('every-park', 'half-the-city', 'lake-hopper');
