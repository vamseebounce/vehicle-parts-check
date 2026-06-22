/**
 * recovery-blocked-sync — Trace & Hunter
 * Runs at 6 PM IST (12:30 UTC) daily — Step 0 of the 6 PM sequence.
 *
 * Fetches the blocked vehicles Google Sheet (public CSV export),
 * full-replaces recovery_blocked_vehicles.
 *
 * Fail-safe: if Google Sheet fetch fails, keep existing table as-is.
 * This is Step 0 — must complete before zone-cluster (Step 1) runs.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Public Google Sheet — export as CSV
// Sheet: https://docs.google.com/spreadsheets/d/1btPXx08qDyQSOTWWZHEWHgTQuo1CC2pcL4s10Ndj6J4
const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1btPXx08qDyQSOTWWZHEWHgTQuo1CC2pcL4s10Ndj6J4/export?format=csv&gid=0'

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = '' }
    else cur += ch
  }
  result.push(cur.trim())
  return result
}

async function writeHeartbeat(
  sb: ReturnType<typeof createClient>,
  status: string,
  durationMs: number,
  rows: number | null = null,
  errorMessage: string | null = null
) {
  try {
    await sb.from('sync_heartbeats').insert({
      function_name: 'recovery-blocked-sync',
      status,
      duration_ms: durationMs,
      rows_affected: rows,
      error_message: errorMessage,
      synced_at: new Date().toISOString()
    })
  } catch (_) {}
}

Deno.serve(async (_req) => {
  const t0 = Date.now()
  const sb = createClient(SB_URL, SB_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  try {
    // Fetch public sheet
    const res = await fetch(SHEET_CSV_URL, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) {
      const msg = `Google Sheet fetch failed: ${res.status}`
      console.warn(msg, '— keeping existing blocked list')
      await writeHeartbeat(sb, 'failure', Date.now() - t0, null, msg)
      return new Response(JSON.stringify({ ok: false, warn: msg, kept_existing: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const csvText = await res.text()
    const lines = csvText.split('\n').filter(l => l.trim())
    if (lines.length < 2) {
      const msg = 'Sheet appears empty or header-only'
      await writeHeartbeat(sb, 'failure', Date.now() - t0, 0, msg)
      return new Response(JSON.stringify({ ok: false, warn: msg }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Expect columns: Vehicle no, police station, city
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())
    const regIdx    = headers.findIndex(h => h.includes('vehicle'))
    const psIdx     = headers.findIndex(h => h.includes('police'))
    const cityIdx   = headers.findIndex(h => h.includes('city'))

    const now = new Date().toISOString()
    const rows: Array<{ reg_number: string; police_station: string | null; city: string | null; synced_at: string }> = []

    for (const line of lines.slice(1)) {
      const cols = parseCSVLine(line)
      const regNumber = regIdx >= 0 ? cols[regIdx]?.trim().toUpperCase() : null
      if (!regNumber) continue
      rows.push({
        reg_number:     regNumber,
        police_station: psIdx >= 0   ? (cols[psIdx]?.trim() || null)   : null,
        city:           cityIdx >= 0  ? (cols[cityIdx]?.trim() || null) : null,
        synced_at:      now
      })
    }

    if (rows.length === 0) {
      const msg = 'No valid rows parsed from sheet'
      await writeHeartbeat(sb, 'failure', Date.now() - t0, 0, msg)
      return new Response(JSON.stringify({ ok: false, warn: msg }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Full replace: delete all → insert fresh
    const { error: delErr } = await sb.from('recovery_blocked_vehicles').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (delErr) throw new Error(`Delete failed: ${delErr.message}`)

    const BATCH = 200
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error: insErr } = await sb.from('recovery_blocked_vehicles').insert(rows.slice(i, i + BATCH))
      if (insErr) throw new Error(`Insert failed at batch ${i}: ${insErr.message}`)
    }

    await writeHeartbeat(sb, 'success', Date.now() - t0, rows.length)
    return new Response(JSON.stringify({ ok: true, synced: rows.length }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('recovery-blocked-sync error:', err)
    await writeHeartbeat(sb, 'failure', Date.now() - t0, null, err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
