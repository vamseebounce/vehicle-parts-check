-- Reconciliation: brings git in sync with the live rebuild_incentive_weekly_stats function.
-- Live function had diverged significantly from the original migration (20260627000002):
--   • Switched from LANGUAGE sql → plpgsql (needed for DELETE + INSERT in one fn)
--   • TRUNCATE → DELETE WHERE is_frozen = false (preserves frozen weeks)
--   • COUNT(*) → SUM(jc_weight) for weighted JC counting (v17 edge fn)
--   • Added open_weeks CTE to skip frozen week_starts
--   • Added VAMSEE - HEBBALA to exclusion list
--   • MAX(hub_name) → MODE() WITHIN GROUP (ORDER BY hub_name) — dominant hub fix
--   • MAX(city)     → MODE() WITHIN GROUP (ORDER BY city)     — same fix for city
-- Applied live 2026-07-02 by Cowork (MODE fix) on top of prior Claude Code patches.

CREATE OR REPLACE FUNCTION public.rebuild_incentive_weekly_stats()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM incentive_weekly_stats WHERE is_frozen = false;

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
      l.technician_name                                                                 AS tech_name,
      l.week_start,
      MODE() WITHIN GROUP (ORDER BY l.hub_name)                                        AS hub_name,
      MODE() WITHIN GROUP (ORDER BY l.city)                                            AS city,
      COALESCE(SUM(l.jc_weight) FILTER (WHERE NOT l.is_void AND l.intrip = 1), 0)      AS intrip_jcs,
      COALESCE(SUM(l.jc_weight) FILTER (WHERE NOT l.is_void AND l.intrip = 0), 0)      AS submission_jcs,
      COALESCE(SUM(l.jc_weight) FILTER (WHERE l.is_void     AND l.intrip = 1), 0)      AS voided_intrip,
      COALESCE(SUM(l.jc_weight) FILTER (WHERE l.is_void     AND l.intrip = 0), 0)      AS voided_submission
    FROM incentive_jc_log l
    INNER JOIN open_weeks w ON w.week_start = l.week_start
    WHERE l.technician_name NOT IN (
      'FREELANCER', 'VECNOCOM', 'VECMOCON', 'READY ASSET', 'VAMSEE - HEBBALA'
    )
    GROUP BY l.technician_name, l.week_start
  ),
  calc AS (
    SELECT
      tech_name, week_start, hub_name, city,
      intrip_jcs, submission_jcs,
      voided_intrip + voided_submission                                                 AS voided_jcs,
      intrip_jcs + submission_jcs                                                       AS eligible_jcs,
      intrip_jcs + submission_jcs + voided_intrip + voided_submission                   AS total_jcs,
      CASE WHEN (intrip_jcs + voided_intrip) > 0
        THEN voided_intrip::float / (intrip_jcs + voided_intrip) ELSE 0 END             AS intrip_void_rate,
      CASE WHEN (submission_jcs + voided_submission) > 0
        THEN voided_submission::float / (submission_jcs + voided_submission) ELSE 0 END AS submission_void_rate
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
    ))::int                                                                              AS payout_amount,
    intrip_void_rate, submission_void_rate,
    hub_name, city,
    false                                                                                AS is_frozen
  FROM calc;
END;
$function$;
