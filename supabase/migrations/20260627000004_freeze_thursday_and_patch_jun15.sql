-- One-time patch for week of 15 Jun 2026.
-- The sync ran after the ops sheet was captured (Friday Jun 20), so 3 extra comebacks
-- were recorded over the weekend flipping NADEEM PASHA from 51 → 48 eligible JCs.
-- The ops sheet is authoritative — patch his row to match, then freeze the week.

-- Unfreeze week Jun 15 to allow the patch
UPDATE incentive_weekly_stats SET is_frozen = false WHERE week_start = '2026-06-15';

-- Upsert NADEEM PASHA with sheet-authoritative numbers (51 valid, 8 void, ₹25)
INSERT INTO incentive_weekly_stats (
  tech_name, week_start,
  total_jcs, intrip_jcs, submission_jcs,
  voided_jcs, eligible_jcs, payout_amount,
  intrip_void_rate, submission_void_rate,
  hub_name, city, is_frozen
) VALUES (
  'NADEEM PASHA - R R NAGAR', '2026-06-15',
  59, 23, 28,
  8, 51, 25,
  0, 0,
  'R R Nagar', 'Bangalore', false
)
ON CONFLICT (tech_name, week_start) DO UPDATE SET
  total_jcs        = 59,
  intrip_jcs       = 23,
  submission_jcs   = 28,
  voided_jcs       = 8,
  eligible_jcs     = 51,
  payout_amount    = 25,
  is_frozen        = false;

-- Freeze the entire Jun 15 week (all 12 earners locked)
UPDATE incentive_weekly_stats SET is_frozen = true WHERE week_start = '2026-06-15';
