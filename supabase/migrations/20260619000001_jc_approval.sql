-- ============================================================
-- Manual JC Approval Check — status snapshot + alert log
-- Created: 2026-06-19
-- Purpose: Move the approval-check data behind Supabase auth/RLS instead of
--   exposing a PUBLIC Metabase card in client HTML. The jc-approval-sync edge
--   fn pulls the full query (sql/rrr/RRR_Manual_JC_Approval_Check.sql) from a
--   PRIVATE Metabase card server-side every ~5 min and rebuilds these tables.
--
--   Read path:
--     - jc-approval.html  → SELECT from jc_approval_status (session-authed)
--     - Alert Centre      → SELECT from jc_approval_alerts
--
--   Purely additive — no existing tables touched.
-- ============================================================

-- ── jc_approval_status ───────────────────────────────────────
-- One row per vehicle (latest snapshot). Mirrors the query output columns.
-- Rebuilt every sync (delete + reinsert) so it always reflects "now".
CREATE TABLE IF NOT EXISTS public.jc_approval_status (
  reg_number              text PRIMARY KEY,
  chassis_number          text,
  latest_draft_jc         text,
  latest_jc_status        text,
  jc_created_ist          text,          -- kept as text (display string from query)
  current_booking_status  text,
  current_booking_ended_ist text,
  jc_trip_ended_ist       text,
  dms_json                text,          -- 'Blank' | 'Present'
  jc_age_minutes          double precision,
  rental_status           text,
  vehicle_status          text,
  vehicle_sub_status      text,
  tier                    text,          -- T0..T6 — stable routing key
  verdict                 text,
  reason                  text,
  refreshed_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jcas_chassis ON public.jc_approval_status (chassis_number);
CREATE INDEX IF NOT EXISTS idx_jcas_tier    ON public.jc_approval_status (tier);

-- ── jc_approval_alerts ───────────────────────────────────────
-- Append-only log of actionable situations (T4/T5b/T6) detected by the sync.
-- One row per (draft JC, tier) first-seen; alerted_at set when notified so the
-- sync never re-emails the same case. Resolved when the tier changes/clears.
CREATE TABLE IF NOT EXISTS public.jc_approval_alerts (
  id              bigserial PRIMARY KEY,
  reg_number      text NOT NULL,
  chassis_number  text,
  latest_draft_jc text,
  tier            text NOT NULL,
  verdict         text,
  reason          text,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  alerted_at      timestamptz,           -- set once the email/notification fires
  resolved_at     timestamptz,           -- set when the vehicle leaves the alert tier
  -- A given draft JC raises at most one OPEN alert per tier.
  UNIQUE (latest_draft_jc, tier)
);

CREATE INDEX IF NOT EXISTS idx_jcaa_open ON public.jc_approval_alerts (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jcaa_reg  ON public.jc_approval_alerts (reg_number);

-- ── RLS ──────────────────────────────────────────────────────
-- Authenticated read (the page gates to superadmin in the UI + via the
-- is_superadmin app_metadata short-circuit; data itself is no longer public).
-- Service role (edge fn) writes — bypasses RLS, explicit policies for clarity.
ALTER TABLE public.jc_approval_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jc_approval_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_jc_status"
  ON public.jc_approval_status FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "service_write_jc_status"
  ON public.jc_approval_status FOR INSERT WITH CHECK (true);
CREATE POLICY "service_delete_jc_status"
  ON public.jc_approval_status FOR DELETE USING (true);

CREATE POLICY "auth_read_jc_alerts"
  ON public.jc_approval_alerts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "service_write_jc_alerts"
  ON public.jc_approval_alerts FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update_jc_alerts"
  ON public.jc_approval_alerts FOR UPDATE USING (true);
