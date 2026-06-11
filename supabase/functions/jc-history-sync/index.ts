import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const METABASE_URL =
  "http://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/a2c3e48b-1b15-4c14-830d-5d65199d143f/query/csv?parameters=%5B%5D";

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

function coerce(val: string): string | number | null {
  if (val === "" || val === "null" || val === "NULL") return null;
  const num = Number(val);
  if (!isNaN(num) && val !== "") return num;
  return val;
}

Deno.serve(async (_req: Request) => {
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
      jc_no: v(row, "jc_no"), bike_id: v(row, "bike_id"), reg_number: v(row, "reg_number"),
      bike_odo: v(row, "bike_odo"), jc_date: v(row, "jc_date"), hub_name: v(row, "hub_name"),
      service_type: v(row, "service_type"), line_type: v(row, "line_type"), item_name: v(row, "item_name"),
      qty: v(row, "qty"), amount: v(row, "amount"), technician_name: v(row, "technician_name"), source: v(row, "source"),
    }));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { error: delError } = await supabase.from("jc_history").delete().neq("id", 0);
    if (delError) throw new Error(`Delete failed: ${delError.message}`);

    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error: insError } = await supabase.from("jc_history").insert(records.slice(i, i + BATCH));
      if (insError) throw new Error(`Insert failed at batch ${i}: ${insError.message}`);
    }

    return new Response(JSON.stringify({ success: true, count: records.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
