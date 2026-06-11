// metabase-sync — vehicle parts check flag sync (Sheet 9)
// See full source — captured from Supabase dashboard 2026-06-11
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const METABASE_URL =
  "http://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/0d3d2aec-25c0-4ef7-bffa-38b2575fd496/query/csv?parameters=%5B%5D";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim()); current = "";
    } else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function coerce(val: string): string | number | null {
  if (val === "" || val === "null" || val === "NULL") return null;
  const num = Number(val);
  if (!isNaN(num) && val !== "") return num;
  return val;
}

function rank(s: string | null): number {
  if (s === "Overdue")  return 1;
  if (s === "Due Soon") return 2;
  if (s === "OK")       return 3;
  return 4;
}

const BATCH_SIZE = 500;

async function insertBatch(supabase: any, batch: any[], batchNum: number, attempt = 1): Promise<void> {
  const { error } = await supabase.from("vehicle_parts_check_flag").insert(batch);
  if (!error) { console.log(`Batch ${batchNum} OK (${batch.length} rows)`); return; }
  if (attempt > 3) throw new Error(`Batch ${batchNum} failed after 3 attempts: ${error.message}`);
  await new Promise(r => setTimeout(r, 1000 * attempt));
  return insertBatch(supabase, batch, batchNum, attempt + 1);
}

