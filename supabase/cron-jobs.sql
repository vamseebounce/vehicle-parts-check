-- ============================================================
-- FLEETPRO — CRON JOB DEFINITIONS
-- Captured: 2026-06-11
-- ============================================================
-- Replace <SERVICE_ROLE_KEY> and <ANON_KEY> with actual values
-- from Supabase dashboard → Project Settings → API.
-- ⚠️  Never commit real keys to git.
-- ============================================================
-- To apply on a new project:
--   Run each SELECT cron.schedule(...) in the Supabase SQL editor.
-- To view current jobs on live project:
--   SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
-- ============================================================

-- JOB 1: metabase-hourly-sync (vehicle_parts_check_flag)
-- Calls metabase-sync edge fn every hour at :00
SELECT cron.schedule(
  'metabase-hourly-sync',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/metabase-sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      timeout_milliseconds := 5000
    );
  $$
);

-- JOB 2: OOS_QUEUE-hourly (oos_work_queue)
-- Calls OOS_QUEUE edge fn every hour at :05
SELECT cron.schedule(
  'OOS_QUEUE-hourly',
  '5 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/OOS_QUEUE',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      timeout_milliseconds := 30000
    );
  $$
);

-- JOB 6: refresh-deployment-cache (deployment_queue_cache + pending_bookings_cache)
-- Every 15 min, no auth (verify_jwt=false on the fn)
SELECT cron.schedule(
  'refresh-deployment-cache',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/refresh-deployment-cache',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- JOB 7: jc-history-daily-sync (jc_history)
-- Daily at 20:30 UTC (02:00 IST)
SELECT cron.schedule(
  'jc-history-daily-sync',
  '30 20 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/jc-history-sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      timeout_milliseconds := 60000
    );
  $$
);

-- JOB 9: fw-map-rider-sync (bike_rider_cache)
-- Every hour at :00 (verify_jwt=false — no auth header needed)
SELECT cron.schedule(
  'fw-map-rider-sync-10min',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url  := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/fw-map-rider-sync',
      body := '{}'::jsonb
    );
  $$
);

