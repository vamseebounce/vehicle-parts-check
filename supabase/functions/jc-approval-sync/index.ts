// jc-approval-sync — Manual JC Approval Check sync (cron ~5 min)
//
// Pulls the full approval-check query server-side from a Metabase card and
// rebuilds two tables (migration 20260619000001_jc_approval.sql):
//   • jc_approval_status  — one row per vehicle (latest snapshot), delete+reinsert
//   • jc_approval_alerts  — append-only log of actionable tiers (T4/T5b/T6)
//
// The card UUID lives ONLY here (server-side) — it is never shipped to the
// browser, so the data sits behind Supabase auth/RLS. The frontend reads the
// tables with the user's session token (jc-approval.html + Alert Centre).
//
// Query source: sql/rrr/RRR_Manual_JC_Approval_Check.sql
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Fetched server-side only. No params → all vehicles.
const METABASE_URL =
  "https://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/c100308c-250f-46b2-b389-e8bc4a419d4c/query/csv?parameters=%5B%5D";

// Tiers that raise an alert (decision: T4 push-failed, T5b push-stuck, T6 unknown).
const ALERT_TIERS = new Set(["T4", "T5b", "T6"]);

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function writeHeartbeat(sb: any, status: string, durationMs: number, rowsAffected: number | null = null, errorMessage: string | null = null) {
  try { await sb.from('sync_heartbeats').insert({ function_name: 'jc-approval-sync', status, duration_ms: durationMs, rows_affected: rowsAffected, error_message: errorMessage, synced_at: new Date().toISOString() }); } catch (_) {}
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
  return val;
}
function num(val: string | null): number | null {
  if (val === null || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
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
    const v = (row: string[], col: string): string | null => ci[col] !== undefined ? (coerce(row[ci[col]]) as string | null) : null;

    const records = lines.slice(1).map(parseCSVLine).map((row) => ({
      reg_number:                v(row, "Reg Number"),
      chassis_number:            v(row, "Chassis Number"),
      latest_draft_jc:           v(row, "Latest Draft JC"),
      latest_jc_status:          v(row, "Latest JC Status"),
      jc_created_ist:            v(row, "JC Created (IST)"),
      current_booking_status:    v(row, "Current Booking Status"),
      current_booking_ended_ist: v(row, "Current Booking Ended (IST)"),
      jc_trip_ended_ist:         v(row, "JC's Trip Ended (IST)"),
      dms_json:                  v(row, "DMS JSON"),
      jc_age_minutes:            num(v(row, "JC Age (min)")),
      rental_status:             v(row, "Rental Status"),
      vehicle_status:            v(row, "Vehicle Status"),
      vehicle_sub_status:        v(row, "Vehicle Sub-Status"),
      intrip:                    v(row, "Intrip") === "true"  ? true
                               : v(row, "Intrip") === "false" ? false
                               : null,
      jc_hub_name:               v(row, "JC Hub Name"),
      tier:                      v(row, "Tier"),
      verdict:                   v(row, "Verdict"),
      reason:                    v(row, "Reason"),
    })).filter((r) => r.reg_number); // reg_number is the PK — drop blanks

    // ── 1. Rebuild jc_approval_status (delete + reinsert) ──
    const { error: delErr } = await supabase.from("jc_approval_status").delete().neq("reg_number", "");
    if (delErr) throw new Error(`status delete failed: ${delErr.message}`);
    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error: insErr } = await supabase.from("jc_approval_status").insert(records.slice(i, i + BATCH));
      if (insErr) throw new Error(`status insert failed at ${i}: ${insErr.message}`);
    }

    // ── 2. Diff alerts ──
    // Current actionable set (by draft JC + tier).
    const actionable = records.filter((r) => r.tier && ALERT_TIERS.has(r.tier) && r.latest_draft_jc);
    const openKeys = new Set(actionable.map((r) => `${r.latest_draft_jc}|${r.tier}`));

    // Existing OPEN alerts.
    const { data: existing, error: exErr } = await supabase
      .from("jc_approval_alerts")
      .select("id, latest_draft_jc, tier")
      .is("resolved_at", null);
    if (exErr) throw new Error(`alerts read failed: ${exErr.message}`);
    const existingKeys = new Set((existing || []).map((a: any) => `${a.latest_draft_jc}|${a.tier}`));

    // New alerts to insert (actionable now, not already open).
    const toInsert = actionable
      .filter((r) => !existingKeys.has(`${r.latest_draft_jc}|${r.tier}`))
      .map((r) => ({
        reg_number: r.reg_number, chassis_number: r.chassis_number,
        latest_draft_jc: r.latest_draft_jc, tier: r.tier,
        verdict: r.verdict, reason: r.reason,
      }));
    let inserted = 0;
    if (toInsert.length) {
      // upsert on the UNIQUE (latest_draft_jc, tier) — ignore dupes from races.
      const { error: aInsErr, count } = await supabase
        .from("jc_approval_alerts")
        .upsert(toInsert, { onConflict: "latest_draft_jc,tier", ignoreDuplicates: true, count: "exact" });
      if (aInsErr) throw new Error(`alerts insert failed: ${aInsErr.message}`);
      inserted = count ?? toInsert.length;
    }

    // Resolve alerts whose vehicle left the actionable tier.
    const toResolve = (existing || []).filter((a: any) => !openKeys.has(`${a.latest_draft_jc}|${a.tier}`));
    if (toResolve.length) {
      const ids = toResolve.map((a: any) => a.id);
      const { error: resErr } = await supabase
        .from("jc_approval_alerts")
        .update({ resolved_at: new Date().toISOString() })
        .in("id", ids);
      if (resErr) throw new Error(`alerts resolve failed: ${resErr.message}`);
    }

    // ── 3. Email notification ──
    // TODO(email): send the freshly-inserted alerts (toInsert) to the JC team,
    // then stamp alerted_at on those rows. Channel/recipient not yet wired —
    // hook in the same transport used by the RSA/FW alert scripts. The Alert
    // Centre (reads jc_approval_alerts) works without this.

    await writeHeartbeat(supabase, 'success', Date.now() - t0, records.length);
    return new Response(JSON.stringify({
      success: true, vehicles: records.length,
      alerts_opened: inserted, alerts_resolved: toResolve.length,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    await writeHeartbeat(supabase, 'error', Date.now() - t0, null, String(err));
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
