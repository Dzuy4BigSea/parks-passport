-- Handles a member gave up by changing their display name (SPEC Flow 1). Nobody else can take one,
-- so an old passport link never leads to someone else; the same member can take it back.
CREATE TABLE retired_handles (
  handle  TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
