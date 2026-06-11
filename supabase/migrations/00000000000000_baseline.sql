-- ============================================================
-- FLEETPRO — BASELINE SCHEMA MIGRATION
-- Captured: 2026-06-11
-- Project:  clkfvmmlgwcvntxnolsv (Tokyo, ap-northeast-1)
-- ============================================================
-- This is a snapshot of the existing DB schema.
-- It is NOT meant to be run on the live project (schema already exists).
-- Use this to bootstrap a new/staging Supabase project.
-- ============================================================

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================
-- TABLES
-- ============================================================

-- app_settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- bike_location_cache
CREATE TABLE IF NOT EXISTS public.bike_location_cache (
  id                  serial PRIMARY KEY,
  chassis_number      text NOT NULL UNIQUE,
  reg_number          text,
  lat                 double precision,
  lng                 double precision,
  baas_location_time  timestamptz,
  current_soc         numeric,
  vehicle_status      text,
  synced_at           timestamptz DEFAULT now()
);

-- bike_rider_cache
CREATE TABLE IF NOT EXISTS public.bike_rider_cache (
  chassis_number  text PRIMARY KEY,
  rider_name      text,
  rider_phone     text,
  synced_at       timestamptz DEFAULT now()
);

-- deployment_queue_cache
CREATE TABLE IF NOT EXISTS public.deployment_queue_cache (
  id              bigserial PRIMARY KEY,
  city            text,
  hub_name        text NOT NULL,
  bike_id         bigint NOT NULL,
  reg_number      text NOT NULL,
  bike_model_id   integer,
  model_name      text,
  tier            text NOT NULL,
  deploy_rank     integer,
  guardrail       text NOT NULL,
  sort_group      integer NOT NULL,
  allotment_score numeric,
  fifo_score      numeric,
  util_score      numeric,
  rfd_age_days    integer,
  avg_km_day      numeric,
  current_odo_km  integer,
  rental_status   text,
  refreshed_at    timestamptz DEFAULT now() NOT NULL
);

-- feedback
CREATE TABLE IF NOT EXISTS public.feedback (
  id           bigserial PRIMARY KEY,
  message      text NOT NULL,
  submitted_by text,
  submitted_at timestamptz DEFAULT now()
);

-- fw_alert_tracker
CREATE TABLE IF NOT EXISTS public.fw_alert_tracker (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chassis_number text NOT NULL,
  reg_number    text,
  hub_name      text,
  jc_number     text,
  jc_opened_at  timestamptz,
  alert_sent_at timestamptz DEFAULT now(),
  fw_updated    boolean DEFAULT false,
  updated_by    text,
  updated_at    timestamptz,
  notes         text
);

-- fw_pending_cache
CREATE TABLE IF NOT EXISTS public.fw_pending_cache (
  chassis_number text PRIMARY KEY,
  hub            text,
  reg_number     text,
  synced_at      timestamptz DEFAULT now()
);

-- fw_rsa_alerts
CREATE TABLE IF NOT EXISTS public.fw_rsa_alerts (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  chassis_number  text,
  reg_number      text,
  ticket_number   text,
  technician_name text,
  city            text,
  alert_sent_at   timestamptz DEFAULT now(),
  fw_updated      boolean DEFAULT false
);

-- fw_wfa_alerts
CREATE TABLE IF NOT EXISTS public.fw_wfa_alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chassis_number text NOT NULL,
  reg_number     text,
  hub_name       text,
  jc_number      text NOT NULL,
  alert_sent_at  timestamptz DEFAULT now(),
  fw_updated     boolean DEFAULT false
);

-- jc_history
CREATE TABLE IF NOT EXISTS public.jc_history (
  id              bigserial PRIMARY KEY,
  jc_no           varchar,
  bike_id         bigint NOT NULL,
  reg_number      varchar NOT NULL,
  bike_odo        numeric,
  jc_date         date,
  hub_name        varchar,
  service_type    varchar,
  line_type       varchar,
  item_name       varchar,
  qty             numeric,
  amount          numeric,
  technician_name varchar,
  source          varchar NOT NULL,
  synced_at       timestamptz DEFAULT now() NOT NULL
);

-- login_events
CREATE TABLE IF NOT EXISTS public.login_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id),
  email        text,
  session_id   uuid,
  logged_in_at timestamptz DEFAULT now(),
  ip           text,
  user_agent   text
);

