-- Task 5.1: sync_heartbeats table
CREATE TABLE IF NOT EXISTS public.sync_heartbeats (
  id              bigserial PRIMARY KEY,
  function_name   text NOT NULL,
  status          text NOT NULL CHECK (status IN ('success', 'failure')),
  duration_ms     integer,
  rows_affected   integer,
  error_message   text,
  synced_at       timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_sync_heartbeats_fn_time
  ON public.sync_heartbeats (function_name, synced_at DESC);

ALTER TABLE public.sync_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read sync_heartbeats"
  ON public.sync_heartbeats FOR SELECT USING (true);

COMMENT ON TABLE public.sync_heartbeats IS 'One row per edge fn / cron run. Used by health-check and Cowork 8AM briefing.';

-- Rollback:
-- DROP TABLE IF EXISTS public.sync_heartbeats;
