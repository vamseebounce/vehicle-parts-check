-- Freeze completed incentive weeks so payout numbers don't drift as comeback data matures.
-- A week is frozen on Thursday of the following week (week_start + 10 days),
-- giving the full 3-day comeback window for Sunday's JCs to close, plus 1 buffer day.
-- Frozen rows are never overwritten by subsequent syncs.

-- 1. Add is_frozen column
ALTER TABLE incentive_weekly_stats
  ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Freeze any already-completed weeks retroactively
UPDATE incentive_weekly_stats
SET is_frozen = true
WHERE week_start + INTERVAL '10 days' < CURRENT_DATE;

-- 3. freeze_completed_weeks() — called at start of every sync
CREATE OR REPLACE FUNCTION freeze_completed_weeks()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE incentive_weekly_stats
  SET is_frozen = true
  WHERE is_frozen = false
    AND week_start + INTERVAL '10 days' < CURRENT_DATE;
$$;

-- 4. rebuild_incentive_weekly_stats() — updated to skip frozen weeks
CREATE OR REPLACE FUNCTION rebuild_incentive_weekly_stats()
RETURNS void
LANGUAGE sql
AS $$
  -- Delete only non-frozen stats (frozen weeks preserved as-is)
  DELETE FROM incentive_weekly_stats WHERE is_frozen = false;

  -- Re-insert stats for all non-frozen weeks from jc_log
  INSERT INTO incentive_weekly_stats (
    tech_name, week_start,
    total_jcs, intrip_jcs, submission_jcs,
    voided_jcs, eligible_jcs, payout_amount,
    intrip_void_rate, submission_void_rate,
    hub_name, city, is_frozen
  )
  WITH open_weeks AS (
    SELECT DISTINCT week_start FROM incentive_jc_log
    WHERE week_start NOT IN (
      SELECT DISTINCT week_start FROM incentive_weekly_stats WHERE is_frozen = true
    )
  ),
  agg AS (
    SELECT
      l.technician_name                                         AS tech_name,
      l.week_start,
      MAX(l.hub_name)                                          AS hub_name,
      MAX(l.city)                                              AS city,
      COUNT(*) FILTER (WHERE NOT l.is_void AND l.intrip = 1)  AS intrip_jcs,
      COUNT(*) FILTER (WHERE NOT l.is_void AND l.intrip = 0)  AS submission_jcs,
      COUNT(*) FILTER (WHERE l.is_void     AND l.intrip = 1)  AS voided_intrip,
      COUNT(*) FILTER (WHERE l.is_void     AND l.intrip = 0)  AS voided_submission
    FROM incentive_jc_log l
    INNER JOIN open_weeks w ON w.week_start = l.week_start
    WHERE l.technician_name NOT IN ('FREELANCER','VECNOCOM','VECMOCON','READY ASSET')
    GROUP BY l.technician_name, l.week_start
  ),
  calc AS (
    SELECT
      tech_name, week_start, hub_name, city,
      intrip_jcs, submission_jcs,
      voided_intrip + voided_submission                        AS voided_jcs,
      intrip_jcs + submission_jcs                              AS eligible_jcs,
      intrip_jcs + submission_jcs + voided_intrip + voided_submission AS total_jcs,
      CASE WHEN (intrip_jcs + voided_intrip) > 0
        THEN voided_intrip::float / (intrip_jcs + voided_intrip)
        ELSE 0 END                                             AS intrip_void_rate,
      CASE WHEN (submission_jcs + voided_submission) > 0
        THEN voided_submission::float / (submission_jcs + voided_submission)
        ELSE 0 END                                             AS submission_void_rate
    FROM agg
  )
  SELECT
    tech_name, week_start,
    total_jcs, intrip_jcs, submission_jcs, voided_jcs, eligible_jcs,
    LEAST(5000, GREATEST(0,
      CASE WHEN eligible_jcs <= 50 THEN 0
        ELSE
          LEAST(eligible_jcs - 50, 10) * 25
          + GREATEST(0, LEAST(eligible_jcs - 60, 20)) * 50
          + GREATEST(0, LEAST(eligible_jcs - 80, 10)) * 75
          + GREATEST(0, eligible_jcs - 90) * 100
      END
    ))::int                                                    AS payout_amount,
    intrip_void_rate, submission_void_rate,
    hub_name, city,
    false                                                      AS is_frozen
  FROM calc;
$$;
