/**
 * recovery-ticket-sync — Trace & Hunter
 * Runs every 5 minutes via cron.
 *
 * Step 1 (Q1): Fetch bikes currently in "marked for recovery" from Metabase.
 *              For each, create a new recovery_tickets row if none exists yet
 *              (anchor: source_ops_log_id) and the bike is not blocked.
 *              After insert, auto-assign mid-day additions to nearest zone centroid
 *              from today's zone_configs (if zone-cluster has already run today).
 *
 * Step 2 (Q2): Fetch open ticket reconciliation results from Metabase.
 *              Apply state-machine transitions:
 *                next_status = active            → cancel (customer_renewed)
 *                next_status = recovered         → update to in_transit
 *                next_status = oos               → close as at_hub
 *                next_status = marked for recovery → ignore (re-mark)
 *                next_status = NULL              → no-op
 *
 * Writes sync_heartbeats on completion.
 *
 * NOTE ON is_base_list:
 *   New tickets default to is_base_list=false (added mid-day / pre-6PM).
 *   zone-cluster sets is_base_list=true at 6 PM for the daily base list.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL  = Deno.env.get('SUPABASE_URL')!
const SB_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Metabase public question CSV endpoints
const Q1_URL = 'http://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/8ef20d85-0485-4e85-b25a-9d7c96279d8e/query/csv?parameters=%5B%5D'
const Q2_URL = 'http://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/67f2823d-e46c-49c0-90c1-51c8bc9e8340/query/csv?parameters=%5B%5D'

// ── Haversine distance (km) ───────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const a = sinDLat * sinDLat +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * sinDLng * sinDLng
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── City name → city_id (same aliases as zone-cluster) ───────────────────────
const CITY_ALIASES: Array<{ id: number; aliases: string[] }> = [
  { id: 1, aliases: ['ncr', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'faridabad'] },
  { id: 2, aliases: ['bangalore', 'bengaluru', 'blr'] },
  { id: 5, aliases: ['hyderabad', 'hyd', 'secunderabad'] },
]
function resolveCityId(cityName: string | null | undefined): number | null {
  if (!cityName) return null
  const lower = cityName.toLowerCase().trim()
  for (const c of CITY_ALIASES) {
    if (c.aliases.some(a => lower.includes(a))) return c.id
  }
  return null
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0])
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h.trim()] = (vals[i] ?? '').trim() })
    return row
  }).filter(r => Object.values(r).some(v => v !== ''))
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else cur += ch
  }
  result.push(cur)
  return result
}

function num(v: string | undefined): number | null {
  if (!v || v === '' || v === 'null') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function str(v: string | undefined): string | null {
  return (!v || v === '' || v === 'null') ? null : v
}

// Resolve the marked-at instant as a true UTC ISO string.
// Prefers marked_at_utc; if only marked_at_ist (IST wall-clock, no tz) is
// present, interprets it as +05:30 and converts to UTC — never stores IST raw.
function resolveMarkedAtUtc(utcVal: string | null, istVal: string | null): string | null {
  const hasTz = (s: string) => /[zZ]$|[+\-]\d{2}:?\d{2}$/.test(s)
  if (utcVal) {
    const v = utcVal.trim().replace(' ', 'T')
    const d = new Date(hasTz(v) ? v : v + 'Z') // bare = already UTC
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (istVal) {
    const v = istVal.trim().replace(' ', 'T')
    const d = new Date(hasTz(v) ? v : v + '+05:30') // bare = IST wall-clock
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

// ── Heartbeat ────────────────────────────────────────────────────────────────
async function writeHeartbeat(
  sb: ReturnType<typeof createClient>,
  status: string,
  durationMs: number,
  rowsAffected: number | null = null,
  errorMessage: string | null = null
) {
  try {
    await sb.from('sync_heartbeats').insert({
      function_name: 'recovery-ticket-sync',
      status,
      duration_ms: durationMs,
      rows_affected: rowsAffected,
      error_message: errorMessage,
      synced_at: new Date().toISOString()
    })
  } catch (_) {}
}

// ── HO dashboard cache rebuild ─────────────────────────────────────────────────
// Denormalised snapshot of open + today-recovered tickets with GPS pre-joined.
// Runs here (edge fn) so the HO dashboard reads ONE table — no client-side join,
// minimal Postgres RAM on Micro. Delete + reinsert (RSA pattern).
async function rebuildHoCache(sb: ReturnType<typeof createClient>): Promise<number> {
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  const dayStart = nowIst.toISOString().slice(0, 10) + 'T00:00:00+05:30'
  const COLS = 'id,bike_id,reg_number,city_id,city_name,zone,status,assigned_hunter_id,call_status,marked_at_utc,is_base_list,model_name,last_user_name,last_user_phone,mark_found_at,in_transit_at,at_hub_at'

  // Open tickets + today's at_hub (for the "Recovered today" tile)
  const { data: open } = await sb.from('recovery_tickets').select(COLS)
    .not('status', 'in', '("cancelled","at_hub")')
  const { data: atHubToday } = await sb.from('recovery_tickets').select(COLS)
    .eq('status', 'at_hub').gte('at_hub_at', dayStart)

  const byId = new Map<string, any>()
  for (const r of [...(open ?? []), ...(atHubToday ?? [])]) byId.set(r.id, r)
  const tickets = [...byId.values()]

  const EMPTY = '00000000-0000-0000-0000-000000000000'
  if (tickets.length === 0) {
    await sb.from('recovery_tickets_cache').delete().neq('ticket_id', EMPTY)
    return 0
  }

  // GPS from bike_location_cache (batched IN — runs once per cron, not per client)
  const regs = [...new Set(tickets.map(t => t.reg_number).filter(Boolean))]
  const gps = new Map<string, { lat: number; lng: number; ts: string | null }>()
  for (let i = 0; i < regs.length; i += 200) {
    const { data: g } = await sb.from('bike_location_cache')
      .select('reg_number,lat,lng,baas_location_time')
      .in('reg_number', regs.slice(i, i + 200))
    for (const r of (g ?? [])) {
      if (r.lat != null && r.lng != null) gps.set(r.reg_number, { lat: Number(r.lat), lng: Number(r.lng), ts: r.baas_location_time })
    }
  }

  const now = new Date().toISOString()
  const rows = tickets.map(t => {
    const p = gps.get(t.reg_number)
    return {
      ticket_id: t.id, bike_id: t.bike_id, reg_number: t.reg_number,
      city_id: t.city_id, city_name: t.city_name, zone: t.zone, status: t.status,
      assigned_hunter_id: t.assigned_hunter_id, call_status: t.call_status,
      marked_at_utc: t.marked_at_utc, is_base_list: t.is_base_list, model_name: t.model_name,
      last_user_name: t.last_user_name, last_user_phone: t.last_user_phone,
      mark_found_at: t.mark_found_at, in_transit_at: t.in_transit_at, at_hub_at: t.at_hub_at,
      display_lat: p?.lat ?? null, display_lng: p?.lng ?? null, gps_ts: p?.ts ?? null,
      refreshed_at: now,
    }
  })

  await sb.from('recovery_tickets_cache').delete().neq('ticket_id', EMPTY)
  const BATCH = 200
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await sb.from('recovery_tickets_cache').insert(rows.slice(i, i + BATCH))
    if (error) console.error('HO cache insert error:', error.message)
  }
  return rows.length
}

// ── Main ─────────────────────────────────────────────────────────────────────
Deno.serve(async (_req) => {
  const t0 = Date.now()
  const sb = createClient(SB_URL, SB_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  let totalChanged = 0

  try {
    // ── Parallel fetch Q1 + Q2 (was sequential — caused 55s+55s > 60s timeout) ──
    const [q1Result, q2Result] = await Promise.allSettled([
      fetch(Q1_URL, { signal: AbortSignal.timeout(45000) }).then(r => r.ok ? r.text() : Promise.reject(new Error(`Q1 ${r.status}`))),
      fetch(Q2_URL, { signal: AbortSignal.timeout(45000) }).then(r => r.ok ? r.text() : Promise.reject(new Error(`Q2 ${r.status}`))),
    ])

    const q1Text = q1Result.status === 'fulfilled' ? q1Result.value : null
    const q2Text = q2Result.status === 'fulfilled' ? q2Result.value : null
    const q1Err = q1Result.status === 'rejected' ? (q1Result as PromiseRejectedResult).reason?.message : null
    const q2Err = q2Result.status === 'rejected' ? (q2Result as PromiseRejectedResult).reason?.message : null
    if (q1Err) console.error('Q1 fetch failed:', q1Err)
    if (q2Err) console.error('Q2 fetch failed:', q2Err)

    // ── STEP 1: New ticket creation (Q1) ──────────────────────────────────────
    const q1Rows = q1Text ? parseCSV(q1Text) : []

    if (q1Rows.length > 0) {
      // Load blocked vehicles set
      const { data: blocked } = await sb
        .from('recovery_blocked_vehicles')
        .select('reg_number')
      const blockedSet = new Set((blocked ?? []).map((r: any) => r.reg_number.trim().toUpperCase()))

      // Load existing open tickets to avoid duplicates (anchor = source_ops_log_id)
      const { data: existingTickets } = await sb
        .from('recovery_tickets')
        .select('source_ops_log_id')
        .not('status', 'in', '("cancelled","at_hub")')
      const existingAnchors = new Set((existingTickets ?? []).map((t: any) => String(t.source_ops_log_id)))

      const toInsert: any[] = []
      for (const row of q1Rows) {
        const regNumber = str(row['reg_number'])
        const sourceOpsLogId = str(row['source_ops_log_id'])
        if (!regNumber || !sourceOpsLogId) continue
        if (blockedSet.has(regNumber.toUpperCase())) continue
        if (existingAnchors.has(sourceOpsLogId)) continue

        const bikeId = num(row['bike_id'])
        if (!bikeId) continue

        const markedAtUtc = resolveMarkedAtUtc(str(row['marked_at_utc']), str(row['marked_at_ist']))
        if (!markedAtUtc) continue

        toInsert.push({
          bike_id:            bikeId,
          source_ops_log_id:  Number(sourceOpsLogId),
          user_id:            str(row['user_id']), // latest booking's user_id from Q1
          marked_at_utc:      markedAtUtc,
          status:             'marked',
          call_status:        'none',
          is_base_list:       false,  // zone-cluster sets true at 6 PM for base list
          reg_number:         regNumber,
          model_name:         str(row['model_name']),
          speed_segment:      str(row['speed_segment']),
          city_name:          str(row['city_name']),
          plan_type:          str(row['plan_type']),
          last_user_name:     str(row['last_user_name']),
          last_user_phone:    str(row['last_user_phone']),
          referred_count:     num(row['referred_count']) ?? 0,
        })
      }

      if (toInsert.length > 0) {
        const BATCH = 100
        for (let i = 0; i < toInsert.length; i += BATCH) {
          const { error } = await sb
            .from('recovery_tickets')
            .insert(toInsert.slice(i, i + BATCH))
          if (error) console.error('Q1 insert error:', error.message)
          else totalChanged += toInsert.slice(i, i + BATCH).length
        }

        // Log creation events + auto-assign to nearest zone centroid (if zone-cluster ran today)
        const { data: newTickets } = await sb
          .from('recovery_tickets')
          .select('id, source_ops_log_id, reg_number, city_name')
          .in('source_ops_log_id', toInsert.map(t => t.source_ops_log_id))

        if (newTickets?.length) {
          await sb.from('recovery_ticket_events').insert(
            newTickets.map((t: any) => ({
              ticket_id:  t.id,
              event_type: 'created',
              created_by: null,
              metadata:   { source: 'cron_q1' }
            }))
          )

          // Mid-day auto-assign: check if zone-cluster already ran today
          const nowUtc = new Date()
          const nowIst = new Date(nowUtc.getTime() + 5.5 * 60 * 60 * 1000)
          const todayDateStr = nowIst.toISOString().slice(0, 10)

          const { data: todayZones } = await sb
            .from('zone_configs')
            .select('zone_label, hunter_id, centroid_lat, centroid_lng, city_id')
            .eq('date', todayDateStr)

          if (todayZones && todayZones.length > 0) {
            // Get GPS for new tickets from bike_location_cache
            const newRegNums = newTickets.map((t: any) => t.reg_number).filter(Boolean)
            const { data: newGps } = await sb
              .from('bike_location_cache')
              .select('reg_number, lat, lng')
              .in('reg_number', newRegNums)
            const newGpsMap = new Map((newGps ?? [])
              .filter((g: any) => g.lat != null && g.lng != null)
              .map((g: any) => [g.reg_number, { lat: Number(g.lat), lng: Number(g.lng) }])
            )

            const nowIsoStr = new Date().toISOString()
            for (const ticket of newTickets as any[]) {
              const cityId = resolveCityId(ticket.city_name)
              if (!cityId) continue
              const gps = newGpsMap.get(ticket.reg_number)
              if (!gps) continue

              const cityZones = todayZones.filter((z: any) => z.city_id === cityId)
              if (cityZones.length === 0) continue

              // Nearest centroid
              let bestZone = cityZones[0]
              let bestDist = haversineKm(gps.lat, gps.lng, bestZone.centroid_lat, bestZone.centroid_lng)
              for (const z of cityZones.slice(1)) {
                const d = haversineKm(gps.lat, gps.lng, z.centroid_lat, z.centroid_lng)
                if (d < bestDist) { bestDist = d; bestZone = z }
              }

              await sb.from('recovery_tickets').update({
                zone:               bestZone.zone_label,
                assigned_hunter_id: bestZone.hunter_id ?? null,
                city_id:            cityId,
                status:             'assigned',
                assigned_at:        nowIsoStr,
                is_base_list:       false, // mid-day addition
              }).eq('id', ticket.id).eq('status', 'marked')

              if (bestZone.hunter_id) {
                await sb.from('recovery_ticket_events').insert({
                  ticket_id:  ticket.id,
                  event_type: 'reassigned',
                  created_by: null,
                  metadata:   {
                    source:    'cron_q1_midday',
                    zone:      bestZone.zone_label,
                    hunter_id: bestZone.hunter_id,
                    city_id:   cityId,
                  },
                })
              }
            }
          }
        }
      }
    }

    // ── STEP 2: Open ticket reconciliation (Q2) ───────────────────────────────
    // q2Text already fetched in parallel with Q1 above
    // Q2 returns invalid-query if table not ready — handle gracefully
    if (q2Text && !q2Text.includes('invalid-query') && !q2Text.includes('error')) {
      const q2Rows = parseCSV(q2Text)

      for (const row of q2Rows) {
        const ticketId   = str(row['ticket_id'])
        const nextStatus = str(row['next_status'])
        const nextAt     = str(row['next_status_at_utc'])
        if (!ticketId || !nextStatus) continue

        let updates: any = null
        let eventType: string | null = null
        let cancelReason: string | null = null

        switch (nextStatus.toLowerCase()) {
          case 'active':
            // Customer renewed — cancel ticket
            updates = { status: 'cancelled', cancel_reason: 'customer_renewed', cancelled_at: nextAt ?? new Date().toISOString() }
            eventType = 'cancelled'
            cancelReason = 'customer_renewed'
            break
          case 'recovered':
            // Hunter loaded vehicle on porter → in_transit
            updates = { status: 'in_transit', in_transit_at: nextAt ?? new Date().toISOString() }
            eventType = 'in_transit'
            break
          case 'oos':
            // Manually moved to hub (ops intervention) → at_hub
            updates = { status: 'at_hub', at_hub_at: nextAt ?? new Date().toISOString(), cancel_reason: 'ops_intervention' }
            eventType = 'at_hub'
            break
          case 'marked for recovery':
            // Re-mark — ignore
            continue
          default:
            // Unknown or null — no-op
            continue
        }

        if (updates) {
          const { error: upErr } = await sb
            .from('recovery_tickets')
            .update(updates)
            .eq('id', ticketId)
            .not('status', 'in', '("cancelled","at_hub")')
          if (upErr) {
            console.error('Q2 update error:', upErr.message)
            continue
          }
          totalChanged++

          // Log event
          await sb.from('recovery_ticket_events').insert({
            ticket_id:  ticketId,
            event_type: eventType,
            created_by: null,
            metadata:   { source: 'cron_q2', next_status: nextStatus, cancel_reason: cancelReason }
          })
        }
      }
    }

    // ── STEP 3: Rebuild HO dashboard cache (GPS-enriched snapshot) ────────────
    let cached = 0
    try { cached = await rebuildHoCache(sb) }
    catch (e: any) { console.error('rebuildHoCache failed:', e?.message) }

    // Derive heartbeat status from fetch outcomes
    const fetchErrors = [q1Err && `Q1: ${q1Err}`, q2Err && `Q2: ${q2Err}`].filter(Boolean).join('; ')
    const hbStatus = (q1Err && q2Err) ? 'error' : (q1Err || q2Err) ? 'partial' : 'ok'
    await writeHeartbeat(sb, hbStatus, Date.now() - t0, totalChanged, fetchErrors || null)
    return new Response(JSON.stringify({ ok: hbStatus !== 'error', changed: totalChanged, cached, fetchErrors: fetchErrors || null }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('recovery-ticket-sync error:', err)
    await writeHeartbeat(sb, 'error', Date.now() - t0, null, err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
