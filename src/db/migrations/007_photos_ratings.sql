CREATE TABLE photos (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  park_id     INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  visit_id    INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  file_key    TEXT NOT NULL UNIQUE,          -- uploads/<file_key>.jpg and <file_key>.thumb.jpg
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL CHECK (visibility IN ('private', 'pals', 'public')),
  hidden      INTEGER NOT NULL DEFAULT 0,    -- hidden by a moderator
  created_at  TEXT NOT NULL
);
CREATE INDEX photos_park ON photos(park_id, created_at);
CREATE INDEX photos_user ON photos(user_id);
CREATE INDEX photos_visit ON photos(visit_id);

CREATE TABLE ratings (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  park_id        INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  stars          INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment        TEXT NOT NULL DEFAULT '',
  visibility     TEXT NOT NULL CHECK (visibility IN ('private', 'pals', 'public')),
  comment_hidden INTEGER NOT NULL DEFAULT 0,  -- hidden by a moderator; stars still count
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (user_id, park_id)
);
CREATE INDEX ratings_park ON ratings(park_id);
