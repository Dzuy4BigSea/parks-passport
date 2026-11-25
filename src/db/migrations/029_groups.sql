-- Groups (SPEC Flow 23): a gym, a club, a class. Members see each other's counts, never locations.
-- ("groups" is an SQL keyword, hence member_groups.)
CREATE TABLE member_groups (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '🌳',
  description TEXT NOT NULL DEFAULT '',
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL, -- handed on before an owner's account goes
  code        TEXT NOT NULL UNIQUE,                             -- 8 characters, shown as XXXX-XXXX
  join_mode   TEXT NOT NULL DEFAULT 'ask' CHECK (join_mode IN ('ask', 'open')),
  created_at  TEXT NOT NULL
);

CREATE TABLE group_members (
  group_id  INTEGER NOT NULL REFERENCES member_groups(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user ON group_members(user_id);

-- A member invites one of their Park Pals; the pal accepts or declines.
CREATE TABLE group_invites (
  group_id   INTEGER NOT NULL REFERENCES member_groups(id) ON DELETE CASCADE,
  to_user    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_user  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, to_user)
);

-- "Ask me first": someone with the code asks; the owner approves or declines.
CREATE TABLE group_requests (
  group_id   INTEGER NOT NULL REFERENCES member_groups(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

-- Limits an admin set for this member (NULL: earned. Create: 3 after 10 GPS check-ins, else 0.
-- Join: 5, or 10 after 25 GPS check-ins).
ALTER TABLE users ADD COLUMN group_create_limit INTEGER;
ALTER TABLE users ADD COLUMN group_join_limit INTEGER;
