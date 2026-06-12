-- Task 1.9: Curated hubs view over rental_locations
-- Exposes only active hubs; hides internal status field from anon consumers
CREATE OR REPLACE VIEW hubs AS
SELECT
  id,
  location_name,
  lat,
  lng,
  address,
  short_address,
  dms_code,
  city_id
FROM rental_locations
WHERE status = 'active';
