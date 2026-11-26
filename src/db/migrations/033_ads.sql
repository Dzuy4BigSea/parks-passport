-- Nonprofit ads and activity tips (SPEC Flow 25). An ad belongs to a nonprofit (Flow 18), shows
-- in one place (the bottom of park pages, the bottom of the passport, or as a tip on one activity),
-- and only while switched on and between its dates (city-local, inclusive).
CREATE TABLE ads (
  id           INTEGER PRIMARY KEY,
  nonprofit_id INTEGER NOT NULL REFERENCES nonprofits(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,                  -- admin label
  placement    TEXT NOT NULL CHECK (placement IN ('park', 'passport', 'activity')),
  activity_id  INTEGER REFERENCES activities(id) ON DELETE CASCADE, -- tips only
  title        TEXT NOT NULL DEFAULT '',       -- tip heading
  body         TEXT NOT NULL DEFAULT '',       -- tip text (plain)
  active       INTEGER NOT NULL DEFAULT 0,     -- hidden until switched on
  starts_on    TEXT NOT NULL,                  -- YYYY-MM-DD
  ends_on      TEXT NOT NULL,                  -- YYYY-MM-DD, inclusive
  all_cities   INTEGER NOT NULL DEFAULT 1,
  park_scope   TEXT NOT NULL DEFAULT 'all' CHECK (park_scope IN ('all', 'categories', 'areas', 'parks')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK ((placement = 'activity') = (activity_id IS NOT NULL))
);
CREATE INDEX ads_live ON ads (placement, active);

CREATE TABLE ad_cities (
  ad_id   INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES city_themes(id) ON DELETE CASCADE,
  PRIMARY KEY (ad_id, city_id)
);

-- Which parks, when park_scope isn't 'all': a category slug, "<city id>:<area name>", or a park id.
CREATE TABLE ad_targets (
  ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  kind  TEXT NOT NULL CHECK (kind IN ('category', 'area', 'park')),
  value TEXT NOT NULL,
  PRIMARY KEY (ad_id, kind, value)
);

CREATE TABLE ad_slides (
  id         INTEGER PRIMARY KEY,
  ad_id      INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  image_key  TEXT NOT NULL,                    -- uploads/ads/<key>.webp (+ <key>.still.webp if animated)
  animated   INTEGER NOT NULL DEFAULT 0,
  alt        TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ad_slides_ad ON ad_slides (ad_id, sort);

-- Counts only: per ad, park (0 = the passport page) and UTC day.
CREATE TABLE ad_stats (
  ad_id   INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  park_id INTEGER NOT NULL DEFAULT 0,
  day     TEXT NOT NULL,
  views   INTEGER NOT NULL DEFAULT 0,
  clicks  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, park_id, day)
);
