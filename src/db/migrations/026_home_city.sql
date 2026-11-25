-- A member's home city (SPEC Flow 14): where the app opens for them. Set at sign-up, changeable in
-- Account. Existing members: the city they've stamped most in (NULL means the default city).
ALTER TABLE users ADD COLUMN home_city_id INTEGER REFERENCES city_themes(id) ON DELETE SET NULL;
UPDATE users SET home_city_id = (
  SELECT p.city_id FROM visits v JOIN parks p ON p.id = v.park_id
  WHERE v.user_id = users.id AND p.city_id IS NOT NULL
  GROUP BY p.city_id ORDER BY COUNT(*) DESC, MAX(v.visited_at) DESC LIMIT 1
);
