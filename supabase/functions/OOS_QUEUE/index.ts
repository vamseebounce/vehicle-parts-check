import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const METABASE_URL =
  "https://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/13db90ad-9379-45d5-82ed-fbfd204dc9f7/query/csv?parameters=%5B%5D";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function coerce(val: string): string | number | boolean | null {
  if (val === "" || val === "null" || val === "NULL") return null;
  if (val === "true" || val === "t") return true;
  if (val === "false" || val === "f") return false;
  const num = Number(val);
  if (!isNaN(num) && val !== "") return num;
  return val;
}

Deno.serve(async (_req: Request) => {
  try {
    const mbRes = await fetch(METABASE_URL);
    if (!mbRes.ok) throw new Error(`Metabase fetch failed: ${mbRes.status}`);
    const csvText = await mbRes.text();
    const lines = csvText.split("\n").filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error("No data rows in CSV");
    const headers = parseCSVLine(lines[0]);
    const ci: Record<string, number> = {};
    headers.forEach((h, i) => { ci[h] = i; });
    const v = (row: string[], col: string) => ci[col] !== undefined ? coerce(row[ci[col]]) : null;
    const vInt = (row: string[], col: string): number | null => { const val = v(row, col); if (val === null) return null; const n = Number(val); return isNaN(n) ? null : Math.round(n); };

    const records = lines.slice(1).map((line) => {
      const row = parseCSVLine(line);
      return {
        hub: v(row, "Hub"), queue_position: vInt(row, "Queue Position"), reg_number: v(row, "Vehicle"),
        dms_jc_id: v(row, "JC ID"), oos_since: v(row, "OOS Since"), days_in_oos: v(row, "Days in OOS"),
        labour_items: v(row, "Planned Work"), has_parts: v(row, "Parts Needed"),
        labour_mins: vInt(row, "Est. Time (mins)"), estimated_mins: vInt(row, "Est. Time (mins)"),
        cumulative_mins: vInt(row, "Cumulative Mins"), synced_at: new Date().toISOString(), parts_items: null as string | null,
      };
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const jcIds = records.map(r => r.dms_jc_id).filter(Boolean) as string[];
    if (jcIds.length > 0) {
      const { data: partsRows } = await supabase.from("jc_history").select("jc_no, item_name").in("jc_no", jcIds).eq("line_type", "Part").not("item_name", "is", null);
      if (partsRows && partsRows.length > 0) {
        const partsMap: Record<string, Set<string>> = {};
        for (const row of partsRows) { if (!partsMap[row.jc_no]) partsMap[row.jc_no] = new Set(); partsMap[row.jc_no].add(row.item_name); }
        for (const rec of records) { const jcId = rec.dms_jc_id as string | null; if (jcId && partsMap[jcId]) rec.parts_items = [...partsMap[jcId]].sort().join(", "); }
      }
    }

    await supabase.from("oos_work_queue").delete().neq("id", 0);
    const { error: insError } = await supabase.from("oos_work_queue").insert(records);
    if (insError) throw new Error(`Insert failed: ${insError.message}`);

    return new Response(JSON.stringify({ success: true, count: records.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
