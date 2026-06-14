-- Session 13: Drop PostGIS extension — frees ~80MB RAM
--
-- PostGIS is installed but nothing queries the geography columns:
--   - rsa_ticket_locations.location (geography)
--   - rsa_team_locations.location (geography)
-- Frontend uses only lat/lng float columns. The functions that used
-- ST_Distance (get_team_trail_km, get_ticket_trail_km) are called by nothing.
--
-- Rollback: restore from baseline migration if PostGIS is ever needed.
--   Re-add: CREATE EXTENSION postgis; then re-add columns + trigger + functions.

-- Step 1: Drop triggers that auto-populated the geography column
DROP TRIGGER IF EXISTS set_location ON public.rsa_ticket_locations;
DROP TRIGGER IF EXISTS set_location ON public.rsa_team_locations;

-- Step 2: Drop functions that used PostGIS
DROP FUNCTION IF EXISTS public.set_location_from_latlong() CASCADE;
DROP FUNCTION IF EXISTS public.get_ticket_trail_km(text);
DROP FUNCTION IF EXISTS public.get_team_trail_km(text, timestamptz, timestamptz);

-- Step 3: Drop the geography column from partitioned tables
-- (propagates automatically to all partitions)
ALTER TABLE public.rsa_ticket_locations DROP COLUMN IF EXISTS location;
ALTER TABLE public.rsa_team_locations   DROP COLUMN IF EXISTS location;

-- Step 4: Drop PostGIS extension (~80MB RAM freed on next DB restart)
DROP EXTENSION IF EXISTS postgis CASCADE;
