-- Session 12: Health check RPC callable by anon key
--
-- Creates get_fleetpro_health() SECURITY DEFINER function so the
-- scheduled health-check task can query cron job status and ticket
-- counts using the anon key (no service role key needed in SKILL.md).
--
-- The function runs as its owner (postgres), bypasses RLS, reads
-- cron.job_run_details and rsa_tickets_cache, and returns aggregate
-- stats only — no PII exposed.
--
-- Rollback:
--   REVOKE EXECUTE ON FUNCTION public.get_fleetpro_health() FROM anon;
--   DROP FUNCTION IF EXISTS public.get_fleetpro_health();

CREATE OR REPLACE FUNCTION public.get_fleetpro_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_ticket_count      bigint;
  v_last_cron_start   timestamptz;
  v_last_cron_status  text;
  v_open_new          bigint;
  v_open_inprogress   bigint;
  v_tickets_today     bigint;
BEGIN
  SELECT COUNT(*) INTO v_ticket_count
  FROM public.rsa_tickets_cache;

  SELECT r.start_time, r.status
  INTO v_last_cron_start, v_last_cron_status
  FROM cron.job_run_details r
  JOIN cron.job j ON j.jobid = r.jobid
  WHERE j.jobname = 'rsa-ticket-sync-2min'
  ORDER BY r.start_time DESC
  LIMIT 1;

  SELECT COUNT(*) INTO v_open_new
  FROM public.rsa_tickets_cache
  WHERE status = 'NEW';

  SELECT COUNT(*) INTO v_open_inprogress
  FROM public.rsa_tickets_cache
  WHERE status = 'IN_PROGRESS';

  SELECT COUNT(*) INTO v_tickets_today
  FROM public.rsa_tickets_cache
  WHERE created_at_ist::date = (now() AT TIME ZONE 'Asia/Kolkata')::date;

  RETURN jsonb_build_object(
    'ticket_count',       v_ticket_count,
    'last_cron_run',      v_last_cron_start,
    'last_cron_status',   v_last_cron_status,
    'minutes_since_cron', ROUND(EXTRACT(EPOCH FROM (now() - v_last_cron_start))/60),
    'open_new',           v_open_new,
    'open_inprogress',    v_open_inprogress,
    'tickets_today',      v_tickets_today,
    'checked_at',         now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_fleetpro_health() TO anon;
