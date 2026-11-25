-- Friend codes and pal requests (SPEC Flow 8). Typing someone's code sends them a request; only
-- their accepting it makes a pal link. One active code per user; "New code" replaces it.
CREATE TABLE pal_codes (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,              -- 8 characters, stored without the dash
  created_at TEXT NOT NULL
);

CREATE TABLE pal_requests (
  id         INTEGER PRIMARY KEY,
  from_user  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (from_user, to_user),
  CHECK (from_user != to_user)
);
CREATE INDEX pal_requests_to ON pal_requests (to_user);

-- Wrong codes typed, so codes can't be guessed by trying many.
CREATE TABLE pal_code_failures (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at      TEXT NOT NULL
);
CREATE INDEX pal_code_failures_user ON pal_code_failures (user_id, at);
