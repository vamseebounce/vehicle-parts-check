import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const METABASE    = 'http://metabaselatest-dy7gqwqrma-el.a.run.app'
const QUEUE_UUID  = 'fea85b30-3ca8-4c07-b434-1f6e6c05875d'
const PENDING_UUID = '84353543-a136-4f4a-ba0d-cb97218e0b59'
const BATCH = 500

async function fetchMetabaseCard(uuid: string): Promise<Record<string, unknown>[]> {
  const url = `${METABASE}/api/public/card/${uuid}/query`
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) { const txt = await res.text(); throw new Error(`Metabase ${uuid} HTTP ${res.status}: ${txt.slice(0, 200)}`); }
  const body = await res.json()
  const data = body?.data ?? body
  if (!data?.cols || !data?.rows) throw new Error(`Metabase ${uuid}: unexpected shape`)
  const colNames: string[] = data.cols.map((c: Record<string, string>) =>
    (c.name ?? c.display_name ?? '').toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, ''))
  return data.rows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    colNames.forEach((col, i) => { if (col) obj[col] = row[i] ?? null })
    obj.refreshed_at = new Date().toISOString()
    return obj
  })
}

const QUEUE_MAP: Record<string, string> = {
  city_name: 'city', hub: 'hub_name', reg: 'reg_number', flag: 'guardrail', model: 'model_name',
  score: 'allotment_score', fifo: 'fifo_score', utilization: 'util_score',
  rfd_age_days_: 'rfd_age_days', avg_kmday: 'avg_km_day', odometer: 'current_odo_km', deploy_: 'deploy_rank',
}

const PENDING_MAP: Record<string, string> = {
  customer: 'full_name', phone: 'phone_number', loyalty_tier_: 'loyalty_tier',
  booked_model_: 'booked_model', premium_fee: 'paid_premium_fees', plan_tier: 'tier',
  hub: 'hub_name', current_bike: 'assigned_reg', current_model: 'assigned_model', history: 'completed_count',
}

function applyMap(rows: Record<string, unknown>[], map: Record<string, string>) {
  if (!Object.keys(map).length) return rows
  return rows.map(row => { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(row)) { out[map[k] ?? k] = v }; return out })
}

async function writeHeartbeat(sb: any, status: string, durationMs: number, rowsAffected: number | null = null, errorMessage: string | null = null) {
  try { await sb.from('sync_heartbeats').insert({ function_name: 'refresh-deployment-cache', status, duration_ms: durationMs, rows_affected: rowsAffected, error_message: errorMessage, synced_at: new Date().toISOString() }); } catch (_) {}
}

serve(async () => {
  const started = Date.now()
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const [rawQueue, rawPending] = await Promise.all([fetchMetabaseCard(QUEUE_UUID), fetchMetabaseCard(PENDING_UUID)])
    const queueRows = applyMap(rawQueue, QUEUE_MAP)
    const pendingRows = applyMap(rawPending, PENDING_MAP)
    await Promise.all([sb.from('deployment_queue_cache').delete().gte('id', 0), sb.from('pending_bookings_cache').delete().gte('id', 0)])
    for (let i = 0; i < queueRows.length; i += BATCH) { const { error } = await sb.from('deployment_queue_cache').insert(queueRows.slice(i, i + BATCH)); if (error) throw new Error(`queue batch ${i}: ${error.message}`); }
    for (let i = 0; i < pendingRows.length; i += BATCH) { const { error } = await sb.from('pending_bookings_cache').insert(pendingRows.slice(i, i + BATCH)); if (error) throw new Error(`pending batch ${i}: ${error.message}`); }
    await writeHeartbeat(sb, 'success', Date.now() - started, queueRows.length + pendingRows.length)
    return new Response(JSON.stringify({ ok: true, queue_bikes: queueRows.length, pending_customers: pendingRows.length, elapsed_ms: Date.now() - started }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    await writeHeartbeat(sb, 'error', Date.now() - started, null, String(err))
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
