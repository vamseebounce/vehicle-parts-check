-- ============================================================
-- Trace & Hunter — Phase 1 Tables
-- Created: 2026-06-18
-- ============================================================

-- ── Status enum ──────────────────────────────────────────────
CREATE TYPE public.recovery_status AS ENUM (
  'marked',
  'assigned',
  'called',
  'en_route',
  'mark_found',
  'in_transit',
  'at_hub',
  'cancelled'
);

CREATE TYPE public.call_status AS ENUM (
  'none',
  'informed',
  'no_response'
);

-- ── recovery_tickets ─────────────────────────────────────────
-- One row per vehicle per recovery episode.
-- GPS NOT stored here — always read live from bike_location_cache.
CREATE TABLE public.recovery_tickets (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Unique anchor: bike + ops_log row that opened this ticket
  bike_id               bigint      NOT NULL,
  source_ops_log_id     bigint      NOT NULL,
  UNIQUE (bike_id, source_ops_log_id),

  -- User context at creation time
  user_id               uuid,

  -- Timing (UTC stored, IST displayed)
  marked_at_utc         timestamptz NOT NULL,

  -- Zone assignment
  zone                  text        CHECK (zone IN ('NE', 'NW', 'SE', 'SW')),
  city_id               int,
  assigned_hunter_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Status
  status                public.recovery_status NOT NULL DEFAULT 'marked',
  cancel_reason         text,

  -- Call tracking
  call_status           public.call_status NOT NULL DEFAULT 'none',

  -- Hunter actions
  is_deprioritized      boolean     NOT NULL DEFAULT false,
  deprioritized_at      timestamptz,

  -- Cool-off (Phase 2 — columns exist now, logic in Phase 2)
  cooloff_expires_at    timestamptz,

  -- Timestamps for each stage
  assigned_at           timestamptz,
  called_at             timestamptz,
  en_route_at           timestamptz,
  mark_found_at         timestamptz,
  in_transit_at         timestamptz,
  at_hub_at             timestamptz,
  cancelled_at          timestamptz,

  -- Photo proofs
  mark_found_photo_url  text,
  in_transit_photo_url  text,

  -- Hub set at Mark Found via Haversine
  hub_id                int,

  -- List metadata
  is_base_list          boolean     NOT NULL DEFAULT true,
  added_at              timestamptz NOT NULL DEFAULT now(),

  -- Notes
  notes                 text,

  -- Denormalised from Q1 (static at creation time)
  reg_number            text        NOT NULL,
  model_name            text,
  speed_segment         text,
  city_name             text,
  plan_type             text,
  last_user_name        text,
  last_user_phone       text,
  referred_count        int         DEFAULT 0,

  -- Audit
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rt_bike_id           ON public.recovery_tickets (bike_id);
CREATE INDEX idx_rt_status            ON public.recovery_tickets (status) WHERE status NOT IN ('cancelled', 'at_hub');
CREATE INDEX idx_rt_hunter            ON public.recovery_tickets (assigned_hunter_id) WHERE status NOT IN ('cancelled', 'at_hub');
CREATE INDEX idx_rt_city_zone         ON public.recovery_tickets (city_id, zone);
CREATE INDEX idx_rt_marked_at         ON public.recovery_tickets (marked_at_utc);
CREATE INDEX idx_rt_source_ops_log_id ON public.recovery_tickets (source_ops_log_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_recovery_ticket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_rt_updated_at
  BEFORE UPDATE ON public.recovery_tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_recovery_ticket();

-- ── recovery_ticket_events ───────────────────────────────────
-- Immutable event log — mirrors ticket_events pattern.
CREATE TABLE public.recovery_ticket_events (
  id          bigserial   PRIMARY KEY,
  ticket_id   uuid        NOT NULL REFERENCES public.recovery_tickets(id) ON DELETE CASCADE,
  event_type  text        NOT NULL, -- called, cool_off_start, cool_off_end, en_route,
                                    -- mark_found, in_transit, at_hub, cancelled,
                                    -- note, reassigned, deprioritized
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,                 -- auth.users.id; null = system/cron
  metadata    jsonb
);

CREATE INDEX idx_rte_ticket_id  ON public.recovery_ticket_events (ticket_id, created_at DESC);
CREATE INDEX idx_rte_event_type ON public.recovery_ticket_events (event_type);

-- ── recovery_blocked_vehicles ────────────────────────────────
-- Police station / impounded exclusions — synced from Google Sheet at 6 PM.
CREATE TABLE public.recovery_blocked_vehicles (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reg_number      text        NOT NULL UNIQUE,
  police_station  text,
  city            text,
  synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rbv_reg ON public.recovery_blocked_vehicles (reg_number);

-- ── zone_configs ─────────────────────────────────────────────
-- Daily clustering output — one row per zone per city per date.
CREATE TABLE public.zone_configs (
  id                    bigserial   PRIMARY KEY,
  date                  date        NOT NULL,
  city_id               int         NOT NULL,
  zone_label            text        NOT NULL CHECK (zone_label IN ('NE', 'NW', 'SE', 'SW')),
  hunter_id             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  centroid_lat          double precision,
  centroid_lng          double precision,
  dynamic_center_lat    double precision,
  dynamic_center_lng    double precision,
  boundary_polygon      jsonb,      -- GeoJSON; nulled after 90 days
  vehicle_count         int         NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, city_id, zone_label)
);

CREATE INDEX idx_zc_date_city ON public.zone_configs (date, city_id);

-- ── roster_template ──────────────────────────────────────────
-- Default weekly pattern per hunter (seeded manually by admin).
CREATE TABLE public.roster_template (
  id            bigserial   PRIMARY KEY,
  hunter_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_of_week   int         NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
  city_id       int         NOT NULL,
  default_zones text[]      NOT NULL DEFAULT '{}', -- ['NE','SW'] etc.
  UNIQUE (hunter_id, day_of_week, city_id)
);

-- ── roster_overrides ─────────────────────────────────────────
-- Today / week overrides — logged with who changed it and why.
CREATE TABLE public.roster_overrides (
  id              bigserial   PRIMARY KEY,
  hunter_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  city_id         int         NOT NULL,
  zones           text[]      NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'leave', 'weekoff')),
  override_reason text,
  changed_by      uuid        REFERENCES auth.users(id),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hunter_id, date, city_id)
);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.recovery_tickets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_ticket_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_blocked_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_configs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_template           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_overrides          ENABLE ROW LEVEL SECURITY;

