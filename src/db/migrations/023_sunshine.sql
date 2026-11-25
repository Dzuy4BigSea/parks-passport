-- Drops of Sunshine (SPEC Flow 17): quick thank-you notes to the people who look after the parks.
-- park_id NULL = a note to the whole parks department of that city. Notes wait for admin review;
-- nothing is sent to the city yet. No location is stored.
CREATE TABLE sunshine_notes (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id     INTEGER NOT NULL REFERENCES city_themes(id) ON DELETE CASCADE,
  park_id     INTEGER REFERENCES parks(id) ON DELETE SET NULL,
  text        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'hidden')),
  created_at  TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX sunshine_notes_user ON sunshine_notes (user_id, created_at);
CREATE INDEX sunshine_notes_status ON sunshine_notes (status, created_at);
