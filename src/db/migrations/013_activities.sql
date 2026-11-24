-- Healthy activities (docs/healthy-activities.md): things to do at a park after stamping it.
-- Rows come from seed/activities.json at startup; admins can switch each one on or off.
CREATE TABLE activities (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pillar      TEXT NOT NULL CHECK (pillar IN ('move', 'nature', 'calm', 'connect', 'learn', 'give')),
  edition     TEXT NOT NULL DEFAULT 'core' CHECK (edition IN ('core', 'paws', 'kids')),
  category    TEXT,                          -- park category it needs; NULL = any park
  measure     TEXT NOT NULL CHECK (measure IN ('check', 'minutes', 'miles', 'count')),
  minutes     INTEGER NOT NULL DEFAULT 0,    -- time credited for a 'check' or 'count' activity
  points      INTEGER NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- Private to the member: never shown to anyone else. One log per activity per visit (park and day).
CREATE TABLE activity_logs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visit_id    INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  amount      REAL NOT NULL DEFAULT 1,       -- minutes, miles or a count; 1 for 'check'
  minutes     REAL NOT NULL DEFAULT 0,       -- time credited, for the weekly minute goals
  miles       REAL NOT NULL DEFAULT 0,
  logged_on   TEXT NOT NULL,                 -- local date, same as the visit's
  created_at  TEXT NOT NULL,
  UNIQUE (visit_id, activity_id)
);
CREATE INDEX activity_logs_user ON activity_logs(user_id, logged_on);

-- Editions the member turned on in Account.
ALTER TABLE users ADD COLUMN paws INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN kids INTEGER NOT NULL DEFAULT 0;

-- Length of a walking loop, so "walk a mile" can say how many loops that is. NULL = unknown.
ALTER TABLE parks ADD COLUMN loop_mi REAL;
