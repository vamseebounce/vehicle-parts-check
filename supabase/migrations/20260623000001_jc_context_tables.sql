-- ============================================================
-- JC context tables — booking history, ops log, JC status log
-- Created: 2026-06-23
-- Purpose: Three additional read-only context buckets for the Manual JC
--   Approval Check page (jc-approval.html). The ops team does 6 manual checks
--   before approving a JC; these tables back buckets 2 (booking history),
--   4 (ops log) and 6 (JC status log). Rebuilt by the jc-context-sync edge fn
--   (delete + reinsert) from 3 PRIVATE Metabase cards. Card UUIDs live ONLY in
--   the edge fn — never in the browser. Reads are session-authed + RLS-gated,
--   same pattern as jc_approval_status.
--
--   Also extends jc_approval_status with two columns the approval query now
--   emits: `intrip` (OOS JC vs Running Repair) and `jc_hub_name` (for the
--   hub-mismatch warning in the Bike section).
--
--   Purely additive — no existing tables dropped.
-- ============================================================

-- ── jc_booking_history ───────────────────────────────────────
-- Last ~90 days of bookings per vehicle (booking chain, plan renewals).
CREATE TABLE IF NOT EXISTS public.jc_booking_history (
  id                      bigint PRIMARY KEY,
  reg_number              text NOT NULL,
  bike_id                 bigint,
  status                  text,
  booking_started_at_ist  text,
  booking_ended_at_ist    text,
  created_for_bike_change text,
  intrip_dues             text,
  synced_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jcbh_reg ON public.jc_booking_history (reg_number);

-- ── jc_ops_log ───────────────────────────────────────────────
-- Vehicle status transitions + hub changes (bike_operations_log), ~30 days.
CREATE TABLE IF NOT EXISTS public.jc_ops_log (
  id                      bigint PRIMARY KEY,
  reg_number              text NOT NULL,
  bike_id                 bigint,
  previous_vehicle_status text,
  new_vehicle_status      text,
  hub_name                text,
  performed_by_name       text,
  created_at_ist          text,
  synced_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jcol_reg ON public.jc_ops_log (reg_number);

-- ── jc_jc_status_log ─────────────────────────────────────────
-- Job-card status progression (job_card_status_log) incl. DMS JC number.
CREATE TABLE IF NOT EXISTS public.jc_jc_status_log (
  id              bigint PRIMARY KEY,
  reg_number      text NOT NULL,
  job_card_id     text,
  new_status      text,
  technician_name text,
  dmsjcid         text,
  remarks         text,
  created_at_ist  text,
  synced_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jcsl_reg  ON public.jc_jc_status_log (reg_number);
CREATE INDEX IF NOT EXISTS idx_jcsl_jcid ON public.jc_jc_status_log (job_card_id);

-- ── RLS — same pattern as jc_approval_status ─────────────────
ALTER TABLE public.jc_booking_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jc_ops_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jc_jc_status_log    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_jc_booking_history"     ON public.jc_booking_history   FOR SELECT USING (auth.role()='authenticated');
CREATE POLICY "service_write_jc_booking_history"  ON public.jc_booking_history  FOR INSERT WITH CHECK (true);
CREATE POLICY "service_delete_jc_booking_history" ON public.jc_booking_history  FOR DELETE USING (true);

CREATE POLICY "auth_read_jc_ops_log"     ON public.jc_ops_log    FOR SELECT USING (auth.role()='authenticated');
CREATE POLICY "service_write_jc_ops_log"  ON public.jc_ops_log   FOR INSERT WITH CHECK (true);
CREATE POLICY "service_delete_jc_ops_log" ON public.jc_ops_log   FOR DELETE USING (true);

CREATE POLICY "auth_read_jc_jc_status_log"     ON public.jc_jc_status_log    FOR SELECT USING (auth.role()='authenticated');
CREATE POLICY "service_write_jc_jc_status_log"  ON public.jc_jc_status_log   FOR INSERT WITH CHECK (true);
CREATE POLICY "service_delete_jc_jc_status_log" ON public.jc_jc_status_log   FOR DELETE USING (true);

-- ── Extend jc_approval_status with intrip + jc_hub_name ───────
ALTER TABLE public.jc_approval_status
  ADD COLUMN IF NOT EXISTS intrip      boolean,
  ADD COLUMN IF NOT EXISTS jc_hub_name text;
