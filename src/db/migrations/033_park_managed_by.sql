-- Who runs a park, when it isn't the pack's own agency (e.g. a Pinellas County or Florida state park
-- inside a city pack). NULL = the pack's (its copy.manager, else copy.official). Shown as a small
-- "Managed by …" line on the park page.
ALTER TABLE parks ADD COLUMN managed_by TEXT;

-- County and state parks already imported into live packs (from their extra park files).
UPDATE parks SET managed_by = 'Pinellas County' WHERE city_url LIKE 'https://pinellas.gov/parks/%'
  AND city_id NOT IN (SELECT id FROM city_themes WHERE key = 'pinellas');
UPDATE parks SET managed_by = 'Florida State Parks' WHERE city_url LIKE 'https://www.floridastateparks.org/%'
  AND city_id NOT IN (SELECT id FROM city_themes WHERE key = 'florida-state-parks');
