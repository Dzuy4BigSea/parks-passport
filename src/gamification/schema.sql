-- The tables the gamification engine reads and writes. Parks Passport creates them in its own
-- migrations (004, 005, 008); this file is the reference for reusing the engine elsewhere.
-- `users(id)` is the app's own user table.

CREATE TABLE badges (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hint        TEXT NOT NULL DEFAULT '',              -- shown for hidden and lucky badges
  art         TEXT NOT NULL DEFAULT '🏅',
  rule_type   TEXT NOT NULL,                         -- a key of the app's rules
  rule_params TEXT NOT NULL DEFAULT '{}',            -- JSON
  kind        TEXT NOT NULL CHECK (kind IN ('known', 'hidden', 'lucky')),
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE user_badges (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id      INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at    TEXT NOT NULL,
  source_type   TEXT NOT NULL,                       -- the trigger type that awarded it
  source_id     INTEGER,
  seen_at       TEXT,                                -- announced to the user
  rule_snapshot TEXT,                                -- the rule when awarded, so later edits never take it away
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE point_events (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id   INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX point_events_user ON point_events(user_id);
CREATE INDEX point_events_source ON point_events(source_type, source_id);
