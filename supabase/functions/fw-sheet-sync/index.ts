import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQQKVgHvymh2uIl8_C-7cYcaQfrRMXSAcK1Rsfm8UWEVz-flIxqzHIDFFXwjmgIfWSjHtpU8HlbpZGo/pub?gid=2141051919&single=true&output=csv";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function writeHeartbeat(sb: any, status: string, durationMs: number, rowsAffected: number | null = null, errorMessage: string | null = null) {
  try { await sb.from('sync_heartbeats').insert({ function_name: 'fw-sheet-sync', status, duration_ms: durationMs, rows_affected: rowsAffected, error_message: errorMessage, synced_at: new Date().toISOString() }); } catch (_) {}
}

const CORS = {
  "Access-Control-Allow-Origin":  "https://bounceops.online",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function parseCSV(text: string): string[][] {
  const lines = text.split("\n");
  return lines.slice(1).map(line => {
    const cols: string[] = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    return cols;
  }).filter(r => r.length >= 9);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    console.log("Fetching Google Sheet...");
    const sheetRes = await fetch(SHEET_URL);
    if (!sheetRes.ok) throw new Error(`Sheet fetch failed: ${sheetRes.status}`);

    const text = await sheetRes.text();
    const rows = parseCSV(text);

    const now = new Date().toISOString();
    const pending = rows
      .filter(r => {
        const fw = r[8]?.trim() ?? "";
        return fw === "" || fw.toLowerCase().includes("yet");
      })
      .map(r => ({
        chassis_number: r[1]?.trim() ?? "",
        hub:            r[7]?.trim() ?? "",
        reg_number:     r[9]?.trim() ?? "",
        synced_at:      now,
      }))
      .filter(r => r.chassis_number);

    console.log(`Pending bikes from sheet: ${pending.length}`);

    const { error: deleteErr } = await sb
      .from("fw_pending_cache")
      .delete()
      .gte("synced_at", "2000-01-01");
    if (deleteErr) throw new Error(`Delete error: ${deleteErr.message}`);

    if (pending.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < pending.length; i += BATCH) {
        const { error: insertErr } = await sb
          .from("fw_pending_cache")
          .insert(pending.slice(i, i + BATCH));
        if (insertErr) throw new Error(`Insert error: ${insertErr.message}`);
      }
    }

    await writeHeartbeat(sb, 'success', Date.now() - t0, pending.length);
    return new Response(
      JSON.stringify({ ok: true, pending: pending.length }),
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
