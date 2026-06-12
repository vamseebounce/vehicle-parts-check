-- ROLLBACK: Session 8 + Session 9 changes
-- Run sections below for whichever session's changes need to be rolled back.
-- After running, redeploy relevant edge fn versions from Supabase dashboard.

-- ── ROLLBACK 2.4: Restore rsa_tickets_live v1 (remove ticket_events join) ───
-- DROP VIEW rsa_tickets_live;
-- CREATE VIEW rsa_tickets_live AS
-- SELECT ticket_number, status, category, reg_number, technician_name, fault_details,
--   created_at_ist, inprogress_at_ist, resolved_at_ist, tat_minutes, city, synced_at,
--   lat, lng, live_lat, live_lng, bass_location_time_ist AS loc_time,
--   CASE WHEN status = 'DONE' THEN lat ELSE COALESCE(live_lat, lat) END AS display_lat,
--   CASE WHEN status = 'DONE' THEN lng ELSE COALESCE(live_lng, lng) END AS display_lng
-- FROM rsa_tickets_cache;

-- ── ROLLBACK 2.3: tech.html ──────────────────────────────────────────────────
-- Code-only change. To rollback:
-- git checkout session-8 -- v8/tech.html && git push origin main



-- ── ROLLBACK 2.2: Drop ticket_events table ──────────────────────────────────
DROP TABLE IF EXISTS ticket_events;

-- ── ROLLBACK 1.6: Restore anon read on rsa_tickets_cache ────────────────────
DROP POLICY IF EXISTS "authenticated_select" ON rsa_tickets_cache;
CREATE POLICY "anon read" ON rsa_tickets_cache
  FOR SELECT TO anon, authenticated USING (true);

-- ── ROLLBACK 1.7: Restore anon read on bike_rider_cache ─────────────────────
CREATE POLICY "public read bike_rider_cache" ON bike_rider_cache
  FOR SELECT TO anon USING (true);

-- ── ROLLBACK 1.8a: Restore anon read on bike_location_cache ─────────────────
DROP POLICY IF EXISTS "authenticated_select" ON bike_location_cache;
CREATE POLICY "anon_read" ON bike_location_cache
  FOR SELECT TO public USING (true);

-- ── ROLLBACK 1.8b: Disable RLS on rsa_ticket_locations ──────────────────────
ALTER TABLE rsa_ticket_locations DISABLE ROW LEVEL SECURITY;

-- ── ROLLBACK 1.8c: Disable RLS on rsa_team_locations ────────────────────────
ALTER TABLE rsa_team_locations DISABLE ROW LEVEL SECURITY;

-- ── ROLLBACK 2.1: rsa-ticket-sync ───────────────────────────────────────────
-- Code-only change. To rollback:
-- Supabase Dashboard → Edge Functions → rsa-ticket-sync → Deployments → redeploy v15
-- OR run: git checkout phase-1 -- supabase/functions/rsa-ticket-sync/index.ts
-- and redeploy via MCP.

-- ── ROLLBACK 1.5: admin-techs.html ──────────────────────────────────────────
-- Code-only change. To rollback:
-- git checkout phase-1 -- v8/admin-techs.html && git push origin main
