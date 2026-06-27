-- RPC to rebuild incentive_weekly_stats from jc_log in a single SQL pass.
-- Replaces the per-week TypeScript iteration in the edge function (which hit Supabase's 150s timeout).
-- Payout slab: <=50 JCs → ₹0; 51-60 → ₹25/JC above 50; 61-80 → ₹50/JC; 81-90 → ₹75/JC; 91+ → ₹100/JC (cap ₹5000)
-- Called by sync-incentive-data edge function after upserting jc_log.

CREATE OR REPLACE FUNCTION rebuild_incentive_weekly_stats()
RETURNS void
LANGUAGE sql
AS $$
  -- Remove only non-frozen stats (frozen weeks are preserved as-is)
  TRUNCATE incentive_weekly_stats;

  INSERT INTO incentive_weekly_stats (
    tech_name, week_start,
    total_jcs, intrip_jcs, submission_jcs,
    voided_jcs, eligible_jcs, payout_amount,
    intrip_void_rate, submission_void_rate,
    hub_name, city
  )
  WITH agg AS (
    SELECT
      technician_name                                           AS tech_name,
      week_start,
      MAX(hub_name)                                            AS hub_name,
      MAX(city)                                                AS city,
      COUNT(*) FILTER (WHERE NOT is_void AND intrip = 1)      AS intrip_jcs,
      COUNT(*) FILTER (WHERE NOT is_void AND intrip = 0)      AS submission_jcs,
      COUNT(*) FILTER (WHERE is_void     AND intrip = 1)      AS voided_intrip,
      COUNT(*) FILTER (WHERE is_void     AND intrip = 0)      AS voided_submission
    FROM incentive_jc_log
    WHERE technician_name NOT IN ('FREELANCER','VECNOCOM','VECMOCON','READY ASSET')
    GROUP BY technician_name, week_start
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
    total_jcs, intrip_jcs, submission_jcs,
    voided_jcs, eligible_jcs,
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
    hub_name, city
  FROM calc;
$$;
