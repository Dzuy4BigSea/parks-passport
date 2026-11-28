-- Reactions between Park Pals (SPEC Flow 26): a pal taps one of five reactions on a stamp, badge
-- or photo shown in the Pals feed. One of each reaction per person per item. Gone with the item.
CREATE TABLE reactions (
  target_type TEXT NOT NULL CHECK (target_type IN ('visit', 'badge', 'photo')),
  target_id   INTEGER NOT NULL,              -- visits.id, badges.id (with owner_id) or photos.id
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction    TEXT NOT NULL CHECK (reaction IN ('party', 'tree', 'fire', 'clap', 'sun')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id, owner_id, user_id, reaction),
  CHECK (owner_id != user_id)
);
CREATE INDEX reactions_owner ON reactions (owner_id, target_type, target_id);

CREATE TRIGGER reactions_visit_gone AFTER DELETE ON visits BEGIN
  DELETE FROM reactions WHERE target_type = 'visit' AND target_id = OLD.id;
END;
CREATE TRIGGER reactions_photo_gone AFTER DELETE ON photos BEGIN
  DELETE FROM reactions WHERE target_type = 'photo' AND target_id = OLD.id;
END;
CREATE TRIGGER reactions_badge_gone AFTER DELETE ON user_badges BEGIN
  DELETE FROM reactions WHERE target_type = 'badge' AND target_id = OLD.badge_id AND owner_id = OLD.user_id;
END;
-- A pal unlinked: their reactions on each other's things go.
CREATE TRIGGER reactions_pal_gone AFTER DELETE ON pal_links BEGIN
  DELETE FROM reactions WHERE (owner_id = OLD.user_a AND user_id = OLD.user_b) OR (owner_id = OLD.user_b AND user_id = OLD.user_a);
END;

-- One grouped notification per reacted-to item ("Ana and 2 others reacted…"): its key.
ALTER TABLE notifications ADD COLUMN ref TEXT;
CREATE INDEX notifications_ref ON notifications (user_id, ref);
