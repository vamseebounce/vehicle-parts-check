import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ALERT_EMAIL    = "vamsee@bounceshare.com";
const FROM_EMAIL     = "alerts@bounceops.online";

async function sendAlert(subject: string, body: string) {
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY not set"); return; }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [ALERT_EMAIL], subject, html: `<p>${body}</p><p><small>Checked at ${new Date().toISOString()} UTC</small></p>` }),
  });
}

Deno.serve(async (_req: Request) => {
  const start = Date.now();
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error } = await sb.from("bike_rider_cache").select("chassis_number").limit(1);
    if (error) throw new Error(error.message);
    const ms = Date.now() - start;
    return new Response(JSON.stringify({ ok: true, latency_ms: ms }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const msg = String(err);
    await sendAlert("🚨 Supabase DB Down — bounceops.online", `<strong>Database health check failed.</strong><br><br>Error: <code>${msg}</code>`);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
});
