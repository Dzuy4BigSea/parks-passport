-- Who a given badge says it's from ("Parks Passport" unless the admin types another name), so a
-- gift no longer shows the giving admin's own name. NULL on older rows: they fall back to it.
ALTER TABLE user_badges ADD COLUMN from_name TEXT;
