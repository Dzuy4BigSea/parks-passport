-- Feedback from Founding Members and Early Bird Edition holders (SPEC Flow 16).
CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('idea', 'bug', 'love')),
  text       TEXT NOT NULL,
  page       TEXT NOT NULL DEFAULT '',          -- the path they were on (no query string)
  created_at TEXT NOT NULL,
  done_at    TEXT
);
CREATE INDEX feedback_user ON feedback (user_id, created_at);