Deno.serve(async (_req: Request) => {
  try {
    const mbRes = await fetch(METABASE_URL);
    if (!mbRes.ok) throw new Error(`Metabase fetch failed: ${mbRes.status} ${mbRes.statusText}`);

    const csvText = await mbRes.text();
    const lines = csvText.split("\n").filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error("No data rows in CSV");

    const headers = parseCSVLine(lines[0]);
    const ci: Record<string, number> = {};
    headers.forEach((h, i) => { ci[h] = i; });
    const v = (row: string[], col: string): string | number | null =>
      ci[col] !== undefined ? coerce(row[ci[col]]) : null;

    const dataRows = lines.slice(1).map(parseCSVLine);
    const records = dataRows.map((row) => {
      const fbs  = v(row, "front_brake_status")         as string | null;
      const rbs  = v(row, "rear_brake_status")          as string | null;
      const ts   = v(row, "tyre_status")                as string | null;
      const frcs = v(row, "fr_brake_cable_status")      as string | null;
      const rrcs = v(row, "rr_brake_cable_status")      as string | null;
      const bss  = v(row, "brake_shoe_spring_status")   as string | null;
      const cos  = v(row, "cone_set_status")            as string | null;
      const frds = v(row, "fr_brake_disc_status")       as string | null;
      const rrds = v(row, "rr_brake_disc_status")       as string | null;
      const bos  = v(row, "brake_oil_status")           as string | null;
      const frwb = v(row, "fr_wheel_bearing_status")    as string | null;
      const rrwb = v(row, "rr_wheel_bearing_status")    as string | null;
      const sss  = v(row, "side_stand_spring_status")   as string | null;
      const mss  = v(row, "main_stand_spring_status")   as string | null;

      let brake_status: string | null = null;
      let brake_km_since: unknown = null, brake_km_remaining: unknown = null;
      let last_brake_replaced_date: unknown = null, last_brake_replaced_hub: unknown = null;
      if (rank(fbs) <= rank(rbs)) {
        brake_status = fbs; brake_km_since = v(row, "front_brake_km_since");
        brake_km_remaining = v(row, "front_brake_km_remaining");
        last_brake_replaced_date = v(row, "last_front_brake_replaced_date");
        last_brake_replaced_hub = v(row, "last_front_brake_replaced_hub");
      } else {
        brake_status = rbs; brake_km_since = v(row, "rear_brake_km_since");
        brake_km_remaining = v(row, "rear_brake_km_remaining");
        last_brake_replaced_date = v(row, "last_rear_brake_replaced_date");
        last_brake_replaced_hub = v(row, "last_rear_brake_replaced_hub");
      }
      const allStatuses = [fbs, rbs, ts, frcs, rrcs, bss, cos, frds, rrds, bos, frwb, rrwb, sss, mss];
      return {
        bike_id: v(row, "bike_id"), reg_number: v(row, "reg_number"),
        dms_bike_model_id: v(row, "dms_bike_model_id"),
        estimated_current_odo: v(row, "estimated_current_odo"),
        last_jc_odo: v(row, "last_jc_odo"), days_since_last_jc: v(row, "days_since_last_jc"),
        front_brake_status: fbs, front_brake_km_since: v(row, "front_brake_km_since"),
        front_brake_km_remaining: v(row, "front_brake_km_remaining"),
        last_front_brake_replaced_date: v(row, "last_front_brake_replaced_date"),
        last_front_brake_replaced_hub: v(row, "last_front_brake_replaced_hub"),
        rear_brake_status: rbs, rear_brake_km_since: v(row, "rear_brake_km_since"),
        rear_brake_km_remaining: v(row, "rear_brake_km_remaining"),
        last_rear_brake_replaced_date: v(row, "last_rear_brake_replaced_date"),
        last_rear_brake_replaced_hub: v(row, "last_rear_brake_replaced_hub"),
        brake_status, brake_km_since, brake_km_remaining,
        last_brake_replaced_date, last_brake_replaced_hub,
        tyre_status: ts, tyre_km_since: v(row, "tyre_km_since"),
        tyre_km_remaining: v(row, "tyre_km_remaining"),
        last_tyre_replaced_date: v(row, "last_tyre_replaced_date"),
        last_tyre_replaced_hub: v(row, "last_tyre_replaced_hub"),
        fr_brake_cable_status: frcs, fr_brake_cable_km_since: v(row, "fr_brake_cable_km_since"),
        fr_brake_cable_km_remaining: v(row, "fr_brake_cable_km_remaining"),
        last_fr_brake_cable_replaced_date: v(row, "last_fr_brake_cable_replaced_date"),
        last_fr_brake_cable_replaced_hub: v(row, "last_fr_brake_cable_replaced_hub"),
        rr_brake_cable_status: rrcs, rr_brake_cable_km_since: v(row, "rr_brake_cable_km_since"),
        rr_brake_cable_km_remaining: v(row, "rr_brake_cable_km_remaining"),
        last_rr_brake_cable_replaced_date: v(row, "last_rr_brake_cable_replaced_date"),
        last_rr_brake_cable_replaced_hub: v(row, "last_rr_brake_cable_replaced_hub"),
        brake_shoe_spring_status: bss, brake_shoe_spring_km_since: v(row, "brake_shoe_spring_km_since"),
        brake_shoe_spring_km_remaining: v(row, "brake_shoe_spring_km_remaining"),
        last_brake_shoe_spring_replaced_date: v(row, "last_brake_shoe_spring_replaced_date"),
        last_brake_shoe_spring_replaced_hub: v(row, "last_brake_shoe_spring_replaced_hub"),
        cone_set_status: cos, cone_set_km_since: v(row, "cone_set_km_since"),
        cone_set_km_remaining: v(row, "cone_set_km_remaining"),
        last_cone_set_replaced_date: v(row, "last_cone_set_replaced_date"),
        last_cone_set_replaced_hub: v(row, "last_cone_set_replaced_hub"),
        fr_brake_disc_status: frds, fr_brake_disc_km_since: v(row, "fr_brake_disc_km_since"),
        fr_brake_disc_km_remaining: v(row, "fr_brake_disc_km_remaining"),
        last_fr_brake_disc_replaced_date: v(row, "last_fr_brake_disc_replaced_date"),
        last_fr_brake_disc_replaced_hub: v(row, "last_fr_brake_disc_replaced_hub"),
        rr_brake_disc_status: rrds, rr_brake_disc_km_since: v(row, "rr_brake_disc_km_since"),
        rr_brake_disc_km_remaining: v(row, "rr_brake_disc_km_remaining"),
        last_rr_brake_disc_replaced_date: v(row, "last_rr_brake_disc_replaced_date"),
        last_rr_brake_disc_replaced_hub: v(row, "last_rr_brake_disc_replaced_hub"),
        brake_oil_status: bos, brake_oil_km_since: v(row, "brake_oil_km_since"),
        brake_oil_km_remaining: v(row, "brake_oil_km_remaining"),
        last_brake_oil_replaced_date: v(row, "last_brake_oil_replaced_date"),
        last_brake_oil_replaced_hub: v(row, "last_brake_oil_replaced_hub"),
        fr_wheel_bearing_status: frwb, fr_wheel_bearing_km_since: v(row, "fr_wheel_bearing_km_since"),
        fr_wheel_bearing_km_remaining: v(row, "fr_wheel_bearing_km_remaining"),
        last_fr_wheel_bearing_replaced_date: v(row, "last_fr_wheel_bearing_replaced_date"),
        last_fr_wheel_bearing_replaced_hub: v(row, "last_fr_wheel_bearing_replaced_hub"),
        rr_wheel_bearing_status: rrwb, rr_wheel_bearing_km_since: v(row, "rr_wheel_bearing_km_since"),
        rr_wheel_bearing_km_remaining: v(row, "rr_wheel_bearing_km_remaining"),
        last_rr_wheel_bearing_replaced_date: v(row, "last_rr_wheel_bearing_replaced_date"),
        last_rr_wheel_bearing_replaced_hub: v(row, "last_rr_wheel_bearing_replaced_hub"),
        side_stand_spring_status: sss, side_stand_spring_km_since: v(row, "side_stand_spring_km_since"),
        side_stand_spring_km_remaining: v(row, "side_stand_spring_km_remaining"),
        last_side_stand_spring_replaced_date: v(row, "last_side_stand_spring_replaced_date"),
        last_side_stand_spring_replaced_hub: v(row, "last_side_stand_spring_replaced_hub"),
        main_stand_spring_status: mss, main_stand_spring_km_since: v(row, "main_stand_spring_km_since"),
        main_stand_spring_km_remaining: v(row, "main_stand_spring_km_remaining"),
        last_main_stand_spring_replaced_date: v(row, "last_main_stand_spring_replaced_date"),
        last_main_stand_spring_replaced_hub: v(row, "last_main_stand_spring_replaced_hub"),
        overall_urgency: Math.min(...allStatuses.map(rank)),
        check_required: allStatuses.some(s => s === "Overdue" || s === "Due Soon"),
        current_status: v(row, "current_status"),
        deployed_hub: v(row, "deployed_hub"),
        last_service_hub: v(row, "last_service_hub"),
      };
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { error: delError } = await supabase.from("vehicle_parts_check_flag").delete().neq("id", 0);
    if (delError) throw new Error(`Delete failed: ${delError.message}`);

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      await insertBatch(supabase, records.slice(i, i + BATCH_SIZE), Math.floor(i / BATCH_SIZE) + 1);
    }

    return new Response(JSON.stringify({ success: true, count: records.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
