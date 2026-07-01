// admin-cron — view & edit pg_cron job schedules from the FleetPro Analytics page.
// Security: caller must be a logged-in SUPERADMIN (verified from their JWT).
// The actual cron reads/writes go through service-role-only SECURITY DEFINER
// functions (admin_cron_list / admin_cron_set_schedule / admin_cron_set_active).
// Deploy: supabase functions deploy admin-cron   (verify_jwt=true is fine)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(obj: object, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // ── Gate: caller must be a logged-in superadmin ──
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing auth token' }, 401)
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Invalid session' }, 401)
  if (userData.user.app_metadata?.is_superadmin !== true) {
    return json({ error: 'Superadmin access required' }, 403)
  }

  let body: any = {}
  try { body = await req.json() } catch { /* no body */ }
  const { action, jobid, schedule, active } = body

  // ── list: cron jobs + latest sync heartbeats (frontend joins by fn name) ──
  if (action === 'list') {
    const { data: jobs, error } = await supabase.rpc('admin_cron_list')
    if (error) return json({ error: error.message }, 400)
    const { data: heartbeats } = await supabase
      .from('sync_heartbeats')
      .select('function_name, status, synced_at')
      .order('synced_at', { ascending: false })
      .limit(300)
    return json({ jobs: jobs ?? [], heartbeats: heartbeats ?? [] })
  }

  // ── set_schedule: change a job's frequency (cron expression) ──
  if (action === 'set_schedule') {
    if (!jobid || !schedule || typeof schedule !== 'string') {
      return json({ error: 'jobid and schedule are required' }, 400)
    }
    const { error } = await supabase.rpc('admin_cron_set_schedule', {
      p_jobid: jobid, p_schedule: schedule.trim(),
    })
    if (error) return json({ error: error.message }, 400)
    return json({ success: true, jobid, schedule: schedule.trim() })
  }

  // ── set_active: pause / resume a job ──
  if (action === 'set_active') {
    if (!jobid || typeof active !== 'boolean') {
      return json({ error: 'jobid and active(boolean) are required' }, 400)
    }
    const { error } = await supabase.rpc('admin_cron_set_active', {
      p_jobid: jobid, p_active: active,
    })
    if (error) return json({ error: error.message }, 400)
    return json({ success: true, jobid, active })
  }

  return json({ error: 'Unknown action' }, 400)
})
