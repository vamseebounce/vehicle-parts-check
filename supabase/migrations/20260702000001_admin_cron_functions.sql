-- ============================================================
-- admin-cron helpers — let the admin-cron edge fn read/alter pg_cron jobs
-- Added 2026-07-02 for the Sync Jobs panel in admin-analytics.html
-- ------------------------------------------------------------
-- SECURITY DEFINER so the (service-role) edge fn can reach the cron schema.
-- Locked to service_role ONLY — the edge fn additionally verifies the caller
-- is a logged-in superadmin before invoking these. Never expose to anon/auth.
-- ============================================================

-- List all scheduled jobs (jobid, name, cron schedule, active flag, command).
create or replace function public.admin_cron_list()
returns table(jobid bigint, jobname text, schedule text, active boolean, command text)
language sql
security definer
set search_path = public, cron
as $$
  select jobid, jobname, schedule, active, command
  from cron.job
  order by jobid;
$$;

-- Change a job's frequency. pg_cron validates the cron expression and raises on bad input.
create or replace function public.admin_cron_set_schedule(p_jobid bigint, p_schedule text)
returns void
language plpgsql
security definer
set search_path = public, cron
as $$
begin
  perform cron.alter_job(job_id => p_jobid, schedule => p_schedule);
end;
$$;

-- Pause / resume a job.
create or replace function public.admin_cron_set_active(p_jobid bigint, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, cron
as $$
begin
  perform cron.alter_job(job_id => p_jobid, active => p_active);
end;
$$;

-- Lock down: strip the default PUBLIC execute grant, then allow service_role only.
revoke all on function public.admin_cron_list()                      from public, anon, authenticated;
revoke all on function public.admin_cron_set_schedule(bigint, text)  from public, anon, authenticated;
revoke all on function public.admin_cron_set_active(bigint, boolean) from public, anon, authenticated;
grant execute on function public.admin_cron_list()                      to service_role;
grant execute on function public.admin_cron_set_schedule(bigint, text)  to service_role;
grant execute on function public.admin_cron_set_active(bigint, boolean) to service_role;
