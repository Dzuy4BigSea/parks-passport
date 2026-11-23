CREATE TABLE users (
  id                     INTEGER PRIMARY KEY,
  email                  TEXT NOT NULL UNIQUE,          -- stored lower-cased
  password_hash          TEXT,
  display_name           TEXT NOT NULL,
  handle                 TEXT NOT NULL UNIQUE,
  default_visibility     TEXT NOT NULL DEFAULT 'private' CHECK (default_visibility IN ('private', 'pals', 'public')),
  is_admin               INTEGER NOT NULL DEFAULT 0,
  share_nudge_dismissals INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                           -- sha256 of the cookie token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE auth_tokens (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('magic_link', 'password_reset', 'delete_account')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE login_failures (
  email TEXT NOT NULL,
  at    TEXT NOT NULL
);
CREATE INDEX login_failures_email_at ON login_failures(email, at);
