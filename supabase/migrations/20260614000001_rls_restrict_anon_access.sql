-- Tasks 1.6, 1.7, 1.8: Restrict anon access to sensitive tables
-- Service role (edge fns) and postgres (pg_cron) bypass RLS — unaffected.
-- All pages require Supabase Auth before querying — existing users unaffected.

-- 1.6: rsa_tickets_cache — remove anon read, authenticated only
DROP POLICY IF EXISTS "anon read" ON rsa_tickets_cache;
CREATE POLICY "authenticated_select" ON rsa_tickets_cache
  FOR SELECT TO authenticated USING (true);

-- 1.7: bike_rider_cache — remove anon/public policy (authenticated policy already exists)
DROP POLICY IF EXISTS "public read bike_rider_cache" ON bike_rider_cache;

-- 1.8a: bike_location_cache — remove anon read, authenticated only
DROP POLICY IF EXISTS "anon_read" ON bike_location_cache;
CREATE POLICY "authenticated_select" ON bike_location_cache
  FOR SELECT TO authenticated USING (true);

-- 1.8b: rsa_ticket_locations — replace anon+authenticated policy, enable RLS
DROP POLICY IF EXISTS "anon read" ON rsa_ticket_locations;
CREATE POLICY "authenticated_select" ON rsa_ticket_locations
  FOR SELECT TO authenticated USING (true);
ALTER TABLE rsa_ticket_locations ENABLE ROW LEVEL SECURITY;

-- 1.8c: rsa_team_locations — replace anon+authenticated policy, enable RLS
DROP POLICY IF EXISTS "anon read" ON rsa_team_locations;
CREATE POLICY "authenticated_select" ON rsa_team_locations
  FOR SELECT TO authenticated USING (true);
ALTER TABLE rsa_team_locations ENABLE ROW LEVEL SECURITY;
