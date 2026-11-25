-- Reward schedule (SPEC Flow 7): first-time actions for the surprise badges. One row per member
-- and action, with when it first happened. Nothing about where or what.
CREATE TABLE user_milestones (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action   TEXT NOT NULL,
  first_at TEXT NOT NULL,
  PRIMARY KEY (user_id, action)
);
