-- The rule a badge had when it was awarded, so later edits by an admin never take it away.
ALTER TABLE user_badges ADD COLUMN rule_snapshot TEXT;
