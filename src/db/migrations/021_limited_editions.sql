-- Limited edition badges (SPEC Flow 9): a badge with limited_count copies, each numbered 1..N
-- when given. NULL = not limited. A number is unique per badge; a taken-back number is free again.
ALTER TABLE badges ADD COLUMN limited_count INTEGER;
ALTER TABLE user_badges ADD COLUMN serial INTEGER;
CREATE UNIQUE INDEX user_badges_serial ON user_badges(badge_id, serial) WHERE serial IS NOT NULL;
