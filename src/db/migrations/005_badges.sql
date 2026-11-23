CREATE TABLE badges (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hint        TEXT NOT NULL DEFAULT '',
  art         TEXT NOT NULL DEFAULT '🏅',      -- emoji (uploaded art comes with the admin, M8)
  rule_type   TEXT NOT NULL,
  rule_params TEXT NOT NULL DEFAULT '{}',     -- JSON
  kind        TEXT NOT NULL CHECK (kind IN ('known', 'hidden', 'lucky')),
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE user_badges (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id    INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at  TEXT NOT NULL,
  source_type TEXT NOT NULL,                  -- visit | photo | rating | pal
  source_id   INTEGER,
  seen_at     TEXT,                           -- announced to the user
  PRIMARY KEY (user_id, badge_id)
);

-- Highest level index already announced, so a level-up is shown once.
ALTER TABLE users ADD COLUMN level_seen INTEGER NOT NULL DEFAULT 0;
