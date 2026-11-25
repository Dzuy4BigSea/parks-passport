-- Badge ideas (SPEC Flow 13). The super admin (CLI only) triages every idea; any admin shares the
-- ideas page with contributors by email. Access is by email so an invitee has it as soon as they
-- sign up with that address.
ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE idea_contributors (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE badge_ideas (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',     -- optional badge name
  pitch         TEXT NOT NULL,                -- "Earn it when you …"
  art           TEXT NOT NULL DEFAULT '',     -- optional emoji
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'keep', 'kill', 'combined', 'built')),
  merged_into   INTEGER REFERENCES badge_ideas(id) ON DELETE SET NULL,
  rule_type     TEXT,                         -- an existing rule type, 'new_rule', or NULL (not decided)
  note          TEXT NOT NULL DEFAULT '',
  ai_suggestion TEXT,                         -- JSON from the Claude job; applied only by the super admin
  badge_id      INTEGER REFERENCES badges(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX badge_ideas_user ON badge_ideas (user_id, created_at);
CREATE INDEX badge_ideas_status ON badge_ideas (status);
