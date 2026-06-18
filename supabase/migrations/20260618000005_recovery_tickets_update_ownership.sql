-- ============================================================
-- Trace & Hunter — tighten recovery_tickets UPDATE ownership
-- Created: 2026-06-18
-- Previously: any authenticated user could UPDATE any ticket.
-- Now: only the assigned hunter (or a superadmin) may update a row.
-- Cron / edge functions use the service role and bypass RLS, so the
-- ticket-sync + zone-cluster writes are unaffected.
-- NOTE: Phase 2 admin live-override (drag-reassign by FPI Admin) will need
-- a broader policy; add it when that UI lands.
-- ============================================================

DROP POLICY IF EXISTS "auth_update_recovery_tickets" ON public.recovery_tickets;

CREATE POLICY "owner_or_admin_update_recovery_tickets"
  ON public.recovery_tickets FOR UPDATE
  USING (
    assigned_hunter_id = auth.uid()
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_superadmin')::boolean, false)
  )
  WITH CHECK (
    assigned_hunter_id = auth.uid()
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_superadmin')::boolean, false)
  );