-- JOB 10: fw-sheet-sync-15min (fw_pending_cache)
-- Every 15 min. Uses anon key because verify_jwt=true on this fn.
SELECT cron.schedule(
  'fw-sheet-sync-15min',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/fw-sheet-sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <ANON_KEY>',
        'apikey',        '<ANON_KEY>'
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- JOB 11: bike-location-sync-5min (bike_location_cache)
-- Every hour at :00 (no auth, verify_jwt=false)
-- NOTE: name says "5min" but schedule is hourly — matches actual cadence in prod
SELECT cron.schedule(
  'bike-location-sync-5min',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/bike-location-sync',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- JOB 13: rsa-ticket-sync-2min (rsa_tickets_cache + location trails)
-- Every 2 min. verify_jwt=false — no auth header needed.
-- ⚠️  The live prod job had over-escaped headers causing failures.
--     This version uses correct escaping.
SELECT cron.schedule(
  'rsa-ticket-sync-2min',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/rsa-ticket-sync',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- JOB 14: rsa-team-track-2min (rsa_team_locations)
-- Pure SQL — no edge fn. Appends Nishanth/Pavan GPS from bike_location_cache.
SELECT cron.schedule(
  'rsa-team-track-2min',
  '*/2 * * * *',
  $$
    INSERT INTO rsa_team_locations (name, chassis, reg_number, lat, lng, synced_at)
    SELECT
      CASE b.chassis_number
        WHEN 'P6EBE1JYK25000288' THEN 'Nishanth'
        WHEN 'P6EBE1JYK25000072' THEN 'Pavan'
      END,
      b.chassis_number,
      CASE b.chassis_number
        WHEN 'P6EBE1JYK25000288' THEN 'KA05AR5056'
        WHEN 'P6EBE1JYK25000072' THEN 'KA05AR3238'
      END,
      b.lat, b.lng, now()
    FROM bike_location_cache b
    WHERE b.chassis_number IN ('P6EBE1JYK25000288', 'P6EBE1JYK25000072')
      AND b.lat IS NOT NULL AND b.lng IS NOT NULL;
  $$
);

-- ============================================================
-- SUMMARY
-- ============================================================
-- jobid | name                      | schedule     | notes
-- ------+---------------------------+--------------+--------
--   1   | metabase-hourly-sync      | 0 * * * *    | vehicle_parts_check_flag
--   2   | OOS_QUEUE-hourly          | 5 * * * *    | oos_work_queue
--   6   | refresh-deployment-cache  | */15 * * * * | deployment + pending_bookings caches
--   7   | jc-history-daily-sync     | 30 20 * * *  | jc_history (02:00 IST)
--   9   | fw-map-rider-sync-10min   | 0 * * * *    | bike_rider_cache (hourly)
--  10   | fw-sheet-sync-15min       | */15 * * * * | fw_pending_cache (anon key)
--  11   | bike-location-sync-5min   | 0 * * * *    | bike_location_cache (hourly in prod)
--  13   | rsa-ticket-sync-2min      | */2 * * * *  | rsa_tickets_cache + trails
--  14   | rsa-team-track-2min              | */2 * * * *  | rsa_team_locations (pure SQL)
--  16   | health-egress-daily              | 0 3 * * *    | DB + egress alert (03:00 UTC / 08:30 IST)
--  17   | rsa-ticket-sync-2min (recreated) | */2 * * * *  | replaced job 13 (header fix)
--  18   | create_monthly_location_partitions | 0 0 25 * * | pre-creates next month's location partitions
--  19   | archive-old-location-partitions  | 0 2 1 * *    | archives + drops partitions >90 days

-- ============================================================
-- Task 5.6: Daily health + egress check (08:30 IST = 03:00 UTC)
-- Calls health-check edge fn; fn emails if DB unhealthy OR egress > 70%
-- Requires: MGMT_TOKEN secret in edge fn secrets
-- ============================================================
SELECT cron.schedule(
  'health-egress-daily',
  '0 3 * * *',
  $$
    SELECT net.http_get(
      url := (SELECT 'https://' || (SELECT value FROM vault.secrets WHERE name = 'project_url') || '/functions/v1/health-check')
    );
  $$
);
-- Simpler alternative if vault not set up — paste your project URL directly:
-- url := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/health-check'
--  15  | health-egress-daily       | 0 3 * * *    | DB + egress alert (03:00 UTC / 08:30 IST)

-- ============================================================
-- TRACE & HUNTER — Cron Jobs
-- ============================================================
-- These three edge functions use verify_jwt=false.
-- Crons use service-role Authorization header as a best-practice
-- guard against accidental unauthenticated triggers.
--
-- 6 PM IST sequence (staggered to ensure Step 0 finishes first):
--   12:30 UTC → recovery-blocked-sync  (Step 0: Google Sheet → blocked list)
--   12:35 UTC → zone-cluster           (Step 1: k-means + assignment)
-- ============================================================

-- JOB T1: recovery-ticket-sync (every 5 min)
-- Opens new tickets from Q1; reconciles open tickets via Q2.
-- verify_jwt=false on the edge fn.
SELECT cron.schedule(
  'recovery-ticket-sync-5min',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/recovery-ticket-sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- JOB T2: recovery-blocked-sync (6 PM IST = 12:30 UTC)
-- Step 0: full-replace recovery_blocked_vehicles from Google Sheet.
-- Fail-safe: if Sheet unreachable, keeps existing table.
SELECT cron.schedule(
  'recovery-blocked-sync-daily',
  '30 12 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/recovery-blocked-sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- JOB T3: zone-cluster (6:05 PM IST = 12:35 UTC, 5 min after blocked-sync)
-- Step 1: per-city balanced k-means, NE/NW/SE/SW labeling,
--         hunter assignment, upsert zone_configs, update recovery_tickets.
SELECT cron.schedule(
  'zone-cluster-daily',
  '35 12 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/zone-cluster',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);

-- SUMMARY (Trace & Hunter additions):
--   T1 | recovery-ticket-sync-5min  | */5 * * * *  | Q1 new tickets + Q2 reconciliation
--   T2 | recovery-blocked-sync-daily | 30 12 * * * | blocked list sync (6 PM IST Step 0)
--   T3 | zone-cluster-daily         | 35 12 * * *  | k-means clustering (6:05 PM IST Step 1)

-- ============================================================
-- Task 2.7: Archive old location partitions to Supabase Storage
-- 1st of each month at 02:00 UTC (07:30 IST)
-- Finds rsa_ticket_locations + rsa_team_locations partitions >90 days old,
-- calls archive-location-partition edge fn per partition.
-- Edge fn: exports as Arrow IPC (.arrow) to location-archives bucket, then drops partition.
--
-- ⚠️  One-time setup required:
--   1. Supabase dashboard → Edge Functions → Secrets → Add:
--      ARCHIVE_CRON_SECRET = <generate a random token, e.g. openssl rand -hex 32>
--   2. Run in SQL editor:
--      ALTER DATABASE postgres SET app.archive_cron_secret = '<same token>';
-- ============================================================
SELECT cron.schedule(
  'archive-old-location-partitions',
  '0 2 1 * *',
  $$SELECT public.schedule_partition_archival()$$
);
--  19  | archive-old-location-partitions | 0 2 1 * *  | location partition archival (02:00 UTC / 07:30 IST)
