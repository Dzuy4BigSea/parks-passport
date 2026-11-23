-- Park Pals: one row per pair, stored with user_a < user_b.
CREATE TABLE pal_links (
  user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX pal_links_b ON pal_links(user_b);

-- One active invite link per user. The token is kept in plain text so the Pals page can keep
-- showing the link; all it grants is becoming this user's pal. Regenerating replaces it.
CREATE TABLE pal_invites (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