-- oos_work_queue
CREATE TABLE IF NOT EXISTS public.oos_work_queue (
  id              serial PRIMARY KEY,
  hub             text,
  hub_id          uuid,
  queue_position  integer,
  reg_number      text,
  dms_jc_id       text,
  oos_since       timestamptz,
  days_in_oos     numeric,
  labour_items    text,
  has_parts       boolean DEFAULT false,
  labour_mins     integer DEFAULT 0,
  estimated_mins  integer DEFAULT 0,
  cumulative_mins integer DEFAULT 0,
  parts_items     text,
  synced_at       timestamptz DEFAULT now()
);

-- pending_bookings_cache
CREATE TABLE IF NOT EXISTS public.pending_bookings_cache (
  id                    bigserial PRIMARY KEY,
  user_id               text NOT NULL,
  full_name             text,
  phone_number          text NOT NULL,
  loyalty_tier          text,
  booking_id            bigint NOT NULL,
  bike_model_id         integer,
  booked_model          text,
  paid_premium_fees     integer,
  tier                  text NOT NULL,
  hub_name              text NOT NULL,
  assigned_bike_id      bigint,
  assigned_reg          text,
  assigned_model        text,
  completed_count       integer DEFAULT 0 NOT NULL,
  assigned_bike_model_id integer,
  assigned_odo_km       numeric,
  assigned_rfd_age_days integer,
  assigned_avg_km_day   numeric,
  booking_created_at    timestamptz,
  refreshed_at          timestamptz DEFAULT now() NOT NULL
);

-- rental_locations
CREATE TABLE IF NOT EXISTS public.rental_locations (
  id             integer PRIMARY KEY,
  location_name  text,
  lat            double precision,
  lng            double precision,
  address        text,
  short_address  text,
  status         text,
  dms_code       text,
  city_id        integer
);

-- rsa_tech_actions
CREATE TABLE IF NOT EXISTS public.rsa_tech_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number    text NOT NULL,
  technician_id    uuid,
  technician_name  text NOT NULL,
  technician_email text NOT NULL,
  action           text NOT NULL CHECK (action = ANY (ARRAY['on_my_way','on_site','completed','note'])),
  resolution_type  text CHECK (resolution_type = ANY (ARRAY['phone_resolved','repaired_on_site','porter_needed','towed_to_hub','battery_swap','other'])),
  notes            text,
  evidence_urls    text[] DEFAULT '{}',
  created_at       timestamptz DEFAULT now()
);

