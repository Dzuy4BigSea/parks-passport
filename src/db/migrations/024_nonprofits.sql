-- Nonprofit spotlights (SPEC Flow 18). Suggested by members, approved by admins, shown as one
-- small card on park pages. Spotlights with parks show on those parks; without, on every park in
-- their city. Views and clicks are counted per park and day, with no personal data.
CREATE TABLE nonprofits (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,                  -- https only
  mission      TEXT NOT NULL DEFAULT '',       -- one sentence
  logo         TEXT,                           -- an uploaded image key (re-rendered PNG), or NULL
  reason       TEXT NOT NULL CHECK (reason IN ('steward', 'one_percent', 'local')),
  status       TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'active', 'paused')),
  city_id      INTEGER NOT NULL REFERENCES city_themes(id) ON DELETE CASCADE,
  serves       TEXT NOT NULL DEFAULT '',       -- the suggester's words: which parks or waterways
  suggested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX nonprofits_city ON nonprofits (city_id, status);

CREATE TABLE nonprofit_parks (
  nonprofit_id INTEGER NOT NULL REFERENCES nonprofits(id) ON DELETE CASCADE,
  park_id      INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  PRIMARY KEY (nonprofit_id, park_id)
);
CREATE INDEX nonprofit_parks_park ON nonprofit_parks (park_id);

CREATE TABLE nonprofit_stats (
  nonprofit_id INTEGER NOT NULL REFERENCES nonprofits(id) ON DELETE CASCADE,
  park_id      INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,                  -- YYYY-MM-DD (UTC)
  views        INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (nonprofit_id, park_id, day)
);
