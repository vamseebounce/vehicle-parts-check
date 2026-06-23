// jc-context-sync — Manual JC Approval Check context buckets (cron ~15 min)
//
// Rebuilds three read-only context tables for jc-approval.html from THREE
// PRIVATE Metabase cards (delete + reinsert each, 500-row batches):
//   • jc_booking_history  — last ~90d bookings per vehicle (Card A)
//   • jc_ops_log          — bike_operations_log status/hub changes ~30d (Card B)
//   • jc_jc_status_log     — job_card_status_log progression incl. DMS JC # (Card C)
//
// Same pattern as jc-history-sync. The card UUIDs live ONLY here (server-side) —
// never shipped to the browser; the page reads the tables via the user's session
// JWT under RLS. Migration: 20260623000001_jc_context_tables.sql.
//
// ⚠️ FILL IN the three card UUIDs below once the PRIVATE Metabase cards exist.
//    Card SQL column aliases must match the v(row, "<alias>") keys used here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Card A — jc_booking_history
const CARD_BOOKING =
  "https://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/<CARD_A_UUID>/query/csv?parameters=%5B%5D";
// Card B — jc_ops_log
const CARD_OPS =
  "https://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/<CARD_B_UUID>/query/csv?parameters=%5B%5D";
// Card C — jc_jc_status_log
const CARD_JC_LOG =
  "https://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/<CARD_C_UUID>/query/csv?parameters=%5B%5D";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function writeHeartbeat(sb: any, fn: string, status: string, durationMs: number, rowsAffected: number | null = null, errorMessage: string | null = null) {
  try { await sb.from('sync_heartbeats').insert({ function_name: fn, status, duration_ms: durationMs, rows_affected: rowsAffected, error_message: errorMessage, synced_at: new Date().toISOString() }); } catch (_) {}
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []; let current = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  result.push(current.trim()); return result;
}

function coerce(val: string): string | number | null {
  if (val === "" || val === "null" || val === "NULL") return null;
  const num = Number(val);
  if (!isNaN(num) && val !== "") return num;
  return val;
}

// Fetch a card CSV → array of row objects via mapRow(v).
async function fetchCard(url: string, mapRow: (v: (col: string) => string | number | null) => Record<string, unknown>) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Metabase fetch failed: ${res.status} ${res.statusText}`);
  const lines = (await res.text()).split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const ci: Record<string, number> = {};
  headers.forEach((h, i) => { ci[h] = i; });
  return lines.slice(1).map(parseCSVLine).map((row) => {
    const v = (col: string): string | number | null => ci[col] !== undefined ? coerce(row[ci[col]]) : null;
    return mapRow(v);
  });
}

// Delete-all + reinsert (500-row batches). Delete key is `id` for all 3 tables.
async function rebuild(sb: any, table: string, records: Record<string, unknown>[]) {
  const { error: delErr } = await sb.from(table).delete().neq("id", 0);
  if (delErr) throw new Error(`${table} delete failed: ${delErr.message}`);
  const BATCH = 500;
  for (let i = 0; i < records.length; i += BATCH) {
    const { error: insErr } = await sb.from(table).insert(records.slice(i, i + BATCH));
    if (insErr) throw new Error(`${table} insert failed at batch ${i}: ${insErr.message}`);
  }
}

Deno.serve(async (_req: Request) => {
  const t0 = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  try {
    // ── Card A — jc_booking_history ──
    const booking = await fetchCard(CARD_BOOKING, (v) => ({
      id:                      v("id"),
      reg_number:              v("reg_number"),
      bike_id:                 v("bike_id"),
      status:                  v("status"),
      booking_started_at_ist:  v("booking_started_at_ist"),
      booking_ended_at_ist:    v("booking_ended_at_ist"),
      created_for_bike_change: v("created_for_bike_change"),
      intrip_dues:             v("intrip_dues"),
    }));
    await rebuild(supabase, "jc_booking_history", booking);
    await writeHeartbeat(supabase, "jc-context-sync:booking", "success", Date.now() - t0, booking.length);

    // ── Card B — jc_ops_log ──
    const ops = await fetchCard(CARD_OPS, (v) => ({
      id:                      v("id"),
      reg_number:              v("reg_number"),
      bike_id:                 v("bike_id"),
      previous_vehicle_status: v("previous_vehicle_status"),
      new_vehicle_status:      v("new_vehicle_status"),
      hub_name:                v("hub_name"),
      performed_by_name:       v("performed_by_name"),
      created_at_ist:          v("created_at_ist"),
    }));
    await rebuild(supabase, "jc_ops_log", ops);
    await writeHeartbeat(supabase, "jc-context-sync:ops", "success", Date.now() - t0, ops.length);

    // ── Card C — jc_jc_status_log ──
    const jcLog = await fetchCard(CARD_JC_LOG, (v) => ({
      id:              v("id"),
      reg_number:      v("reg_number"),
      job_card_id:     v("job_card_id"),
      new_status:      v("new_status"),
      technician_name: v("technician_name"),
      dmsjcid:         v("dmsjcid"),
      remarks:         v("remarks"),
      created_at_ist:  v("created_at_ist"),
    }));
    await rebuild(supabase, "jc_jc_status_log", jcLog);
    await writeHeartbeat(supabase, "jc-context-sync:jclog", "success", Date.now() - t0, jcLog.length);

    return new Response(JSON.stringify({
      success: true,
      booking_history: booking.length,
      ops_log: ops.length,
      jc_status_log: jcLog.length,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    await writeHeartbeat(supabase, "jc-context-sync", "error", Date.now() - t0, null, String(err));
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
