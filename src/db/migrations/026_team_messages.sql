-- Messages from the team (SPEC Flow 20): notes that greet members with an animation on their next
-- page, optionally with badges. Seen once per member.
CREATE TABLE team_messages (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  effect        TEXT NOT NULL DEFAULT 'celebrate',
  audience      TEXT NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'city', 'badge', 'picked')),
  audience_ref  TEXT NOT NULL DEFAULT '',           -- a city key or a badge slug
  existing_only INTEGER NOT NULL DEFAULT 1,         -- only members who joined before it went live
  badge_ids     TEXT NOT NULL DEFAULT '[]',         -- badges given with it (JSON ids)
  starts_at     TEXT,                               -- UTC; NULL = as soon as it's live
  ends_at       TEXT,                               -- UTC; NULL = until ended
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'ended')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX team_messages_status ON team_messages (status);

CREATE TABLE team_message_recipients (
  message_id INTEGER NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE team_message_views (
  message_id INTEGER NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at    TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX team_message_views_user ON team_message_views (user_id);
