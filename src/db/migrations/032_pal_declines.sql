-- Declined pal requests (SPEC Flow 8). Once I decline someone, their later requests to me are
-- quietly dropped (they see "already asked"), so a friend code never needs replacing. Cleared if
-- we become pals or I send them a request myself.
CREATE TABLE pal_declines (
  from_user   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  declined_at TEXT NOT NULL,
  PRIMARY KEY (from_user, to_user),
  CHECK (from_user != to_user)
);