-- recovery_tickets: authenticated read; service_role write (cron + edge fn)
CREATE POLICY "auth_read_recovery_tickets"
  ON public.recovery_tickets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_update_recovery_tickets"
  ON public.recovery_tickets FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "service_insert_recovery_tickets"
  ON public.recovery_tickets FOR INSERT WITH CHECK (true);

-- recovery_ticket_events: authenticated read; authenticated insert (hunter actions)
CREATE POLICY "auth_read_recovery_ticket_events"
  ON public.recovery_ticket_events FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_recovery_ticket_events"
  ON public.recovery_ticket_events FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- recovery_blocked_vehicles: authenticated read only (written by cron)
CREATE POLICY "auth_read_recovery_blocked"
  ON public.recovery_blocked_vehicles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "service_write_recovery_blocked"
  ON public.recovery_blocked_vehicles FOR INSERT WITH CHECK (true);
CREATE POLICY "service_delete_recovery_blocked"
  ON public.recovery_blocked_vehicles FOR DELETE USING (true);

-- zone_configs: authenticated read
CREATE POLICY "auth_read_zone_configs"
  ON public.zone_configs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "service_write_zone_configs"
  ON public.zone_configs FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update_zone_configs"
  ON public.zone_configs FOR UPDATE USING (true);

-- roster_template + roster_overrides: authenticated read; admin write (Phase 2 UI)
CREATE POLICY "auth_read_roster_template"
  ON public.roster_template FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write_roster_template"
  ON public.roster_template FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read_roster_overrides"
  ON public.roster_overrides FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write_roster_overrides"
  ON public.roster_overrides FOR ALL USING (auth.role() = 'authenticated');

-- ── Boundary polygon cleanup (90-day retention) ──────────────
-- Null boundary_polygon for zone_configs older than 90 days.
-- Run monthly via cron or on-demand — no separate table needed.
CREATE OR REPLACE FUNCTION public.cleanup_old_zone_boundaries()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.zone_configs
  SET    boundary_polygon = NULL
  WHERE  date < CURRENT_DATE - INTERVAL '90 days'
    AND  boundary_polygon IS NOT NULL;
$$;
