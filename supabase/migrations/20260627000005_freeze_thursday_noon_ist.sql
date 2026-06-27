-- Change freeze trigger from Thursday midnight UTC to Thursday 12 noon IST
-- IST noon = UTC 06:30; week_start (Monday) + 10 days + 06:30 = Thursday 12:00 noon IST
-- Cron updated to match: 30 6 * * 4 (Thursday 06:30 UTC = 12:00 noon IST)
CREATE OR REPLACE FUNCTION freeze_completed_weeks()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE incentive_weekly_stats
  SET is_frozen = true
  WHERE is_frozen = false
    AND week_start + INTERVAL '10 days' + INTERVAL '06:30:00' < NOW();
$$;
