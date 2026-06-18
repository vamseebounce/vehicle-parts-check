-- Trace & Hunter — Q1: New Ticket Detection (Edge Function, every 5 mins)
-- Base: Metabase question 15a9e8c2-ecfd-4750-9455-99f616cb4df7
--
-- Changes from original Metabase query:
--   1. Metabase template variables removed (city_name, model_name, reg_number filters)
--   2. bol.id AS source_ops_log_id  — unique anchor for recovery_tickets row
--   3. bol.created_at_utc           — full timestamp preserved (not cast to ::date)
--   4. hours_in_recovery            — computed from full timestamp for color coding
--   5. baas_lat, baas_long, baas_location_time — bike GPS for map pins + clustering
--   6. ORDER BY hours_in_recovery DESC (most overdue first)

WITH bike_filter AS (
  SELECT
    b.id AS bike_id,
    b.reg_number,
    b.chassis_number,
    b.vehicle_status,
    b.bike_model_id,
    b.baas_lat,
    b.baas_long,
    b.baas_location_time,
    m.model_name,
    rl.city_id,
    c.name AS city_name,
    CASE
      WHEN b.bike_model_id = 1 THEN 'high_speed'
      WHEN b.bike_model_id = 3 THEN 'low_speed'
      WHEN b.bike_model_id = 5 THEN 'high_speed_pro'
      ELSE 'other'
    END AS speed_segment
  FROM bike b
  JOIN rental_location rl ON b.bike_location = rl.id
  JOIN (
    SELECT id, name FROM city
    WHERE id IN (1, 2, 5)
  ) c ON rl.city_id = c.id
  JOIN (
    SELECT id, model_name FROM bike_model
    WHERE id NOT IN (2, 4)
  ) m ON b.bike_model_id = m.id
  WHERE b.reg_number NOT LIKE 'test%'
    AND b.bike_model_id NOT IN (2, 4)
),
latest_ops AS (
  SELECT
    bol.id            AS ops_log_id,      -- unique id of this ops_log row
    bol.bike_id,
    bol.created_at_utc,                   -- full timestamp preserved
    (bol.created_at_utc AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS created_at_ist,
    bol.new_vehicle_status,
    ROW_NUMBER() OVER (PARTITION BY bol.bike_id ORDER BY bol.created_at_utc DESC) AS rn
  FROM bike_operations_log bol
  JOIN bike_filter bf ON bol.bike_id = bf.bike_id
  WHERE bol.new_vehicle_status IS NOT NULL
),
latest_mfr AS (
  SELECT
    bike_id,
    ops_log_id,
    created_at_utc,
    created_at_ist
  FROM latest_ops
  WHERE rn = 1
    AND new_vehicle_status = 'marked for recovery'
),
bike_mfr_age AS (
  SELECT
    bf.bike_id,
    bf.reg_number,
    bf.chassis_number,
    bf.model_name,
    bf.speed_segment,
    bf.city_name,
    bf.baas_lat,
    bf.baas_long,
    bf.baas_location_time,
    lm.ops_log_id                                                                              AS source_ops_log_id,
    lm.created_at_utc                                                                          AS marked_at_utc,
    (lm.created_at_utc AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')                        AS marked_at_ist,
    lm.created_at_ist                                                                          AS marked_for_recovery_since,
    (CURRENT_DATE - lm.created_at_ist)::int                                                   AS age_days,
    EXTRACT(EPOCH FROM (NOW() - lm.created_at_utc)) / 3600                                    AS hours_in_recovery
  FROM latest_mfr lm
  JOIN bike_filter bf ON bf.bike_id = lm.bike_id
  WHERE bf.vehicle_status = 'marked for recovery'
),
latest_booking AS (
  SELECT DISTINCT ON (bk.bike_id)
    bk.bike_id,
    bk.user_id,
    bk.pricing_type AS plan_type,
    bk.booking_start_time,
    bk.booking_end_time,
    bk.km_left
  FROM booking bk
  JOIN bike_mfr_age bma ON bk.bike_id = bma.bike_id
  WHERE bk.city_id IN (1, 2, 5)
    AND bk.bike_model_id NOT IN (2, 4)
    AND booking_start_time IS NOT NULL
    AND bk.status IN (
      'booking started and is in progress',
      'booking renewed in another plan',
      'renewal payment confirmed and booking extended',
      'booking started and plan has expired',
      'booking complete and has no dues',
      'booking complete and has dues',
      'payment confirmed and waiting for user to come to hub',
      'user in hub and bike allocated'
    )
  ORDER BY bk.bike_id, bk.booking_start_time DESC
),
-- OUTBOUND: people this user referred (used for cool-off eligibility check)
referrals_made AS (
  SELECT
    r.referer_id AS user_id,
    COUNT(*) AS referred_count,
    STRING_AGG(COALESCE(ru.phone_number, r.referee_phone_number), ', ' ORDER BY r.id) AS referred_phone_numbers,
    STRING_AGG(COALESCE(ru.full_name, '(not signed up)'),          ', ' ORDER BY r.id) AS referred_names
  FROM referrals r
  LEFT JOIN "user" ru ON ru.id = r.referee_id
  GROUP BY r.referer_id
),
-- INBOUND: person who referred this user (used for cool-off eligibility check)
referred_by AS (
  SELECT
    r.referee_id AS user_id,
    STRING_AGG(ru.phone_number, ', ' ORDER BY r.id) AS referrer_phone_number,
    STRING_AGG(ru.full_name,    ', ' ORDER BY r.id) AS referrer_name
  FROM referrals r
  JOIN "user" ru ON ru.id = r.referer_id
  WHERE r.referee_id IS NOT NULL
  GROUP BY r.referee_id
)
SELECT
  -- Ticket anchor
  bma.source_ops_log_id,
  bma.bike_id,
  bma.reg_number,
  bma.chassis_number,
  bma.model_name,
  bma.speed_segment,
  bma.city_name,

  -- Bike GPS (map pins + zone clustering input)
  bma.baas_lat,
  bma.baas_long,
  bma.baas_location_time,

  -- Timing
  bma.marked_at_utc,
  bma.marked_at_ist,
  bma.marked_for_recovery_since,
  bma.age_days,
  bma.hours_in_recovery,
  CASE
    WHEN bma.age_days = 0 THEN '0-1 days'
    WHEN bma.age_days = 1 THEN '1-2 days'
    WHEN bma.age_days = 2 THEN '2-3 days'
    WHEN bma.age_days = 3 THEN '3-4 days'
    WHEN bma.age_days = 4 THEN '4-5 days'
    WHEN bma.age_days = 5 THEN '5-6 days'
    WHEN bma.age_days = 6 THEN '6-7 days'
    WHEN bma.age_days BETWEEN 7 AND 10 THEN '7-10 days'
    ELSE 'Greater than 10 days'
  END AS age_bucket,

  -- Booking context
  lb.user_id,
  lb.plan_type,
  lb.booking_start_time,
  lb.booking_end_time,
  lb.km_left,

  -- User contact (hunter calls directly from ticket)
  u.full_name    AS last_user_name,
  u.phone_number AS last_user_phone,

  -- Referral context (informational only — cool-off is hunter-initiated for any rider, not tier-based)
  rm.referred_count,
  rm.referred_phone_numbers,
  rm.referred_names,
  rb.referrer_phone_number,
  rb.referrer_name

FROM bike_mfr_age bma
LEFT JOIN latest_booking lb ON lb.bike_id = bma.bike_id
LEFT JOIN "user" u          ON u.id = lb.user_id
LEFT JOIN referrals_made rm ON rm.user_id = u.id
LEFT JOIN referred_by    rb ON rb.user_id = u.id
ORDER BY bma.hours_in_recovery DESC
