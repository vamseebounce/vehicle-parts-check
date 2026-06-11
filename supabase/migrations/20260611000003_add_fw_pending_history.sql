-- Task 2½.3: fw_pending_history table + daily snapshot cron
CREATE TABLE IF NOT EXISTS public.fw_pending_history (
  id              bigserial PRIMARY KEY,
  chassis_number  text NOT NULL,
  hub             text,
  reg_number      text,
  snapshot_date   date NOT NULL DEFAULT CURRENT_DATE,
  synced_at       timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_fw_pending_history_date
  ON public.fw_pending_history (snapshot_date DESC);

CREATE INDEX idx_fw_pending_history_chassis
  ON public.fw_pending_history (chassis_number, snapshot_date DESC);

ALTER TABLE public.fw_pending_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read fw_pending_history"
  ON public.fw_pending_history FOR SELECT USING (true);

COMMENT ON TABLE public.fw_pending_history IS 'Daily snapshot of fw_pending_cache. One row per bike per day. Used for ML training data on FW duration trends.';

-- Daily pg_cron snapshot at 23:55 IST (18:25 UTC)
SELECT cron.schedule(
  'fw-pending-daily-snapshot',
  '25 18 * * *',
  $$
    INSERT INTO public.fw_pending_history (chassis_number, hub, reg_number, snapshot_date, synced_at)
    SELECT chassis_number, hub, reg_number, CURRENT_DATE, now()
    FROM public.fw_pending_cache;
  $$
);

-- Rollback:
-- SELECT cron.unschedule('fw-pending-daily-snapshot');
-- DROP TABLE IF EXISTS public.fw_pending_history;
