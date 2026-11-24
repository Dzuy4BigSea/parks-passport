-- Admin invites by email. The link carries a random token; only its hash is stored. An invite is
-- accepted when someone signs up with the invited address (by the link or not).
CREATE TABLE invites (
  id               INTEGER PRIMARY KEY,
  email            TEXT NOT NULL,
  name             TEXT NOT NULL DEFAULT '',
  token_hash       TEXT NOT NULL UNIQUE,
  invited_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  accepted_at      TEXT,
  accepted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX invites_email ON invites (email);
