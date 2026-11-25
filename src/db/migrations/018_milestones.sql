-- Reward schedule (SPEC Flow 7): first-time actions for the surprise badges. One row per member
-- and action, with when it first happened. Nothing about where or what.
CREATE TABLE user_milestones (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action   TEXT NOT NULL,
  first_at TEXT NOT NULL,
  PRIMARY KEY (user_id, action)
);

-- Firsts from before this release count (their badges come at the member's next badge check).
INSERT OR IGNORE INTO user_milestones (user_id, action, first_at)
  SELECT id, 'avatar', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM users WHERE avatar_key IS NOT NULL;
INSERT OR IGNORE INTO user_milestones (user_id, action, first_at)
  SELECT u, 'pal', MIN(created_at) FROM (SELECT user_a AS u, created_at FROM pal_links UNION ALL SELECT user_b, created_at FROM pal_links) GROUP BY u;
INSERT OR IGNORE INTO user_milestones (user_id, action, first_at)
  SELECT user_id, 'rating', MIN(created_at) FROM ratings GROUP BY user_id;
INSERT OR IGNORE INTO user_milestones (user_id, action, first_at)
  SELECT user_id, 'photo', MIN(created_at) FROM photos GROUP BY user_id;

-- Lucky drop odds follow stamps ever made (deleting a stamp doesn't reset them).
ALTER TABLE users ADD COLUMN lucky_rolls INTEGER NOT NULL DEFAULT 0;
UPDATE users SET lucky_rolls = (SELECT COUNT(*) FROM visits v WHERE v.user_id = users.id);
