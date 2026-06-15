import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const METABASE_URL = "http://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/55e3b2b1-b266-4f99-947b-2ce0dde6d9bb/query/json?parameters=%5B%5D";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function writeHeartbeat(sb: any, status: string, durationMs: number, rowsAffected: number | null = null, errorMessage: string | null = null) {
  try { await sb.from('sync_heartbeats').insert({ function_name: 'fw-map-rider-sync', status, duration_ms: durationMs, rows_affected: rowsAffected, error_message: errorMessage, synced_at: new Date().toISOString() }); } catch (_) {}
}

const CORS = {
  "Access-Control-Allow-Origin":  "https://bounceops.online",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    console.log("Fetching rider data from Metabase...");
    const mbRes = await fetch(METABASE_URL);
    if (!mbRes.ok) throw new Error(`Metabase ${mbRes.status}: ${mbRes.statusText}`);

    const rows: Array<{ chassis_number: string; rider_name: string | null; rider_phone: string | null }>
      = await mbRes.json();
    console.log(`Rows from Metabase: ${rows.length}`);

    const payload = rows
      .filter(r => r.chassis_number)
      .map(r => ({
        chassis_number: r.chassis_number,
        rider_name:     r.rider_name   || null,
        rider_phone:    r.rider_phone  || null,
        synced_at:      new Date().toISOString(),
      }));

    const { error } = await sb
      .from("bike_rider_cache")
      .upsert(payload, { onConflict: "chassis_number" });

    if (error) throw new Error(`Supabase upsert: ${error.message}`);

    console.log(`Upserted ${payload.length} rows into bike_rider_cache`);
    await writeHeartbeat(sb, 'success', Date.now() - t0, payload.length);
    return new Response(
      JSON.stringify({ ok: true, rows: payload.length }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", String(err));
    await writeHeartbeat(sb, 'error', Date.now() - t0, null, String(err));
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
