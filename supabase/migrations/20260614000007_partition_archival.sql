-- Session 11: Partition archival infrastructure (Task 2.7)
--
-- Runs monthly: finds location partitions >90 days old, calls
-- archive-location-partition edge fn to export as Arrow IPC to Supabase
-- Storage (location-archives bucket), then drops the partition.
--
-- One-time setup required after applying:
--   1. Generate a token: openssl rand -hex 32
--   2. Store in Supabase Vault (SQL editor):
--      SELECT vault.create_secret('<token>', 'archive_cron_secret', 'Archive cron auth');
--   3. Set same token in Edge Functions → archive-location-partition → Secrets:
--      ARCHIVE_CRON_SECRET = <same token>
--
-- NOTE: ALTER DATABASE SET is blocked in Supabase (permission denied).
-- Use vault.create_secret() instead — that's what schedule_partition_archival() reads.
--
-- Rollback:
--   SELECT cron.unschedule('archive-old-location-partitions');
--   DROP FUNCTION IF EXISTS public.schedule_partition_archival();
--   DROP FUNCTION IF EXISTS public.drop_location_partition(text);
--   DROP TABLE IF EXISTS partition_archive_log;

-- ── 1. Archive log table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partition_archive_log (
  id             bigserial PRIMARY KEY,
  table_name     text        NOT NULL,
  partition_name text        NOT NULL,
  row_count      bigint      NOT NULL,
  file_bytes     bigint,
  storage_path   text        NOT NULL,
  archived_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE partition_archive_log ENABLE ROW LEVEL SECURITY;
-- Admins can read; service role writes
CREATE POLICY "authenticated_read" ON partition_archive_log
  FOR SELECT TO authenticated USING (true);

-- ── 2. SECURITY DEFINER RPC: drop a named location partition ─────────────────
-- Called by the edge fn after a successful archive upload.
-- SECURITY DEFINER so the edge fn (authenticated role) can execute DDL.
CREATE OR REPLACE FUNCTION public.drop_location_partition(p_partition_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  parent_table text;
BEGIN
  -- Validate pattern: rsa_(ticket|team)_locations_YYYY_MM
  IF p_partition_name !~ '^rsa_(ticket|team)_locations_\d{4}_\d{2}$' THEN
    RAISE EXCEPTION 'Invalid partition name: %', p_partition_name;
  END IF;

  -- Derive parent table name by stripping _YYYY_MM suffix
  parent_table := regexp_replace(p_partition_name, '_\d{4}_\d{2}$', '');

  EXECUTE format(
    'ALTER TABLE %I DETACH PARTITION %I',
    parent_table,
    p_partition_name
  );
  EXECUTE format('DROP TABLE %I', p_partition_name);

  RAISE NOTICE 'Dropped partition: %', p_partition_name;
END;
$$;

-- ── 3. Scheduler: finds stale partitions, calls edge fn per partition ─────────
-- Called by pg_cron on the 1st of each month.
-- Reads ARCHIVE_CRON_SECRET from database setting set by admin (see setup above).
CREATE OR REPLACE FUNCTION public.schedule_partition_archival()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r          record;
  upper_ts   timestamptz;
  arc_secret text;
  fn_url     text := 'https://clkfvmmlgwcvntxnolsv.supabase.co/functions/v1/archive-location-partition';
BEGIN
  -- Read from Supabase Vault (ALTER DATABASE SET is blocked in Supabase)
  SELECT decrypted_secret INTO arc_secret
  FROM vault.decrypted_secrets
  WHERE name = 'archive_cron_secret'
  LIMIT 1;

  IF arc_secret IS NULL OR arc_secret = '' THEN
    RAISE EXCEPTION 'archive_cron_secret not in vault — run: SELECT vault.create_secret(''<token>'', ''archive_cron_secret'');';
  END IF;

  FOR r IN
    SELECT
      parent.relname AS table_name,
      child.relname  AS partition_name,
      pg_get_expr(child.relpartbound, child.oid) AS bounds
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
    WHERE parent.relname IN ('rsa_ticket_locations', 'rsa_team_locations')
      AND child.relname NOT LIKE '%default%'
  LOOP
    -- Skip DEFAULT partition (no upper bound)
    CONTINUE WHEN r.bounds NOT LIKE 'FOR VALUES FROM%';

    -- Extract upper bound from e.g. "FOR VALUES FROM ('2026-06-01 ...') TO ('2026-07-01 ...')"
    upper_ts := (regexp_match(r.bounds, 'TO \(''([^'']+)''\)'))[1]::timestamptz;

    -- Only archive if upper bound is >90 days ago
    CONTINUE WHEN upper_ts >= now() - interval '90 days';

    -- Skip if already archived
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM partition_archive_log
      WHERE partition_name = r.partition_name
    );

    RAISE NOTICE 'Scheduling archival: %', r.partition_name;

    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'x-archive-secret', arc_secret
      ),
      body    := jsonb_build_object(
        'table',     r.table_name,
        'partition', r.partition_name
      ),
      timeout_milliseconds := 120000
    );
  END LOOP;
END;
$$;

-- ── 4. pg_cron job: 1st of each month at 02:00 UTC (07:30 IST) ───────────────
SELECT cron.schedule(
  'archive-old-location-partitions',
  '0 2 1 * *',
  'SELECT public.schedule_partition_archival()'
);
