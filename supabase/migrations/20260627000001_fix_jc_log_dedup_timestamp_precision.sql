-- Fix duplicate jc_log rows caused by sub-second timestamp drift between Metabase API calls.
-- The /query/json endpoint alternates between returning microseconds and not,
-- causing the same JC to be inserted multiple times with slightly different datetimes.
-- Fix: change jc_billed_datetime to timestamp(0) — Postgres auto-truncates sub-seconds on insert.

-- Wipe duplicate data (safe: all data re-synced from Metabase via edge function)
TRUNCATE incentive_jc_log;
TRUNCATE incentive_weekly_stats;

-- Change column precision to 0 (no sub-seconds)
ALTER TABLE incentive_jc_log
  ALTER COLUMN jc_billed_datetime TYPE timestamp(0) with time zone
  USING date_trunc('second', jc_billed_datetime);

-- Re-add unique constraint with correct column (technician_name_raw, not technician_name)
ALTER TABLE incentive_jc_log
  DROP CONSTRAINT IF EXISTS incentive_jc_log_jc_billed_datetime_technician_name_re_key;
ALTER TABLE incentive_jc_log
  DROP CONSTRAINT IF EXISTS incentive_jc_log_jc_billed_datetime_technician_name_raw_reg_number_key;
ALTER TABLE incentive_jc_log
  DROP CONSTRAINT IF EXISTS incentive_jc_log_unique_jc;

ALTER TABLE incentive_jc_log
  ADD CONSTRAINT incentive_jc_log_unique_jc
  UNIQUE (jc_billed_datetime, technician_name_raw, reg_number);
