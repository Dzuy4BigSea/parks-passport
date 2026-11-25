-- "Want to go": parks a member has saved. Private to the member; never shown to anyone else.
-- Rows go with the user (account deletion) or the park.
CREATE TABLE saved_parks (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  park_id    INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, park_id)
);
CREATE INDEX saved_parks_park ON saved_parks(park_id);
