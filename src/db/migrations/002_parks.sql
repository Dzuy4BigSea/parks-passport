CREATE TABLE parks (
  id               INTEGER PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  address          TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  lat              REAL,
  lng              REAL,
  checkin_radius_m INTEGER NOT NULL DEFAULT 150,
  city_url         TEXT NOT NULL DEFAULT '',
  needs_pin        INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE park_categories (
  park_id  INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (park_id, category)
);
CREATE INDEX park_categories_category ON park_categories(category);
