import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const METABASE_URL = "http://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/18f2864d-eab9-44f9-806c-edd1542dee88/query/json?parameters=%5B%5D";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEDUP_SECONDS = 55;

async function writeHeartbeat(sb: any, status: string, durationMs: number, rowsAffected: number | null = null, errorMessage: string | null = null) {
  try { await sb.from('sync_heartbeats').insert({ function_name: 'bike-location-sync', status, duration_ms: durationMs, rows_affected: rowsAffected, error_message: errorMessage, synced_at: new Date().toISOString() }); } catch (_) {}
}

Deno.serve(async (_req: Request) => {
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { data } = await sb.from('app_settings').select('value').eq('key','bike_location_last_sync').single();
    if (data?.value) {
      const elapsed = (Date.now() - new Date(data.value).getTime()) / 1000;
      if (elapsed < DEDUP_SECONDS) {
        console.log(`Skipping sync — last ran ${Math.round(elapsed)}s ago`);
        return new Response(JSON.stringify({ skipped: true, elapsed_seconds: Math.round(elapsed) }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  } catch (_) {}

  await sb.from('app_settings').upsert({ key: 'bike_location_last_sync', value: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'key' });

  try {
    console.log('Fetching bike location data from Metabase...');
    const mbRes = await fetch(METABASE_URL);
    if (!mbRes.ok) throw new Error(`Metabase error: ${mbRes.status}`);

    const rows = await mbRes.json();
    console.log(`Rows fetched: ${rows.length}`);

    const now = new Date().toISOString();
    const records = rows
      .filter((r: any) => r.lat != null && r.lng != null)
      .map((r: any) => ({
        chassis_number: r.chassis_number,
        reg_number: r.reg_number || null,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lng),
        baas_location_time: r.baas_location_time || null,
        current_soc: r.current_soc != null ? parseFloat(r.current_soc) : null,
        vehicle_status: r.vehicle_status || null,
        synced_at: now,
      }));

    console.log(`Valid records to upsert: ${records.length}`);
    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error } = await sb.from('bike_location_cache').upsert(records.slice(i, i + BATCH), { onConflict: 'chassis_number' });
      if (error) throw new Error(`Upsert failed at batch ${i}: ${error.message}`);
    }

    await writeHeartbeat(sb, 'success', Date.now() - t0, records.length);
    return new Response(JSON.stringify({ success: true, count: records.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error:', String(err));
    await writeHeartbeat(sb, 'error', Date.now() - t0, null, String(err));
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
