-- Gary's outfits (SPEC Flow 22): drafts from seed/gary-outfits.json that admins approve or hide;
-- starters for everyone, the rest unlocked by holding a badge. A member's choice is
-- users.gary_outfit (a slug; NULL = dress for the weather).
CREATE TABLE gary_outfits (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  blurb         TEXT NOT NULL DEFAULT '',
  art           TEXT NOT NULL DEFAULT '{}',       -- JSON: { hat, body, face, shirt: { main, dark, sleeve } }
  weather       TEXT NOT NULL DEFAULT '[]',       -- JSON: rain | snow | cold | hot | mild
  starter       INTEGER NOT NULL DEFAULT 0,
  unlock_badges TEXT NOT NULL DEFAULT '[]',       -- JSON badge slugs: holding any one unlocks it
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'hidden')),
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN gary_outfit TEXT;
