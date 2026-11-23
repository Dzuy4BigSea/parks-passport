-- Analytics events raised during a request that redirects (sign-up, stamp, upload…), pushed to
-- dataLayer/Umami on the user's next page and then deleted. No personal data (see lib/analytics.js).
CREATE TABLE analytics_events (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX analytics_events_user ON analytics_events(user_id);
