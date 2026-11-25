-- Group goals and team badges (SPEC Flow 24).
-- A group works on one goal at a time: a total of check-ins, different parks or activity minutes
-- between starts_at and ends_at. Reaching it gives every member the goal's team badge.
CREATE TABLE group_goals (
  id           INTEGER PRIMARY KEY,
  group_id     INTEGER NOT NULL REFERENCES member_groups(id) ON DELETE CASCADE,
  template_key TEXT,                     -- seed/group-goals.json key; NULL for a custom goal
  title        TEXT NOT NULL,
  metric       TEXT NOT NULL CHECK (metric IN ('checkins', 'parks', 'minutes')),
  target       INTEGER NOT NULL CHECK (target > 0),
  badge_id     INTEGER REFERENCES badges(id) ON DELETE SET NULL,
  starts_at    TEXT NOT NULL,
  ends_at      TEXT NOT NULL,
  reached_at   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX group_goals_group ON group_goals(group_id, id);

-- Team badges are their own kind: earned together by reaching a group goal, shown in their own
-- section of the passport and of Admin › Badges, and kept after leaving or the group ending.
-- user_badges.source_type = 'group', source_id = the goal, note = the group's name then.
ALTER TABLE badges ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0;

-- Badge ideas can now be a group goal or a team badge, suggested by a group's owner.
ALTER TABLE badge_ideas ADD COLUMN kind TEXT NOT NULL DEFAULT 'badge' CHECK (kind IN ('badge', 'group_goal', 'group_badge'));
