-- ============================================================
-- Trace & Hunter — HO Dashboard cache + hunter live locations
-- Created: 2026-06-18
-- Purpose (Micro RAM): move the GPS join off the client. The HO dashboard
-- read path becomes a single SELECT from a pre-joined snapshot table that the
-- recovery-ticket-sync edge fn rebuilds every 5 min. No client-side N+1 over
-- bike_location_cache, no per-client per-60s join.
-- Purely additive — no existing tables touched.
-- ============================================================

-- ── recovery_tickets_cache ───────────────────────────────────
-- Denormalised snapshot of open + today-recovered tickets, GPS already joined.
-- marked_at_utc kept raw so the client computes age live (never stale).
CREATE TABLE IF NOT EXISTS public.recovery_tickets_cache (
  ticket_id            uuid PRIMARY KEY,
  bike_id              bigint,
  reg_number           text,
  city_id              int,
  city_name            text,
  zone                 text,
  status               text,
  assigned_hunter_id   uuid,
  call_status          text,
  marked_at_utc        timestamptz,
  is_base_list         boolean,
  model_name           text,
  last_user_name       text,
  last_user_phone      text,
  mark_found_at        timestamptz,
  in_transit_at        timestamptz,
  at_hub_at            timestamptz,
  -- GPS resolved from bike_location_cache by the edge fn (snapshot, not source of truth)
  display_lat          double precision,
  display_lng          double precision,
  gps_ts               timestamptz,
  refreshed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rtc_city   ON public.recovery_tickets_cache (city_id);
CREATE INDEX IF NOT EXISTS idx_rtc_status ON public.recovery_tickets_cache (status);

-- ── hunter_locations ─────────────────────────────────────────
-- Hunter live GPS breadcrumbs (HO live dots + Track panel trail).
-- Written by the Hunter PWA (throttled). Append-only.
CREATE TABLE IF NOT EXISTS public.hunter_locations (
  id          bigserial   PRIMARY KEY,
  hunter_id   uuid        NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hl_hunter_time ON public.hunter_locations (hunter_id, synced_at DESC);

-- Latest position per hunter — HO reads this for live dots (cheap DISTINCT ON).
CREATE OR REPLACE VIEW public.hunter_locations_latest AS
SELECT DISTINCT ON (hunter_id) hunter_id, lat, lng, synced_at
FROM public.hunter_locations
ORDER BY hunter_id, synced_at DESC;

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.recovery_tickets_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hunter_locations       ENABLE ROW LEVEL SECURITY;

-- cache: authenticated read; service role writes (bypasses RLS) — explicit policies for clarity
CREATE POLICY "auth_read_recovery_cache"
  ON public.recovery_tickets_cache FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "service_write_recovery_cache"
  ON public.recovery_tickets_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "service_delete_recovery_cache"
  ON public.recovery_tickets_cache FOR DELETE USING (true);

-- hunter_locations: authenticated read; a hunter may insert only their own breadcrumb
CREATE POLICY "auth_read_hunter_locations"
  ON public.hunter_locations FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "hunter_insert_own_location"
  ON public.hunter_locations FOR INSERT WITH CHECK (hunter_id = auth.uid());

-- ── Breadcrumb retention ─────────────────────────────────────
-- Keep 7 days of hunter trails; run from a cron or on-demand.
CREATE OR REPLACE FUNCTION public.cleanup_hunter_locations()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.hunter_locations WHERE synced_at < now() - INTERVAL '7 days';
$$;