-- rsa_technicians
CREATE TABLE IF NOT EXISTS public.rsa_technicians (
  id         uuid PRIMARY KEY REFERENCES auth.users(id),
  name       text NOT NULL,
  email      text NOT NULL UNIQUE,
  phone      text,
  is_active  boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- FK: rsa_tech_actions → rsa_technicians (added after both tables exist)
ALTER TABLE public.rsa_tech_actions
  ADD CONSTRAINT rsa_tech_actions_technician_id_fkey
  FOREIGN KEY (technician_id) REFERENCES public.rsa_technicians(id);

-- rsa_ticket_locations (PostGIS geography)
CREATE TABLE IF NOT EXISTS public.rsa_ticket_locations (
  id            bigserial PRIMARY KEY,
  ticket_number text NOT NULL,
  status        text,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  synced_at     timestamptz DEFAULT now() NOT NULL,
  location      geography(Point, 4326)
);

-- rsa_tickets_cache
CREATE TABLE IF NOT EXISTS public.rsa_tickets_cache (
  ticket_number        text PRIMARY KEY,
  status               text,
  category             text,
  reg_number           text,
  technician_name      text,
  fault_details        text,
  created_at_ist       timestamptz,
  inprogress_at_ist    timestamptz,
  resolved_at_ist      timestamptz,
  tat_minutes          double precision,
  synced_at            timestamptz,
  city                 text,
  lat                  double precision,
  lng                  double precision,
  bass_location_time_ist text,
  live_lat             double precision,
  live_lng             double precision
);

-- rsa_team_locations (PostGIS geography)
CREATE TABLE IF NOT EXISTS public.rsa_team_locations (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL,
  chassis    text NOT NULL,
  reg_number text NOT NULL,
  lat        double precision,
  lng        double precision,
  synced_at  timestamptz DEFAULT now() NOT NULL,
  location   geography(Point, 4326)
);

-- vehicle_parts_check_flag
CREATE TABLE IF NOT EXISTS public.vehicle_parts_check_flag (
  id                              bigserial PRIMARY KEY,
  bike_id                         integer,
  reg_number                      text,
  check_required                  boolean,
  overall_urgency                 integer,
  brake_status                    text,
  brake_km_since                  integer,
  brake_km_remaining              integer,
  last_brake_replaced_date        date,
  last_brake_replaced_hub         text,
  tyre_status                     text,
  tyre_km_since                   integer,
  tyre_km_remaining               integer,
  last_tyre_replaced_date         date,
  last_tyre_replaced_hub          text,
  estimated_current_odo           integer,
  last_jc_odo                     integer,
  days_since_last_jc              integer,
  created_at                      timestamptz DEFAULT now(),
  front_brake_status              text,
  front_brake_km_since            numeric,
  front_brake_km_remaining        numeric,
  last_front_brake_replaced_date  date,
  last_front_brake_replaced_hub   text,
  rear_brake_status               text,
  rear_brake_km_since             numeric,
  rear_brake_km_remaining         numeric,
  last_rear_brake_replaced_date   date,
  last_rear_brake_replaced_hub    text,
  current_status                  text,
  deployed_hub                    text,
  last_service_hub                text,
  fr_brake_cable_status           text,
  fr_brake_cable_km_since         numeric,
  fr_brake_cable_km_remaining     numeric,
  last_fr_brake_cable_replaced_date date,
  last_fr_brake_cable_replaced_hub  text,
  rr_brake_cable_status           text,
  rr_brake_cable_km_since         numeric,
  rr_brake_cable_km_remaining     numeric,
  last_rr_brake_cable_replaced_date date,
  last_rr_brake_cable_replaced_hub  text,
  brake_shoe_spring_status        text,
  brake_shoe_spring_km_since      numeric,
  brake_shoe_spring_km_remaining  numeric,
  last_brake_shoe_spring_replaced_date date,
  last_brake_shoe_spring_replaced_hub  text,
  cone_set_status                 text,
  cone_set_km_since               numeric,
  cone_set_km_remaining           numeric,
  last_cone_set_replaced_date     date,
  last_cone_set_replaced_hub      text,
  fr_brake_disc_status            text,
  fr_brake_disc_km_since          numeric,
  fr_brake_disc_km_remaining      numeric,
  last_fr_brake_disc_replaced_date date,
  last_fr_brake_disc_replaced_hub  text,
  rr_brake_disc_status            text,
  rr_brake_disc_km_since          numeric,
  rr_brake_disc_km_remaining      numeric,
  last_rr_brake_disc_replaced_date date,
  last_rr_brake_disc_replaced_hub  text,
  brake_oil_status                text,
  brake_oil_km_since              numeric,
  brake_oil_km_remaining          numeric,
  last_brake_oil_replaced_date    date,
  last_brake_oil_replaced_hub     text,
  dms_bike_model_id               integer,
  fr_wheel_bearing_status         text,
  fr_wheel_bearing_km_since       integer,
  fr_wheel_bearing_km_remaining   integer,
  last_fr_wheel_bearing_replaced_date date,
  last_fr_wheel_bearing_replaced_hub  text,
  rr_wheel_bearing_status         text,
  rr_wheel_bearing_km_since       integer,
  rr_wheel_bearing_km_remaining   integer,
  last_rr_wheel_bearing_replaced_date date,
  last_rr_wheel_bearing_replaced_hub  text,
  side_stand_spring_status        text,
  side_stand_spring_km_since      integer,
  side_stand_spring_km_remaining  integer,
  last_side_stand_spring_replaced_date date,
  last_side_stand_spring_replaced_hub  text,
  main_stand_spring_status        text,
  main_stand_spring_km_since      integer,
  main_stand_spring_km_remaining  integer,
  last_main_stand_spring_replaced_date date,
  last_main_stand_spring_replaced_hub  text
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS bike_location_cache_chassis_number_key ON public.bike_location_cache (chassis_number);
CREATE UNIQUE INDEX IF NOT EXISTS rsa_technicians_email_key ON public.rsa_technicians (email);

CREATE INDEX IF NOT EXISTS idx_dqc_hub            ON public.deployment_queue_cache (hub_name);
CREATE INDEX IF NOT EXISTS idx_dqc_hub_model      ON public.deployment_queue_cache (hub_name, bike_model_id, tier);
CREATE INDEX IF NOT EXISTS idx_dqc_refreshed      ON public.deployment_queue_cache (refreshed_at DESC);

CREATE INDEX IF NOT EXISTS idx_fw_alert_chassis   ON public.fw_alert_tracker (chassis_number, alert_sent_at DESC);
CREATE INDEX IF NOT EXISTS fw_wfa_alerts_jc_idx   ON public.fw_wfa_alerts (jc_number, alert_sent_at);

CREATE INDEX IF NOT EXISTS idx_jch_bike_id        ON public.jc_history (bike_id);
CREATE INDEX IF NOT EXISTS idx_jch_jc_date        ON public.jc_history (jc_date DESC);
CREATE INDEX IF NOT EXISTS idx_jch_reg_number     ON public.jc_history (reg_number);
CREATE INDEX IF NOT EXISTS idx_jch_source         ON public.jc_history (source);

CREATE INDEX IF NOT EXISTS idx_oos_queue_hub           ON public.oos_work_queue (hub);
CREATE INDEX IF NOT EXISTS idx_oos_queue_hub_position  ON public.oos_work_queue (hub, queue_position);

CREATE INDEX IF NOT EXISTS idx_pbc_phone      ON public.pending_bookings_cache (phone_number);
CREATE INDEX IF NOT EXISTS idx_pbc_refreshed  ON public.pending_bookings_cache (refreshed_at DESC);

CREATE INDEX IF NOT EXISTS idx_rsa_team_locations_name_time ON public.rsa_team_locations (name, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsa_team_locations_synced_at ON public.rsa_team_locations (synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsa_team_locs_geog           ON public.rsa_team_locations USING gist (location);

CREATE INDEX IF NOT EXISTS idx_rsa_ticket_locs_geog   ON public.rsa_ticket_locations USING gist (location);
CREATE INDEX IF NOT EXISTS idx_rsa_ticket_locs_ticket ON public.rsa_ticket_locations (ticket_number, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsa_ticket_locs_time   ON public.rsa_ticket_locations (synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_rsa_tech_actions_created ON public.rsa_tech_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsa_tech_actions_tech    ON public.rsa_tech_actions (technician_id);
CREATE INDEX IF NOT EXISTS idx_rsa_tech_actions_ticket  ON public.rsa_tech_actions (ticket_number);

-- ============================================================
-- VIEWS
-- ============================================================

CREATE OR REPLACE VIEW public.rsa_tickets_live AS
  SELECT
    ticket_number, status, category, reg_number, technician_name, fault_details,
    created_at_ist, inprogress_at_ist, resolved_at_ist, tat_minutes,
    city, synced_at, lat, lng, live_lat, live_lng,
    bass_location_time_ist AS loc_time,
    CASE WHEN status = 'DONE' THEN lat  ELSE COALESCE(live_lat, lat)  END AS display_lat,
    CASE WHEN status = 'DONE' THEN lng  ELSE COALESCE(live_lng, lng)  END AS display_lng
  FROM public.rsa_tickets_cache;

CREATE OR REPLACE VIEW public.fw_bikes_live AS
  SELECT fp.chassis_number, fp.reg_number, fp.hub,
    bl.lat, bl.lng, bl.baas_location_time AS loc_time,
    bl.current_soc, bl.vehicle_status,
    br.rider_name, br.rider_phone
  FROM public.fw_pending_cache fp
  LEFT JOIN public.bike_location_cache bl USING (chassis_number)
  LEFT JOIN public.bike_rider_cache br USING (chassis_number)
  WHERE bl.lat IS NOT NULL AND bl.lng IS NOT NULL;

CREATE OR REPLACE VIEW public.fw_alert_open AS
  SELECT chassis_number, reg_number, hub_name, jc_number,
    jc_opened_at, alert_sent_at, fw_updated, updated_by, updated_at, notes
  FROM public.fw_alert_tracker
  WHERE fw_updated = false
  ORDER BY alert_sent_at DESC;

CREATE OR REPLACE VIEW public.user_last_login AS
  SELECT DISTINCT ON (user_id) user_id, email, logged_in_at AS last_login_at
  FROM public.login_events
  ORDER BY user_id, logged_in_at DESC;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Geography trigger: auto-populate location from lat/lng
CREATE OR REPLACE FUNCTION public.set_location_from_latlong()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$;

-- RSA summary aggregate (used by health-check / dashboards)
CREATE OR REPLACE FUNCTION public.get_rsa_summary()
RETURNS json LANGUAGE sql AS $$
  SELECT json_build_object(
    'new_count',        COUNT(*) FILTER (WHERE status = 'NEW'),
    'inprogress_count', COUNT(*) FILTER (WHERE status = 'IN_PROGRESS'),
    'done_count',       COUNT(*) FILTER (WHERE status = 'DONE'),
    'total',            COUNT(*),
    'avg_closure_tat',  ROUND(AVG(tat_minutes) FILTER (WHERE status = 'DONE' AND tat_minutes IS NOT NULL)::numeric, 1),
    'avg_response_tat', ROUND(AVG(
        EXTRACT(EPOCH FROM (inprogress_at_ist::timestamptz - created_at_ist::timestamptz)) / 60.0
      ) FILTER (WHERE inprogress_at_ist IS NOT NULL AND created_at_ist IS NOT NULL)::numeric, 1),
    'over_1hr_pct', ROUND((COUNT(*) FILTER (WHERE tat_minutes > 60)::numeric / NULLIF(COUNT(*),0) * 100)::numeric, 1)
  ) FROM public.rsa_tickets_cache;
$$;

-- RSA ticket trail distance
CREATE OR REPLACE FUNCTION public.get_ticket_trail_km(p_ticket text)
RETURNS numeric LANGUAGE sql AS $$
  SELECT ROUND(COALESCE(SUM(ST_Distance(prev_loc, location)) / 1000.0, 0)::numeric, 2)
  FROM (
    SELECT location, lag(location) OVER (ORDER BY synced_at) AS prev_loc
    FROM public.rsa_ticket_locations
    WHERE ticket_number = p_ticket AND location IS NOT NULL
  ) sub
  WHERE prev_loc IS NOT NULL;
$$;

-- RSA team trail distance
CREATE OR REPLACE FUNCTION public.get_team_trail_km(p_name text, p_from timestamptz, p_to timestamptz)
RETURNS numeric LANGUAGE sql AS $$
  SELECT ROUND(COALESCE(SUM(ST_Distance(prev_loc, location)) / 1000.0, 0)::numeric, 2)
  FROM (
    SELECT location, lag(location) OVER (ORDER BY synced_at) AS prev_loc
    FROM public.rsa_team_locations
    WHERE name = p_name AND synced_at BETWEEN p_from AND p_to AND location IS NOT NULL
  ) sub
  WHERE prev_loc IS NOT NULL;
$$;

-- Health check ping (used by health-check edge fn)
CREATE OR REPLACE FUNCTION public.health_check_ping()
RETURNS integer LANGUAGE sql AS $$ SELECT 1; $$;

CREATE OR REPLACE FUNCTION public.health_check()
RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;

-- Login event logger (called from auth trigger)
CREATE OR REPLACE FUNCTION public.log_login_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.login_events (user_id, email, session_id, logged_in_at)
  SELECT NEW.user_id, u.email, NEW.id, NEW.created_at
  FROM auth.users u WHERE u.id = NEW.user_id;
  RETURN NEW;
END;
$$;

-- Signup restriction: @bounceshare.com only (auth hook)
CREATE OR REPLACE FUNCTION public.restrict_signup_to_bounceshare(event jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE email text;
BEGIN
  email := event->>'email';
  IF email IS NOT NULL AND email NOT ILIKE '%@bounceshare.com' THEN
    RAISE EXCEPTION 'Only @bounceshare.com email addresses are permitted to sign up.';
  END IF;
  RETURN event;
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER trg_team_loc_geog
  BEFORE INSERT OR UPDATE ON public.rsa_team_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_location_from_latlong();

CREATE TRIGGER trg_ticket_loc_geog
  BEFORE INSERT OR UPDATE ON public.rsa_ticket_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_location_from_latlong();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.app_settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_location_cache       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_rider_cache          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_queue_cache    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fw_alert_tracker          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fw_pending_cache          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fw_rsa_alerts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fw_wfa_alerts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jc_history                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oos_work_queue            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_bookings_cache    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_locations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rsa_tech_actions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rsa_technicians           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rsa_ticket_locations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rsa_tickets_cache         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rsa_team_locations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_parts_check_flag  ENABLE ROW LEVEL SECURITY;

-- app_settings
CREATE POLICY "authenticated users can read app_settings"   ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "authenticated users can update app_settings" ON public.app_settings FOR UPDATE USING (true) WITH CHECK (true);

-- bike_location_cache
CREATE POLICY "anon_read" ON public.bike_location_cache FOR SELECT USING (true);

-- bike_rider_cache
CREATE POLICY "public read bike_rider_cache"        ON public.bike_rider_cache FOR SELECT USING (true);
CREATE POLICY "authenticated read bike_rider_cache" ON public.bike_rider_cache FOR SELECT USING (true);

-- deployment_queue_cache
CREATE POLICY "auth read deployment_queue_cache" ON public.deployment_queue_cache FOR SELECT USING (true);

-- feedback
CREATE POLICY "Authenticated read feedback"   ON public.feedback FOR SELECT USING (true);
CREATE POLICY "Authenticated insert feedback" ON public.feedback FOR INSERT WITH CHECK (true);

-- fw_alert_tracker
CREATE POLICY "anon_select_fw_alert_tracker" ON public.fw_alert_tracker FOR SELECT USING (true);
CREATE POLICY "anon_insert_fw_alert_tracker" ON public.fw_alert_tracker FOR INSERT WITH CHECK (true);

-- fw_pending_cache
CREATE POLICY "anon read fw_pending_cache"          ON public.fw_pending_cache FOR SELECT USING (true);
CREATE POLICY "authenticated read fw_pending_cache" ON public.fw_pending_cache FOR SELECT USING (true);

-- fw_rsa_alerts
CREATE POLICY "anon select" ON public.fw_rsa_alerts FOR SELECT USING (true);
CREATE POLICY "anon insert" ON public.fw_rsa_alerts FOR INSERT WITH CHECK (true);

-- fw_wfa_alerts
CREATE POLICY "anon_select_fw_wfa_alerts" ON public.fw_wfa_alerts FOR SELECT USING (true);
CREATE POLICY "anon_insert_fw_wfa_alerts" ON public.fw_wfa_alerts FOR INSERT WITH CHECK (true);

-- jc_history
CREATE POLICY "Authenticated read jc_history" ON public.jc_history FOR SELECT USING (true);

-- login_events
CREATE POLICY "Users view own login events" ON public.login_events FOR SELECT USING (auth.uid() = user_id);

-- oos_work_queue
CREATE POLICY "Allow authenticated read" ON public.oos_work_queue FOR SELECT USING (true);

-- pending_bookings_cache
CREATE POLICY "auth read pending_bookings_cache" ON public.pending_bookings_cache FOR SELECT USING (true);

-- rental_locations
CREATE POLICY "anon_read" ON public.rental_locations FOR SELECT USING (true);

-- rsa_tech_actions
CREATE POLICY "tech_actions_anon_read" ON public.rsa_tech_actions FOR SELECT USING (true);
CREATE POLICY "tech_actions_read"      ON public.rsa_tech_actions FOR SELECT USING (true);
CREATE POLICY "tech_actions_insert"    ON public.rsa_tech_actions FOR INSERT WITH CHECK (technician_id = auth.uid());

-- rsa_technicians
CREATE POLICY "tech_read_own"          ON public.rsa_technicians FOR SELECT USING (id = auth.uid());
CREATE POLICY "tech_read_all_for_admin" ON public.rsa_technicians FOR SELECT USING (true);

-- rsa_ticket_locations (NOTE: RLS disabled in prod — intentional, internal table)
CREATE POLICY "anon read" ON public.rsa_ticket_locations FOR SELECT USING (true);

-- rsa_tickets_cache
CREATE POLICY "anon read" ON public.rsa_tickets_cache FOR SELECT USING (true);

-- rsa_team_locations (NOTE: RLS disabled in prod — intentional, internal table)
CREATE POLICY "anon read" ON public.rsa_team_locations FOR SELECT USING (true);

-- vehicle_parts_check_flag
CREATE POLICY "Authenticated read vehicle_parts_check_flag" ON public.vehicle_parts_check_flag FOR SELECT USING (true);
