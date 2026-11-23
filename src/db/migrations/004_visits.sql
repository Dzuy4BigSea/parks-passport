CREATE TABLE visits (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  park_id     INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  visited_on  TEXT NOT NULL,              -- local date, America/New_York, YYYY-MM-DD
  visited_at  TEXT NOT NULL,              -- ISO timestamp (noon local for backdated stamps)
  method      TEXT NOT NULL CHECK (method IN ('gps', 'photo', 'honor')),
  -- Private: never shown to anyone but the owner.
  lat         REAL,
  lng         REAL,
  accuracy_m  REAL,
  distance_m  REAL,
  points      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, park_id, visited_on)
);
CREATE INDEX visits_user ON visits(user_id, visited_on);
CREATE INDEX visits_park ON visits(park_id);

-- Points ledger. A user's total is SUM(points); levels derive from it.
CREATE TABLE point_events (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,              -- visit | rating | ...
  source_id   INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX point_events_user ON point_events(user_id);
CREATE INDEX point_events_source ON point_events(source_type, source_id);
