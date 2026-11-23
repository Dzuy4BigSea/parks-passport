-- City theming: one row per city (St. Pete first). Accent colors are decorative only (never
-- text), so any valid hex is safe. Areas are neighborhood centroids used to group parks into
-- collections ([{slug, name, lat, lng}]).
CREATE TABLE city_themes (
  id         INTEGER PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  tagline    TEXT NOT NULL DEFAULT '',
  accent     TEXT NOT NULL DEFAULT '#FF7A59',
  accent_2   TEXT NOT NULL DEFAULT '#7C6CF2',
  areas      TEXT NOT NULL DEFAULT '[]',
  active     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Landmark and history motifs: a name, a short blurb and a sanitized line-icon SVG. AI drafts
-- stay 'draft' until an admin approves them; only approved motifs appear on pages.
CREATE TABLE city_motifs (
  id         INTEGER PRIMARY KEY,
  theme_id   INTEGER NOT NULL REFERENCES city_themes(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  blurb      TEXT NOT NULL DEFAULT '',
  svg        TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  source     TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'ai', 'admin')),
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (theme_id, slug)
);
