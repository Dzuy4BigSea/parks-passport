-- Notification center (SPEC Flow 8) and badges given by an admin (Flow 9).
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,              -- badge | gift | level | pal_request | pal_new
  text       TEXT NOT NULL,
  link       TEXT NOT NULL DEFAULT '',   -- a path in this app
  actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE, -- the other member, if any
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX notifications_user ON notifications(user_id, id);

-- A badge given by an admin (user_badges.source_type = 'grant', source_id = the admin) can carry
-- a short note, shown with the badge reveal and in the notification.
ALTER TABLE user_badges ADD COLUMN note TEXT;
