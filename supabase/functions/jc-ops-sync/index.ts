// jc-ops-sync — rebuilds jc_ops_log (cron ~15 min)
//
// One of three fns split out of the former jc-context-sync (timeout fix).
// This one: Card B → jc_ops_log (bike_operations_log status/hub changes, ~30d).
//
// Same pattern as jc-history-sync: fetch CSV, parse, delete-all, reinsert in
// 500-row batches, heartbeat. Migration: 20260623000001_jc_context_tables.sql.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const METABASE_URL =
  "https://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/98f2dc7c-a97f-47e8-9995-96e8aa19c56a/query/csv?parameters=%5B%5D";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function writeHeartbeat(sb: any, status: string, durationMs: number, rowsAffected: number | null = null, errorMessage: string | null = null) {
  try { await sb.from('sync_heartbeats').insert({ function_name: 'jc-ops-sync', status, duration_ms: durationMs, rows_affected: rowsAffected, error_message: errorMessage, synced_at: new Date().toISOString() }); } catch (_) {}
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

Deno.serve(async (_req: Request) => {
  const t0 = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  try {
    const mbRes = await fetch(METABASE_URL);
    if (!mbRes.ok) throw new Error(`Metabase fetch failed: ${mbRes.status} ${mbRes.statusText}`);
    const csvText = await mbRes.text();
    const lines = csvText.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("No data rows");
    const headers = parseCSVLine(lines[0]);
    const ci: Record<string, number> = {};
    headers.forEach((h, i) => { ci[h] = i; });
    const v = (row: string[], col: string): string | number | null => ci[col] !== undefined ? coerce(row[ci[col]]) : null;

    const records = lines.slice(1).map(parseCSVLine).map((row) => ({
      id:                      v(row, "id"),
      reg_number:              v(row, "reg_number"),
      bike_id:                 v(row, "bike_id"),
      previous_vehicle_status: v(row, "previous_vehicle_status"),
      new_vehicle_status:      v(row, "new_vehicle_status"),
      hub_name:                v(row, "hub_name"),
      performed_by_name:       v(row, "performed_by_name"),
      created_at_ist:          v(row, "created_at_ist"),
    }));

    const { error: delError } = await supabase.from("jc_ops_log").delete().neq("id", 0);
    if (delError) throw new Error(`Delete failed: ${delError.message}`);

    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error: insError } = await supabase.from("jc_ops_log").insert(records.slice(i, i + BATCH));
      if (insError) throw new Error(`Insert failed at batch ${i}: ${insError.message}`);
    }

    await writeHeartbeat(supabase, 'success', Date.now() - t0, records.length);
    return new Response(JSON.stringify({ success: true, count: records.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    await writeHeartbeat(supabase, 'error', Date.now() - t0, null, String(err));
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
