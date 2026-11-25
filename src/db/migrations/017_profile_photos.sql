-- Profile photos (SPEC Flow 8): a 256 px square JPEG at uploads/avatars/<avatar_key>.jpg, re-encoded
-- with no metadata. Seen by whoever can see the member's passport (users.default_visibility).
ALTER TABLE users ADD COLUMN avatar_key TEXT;
