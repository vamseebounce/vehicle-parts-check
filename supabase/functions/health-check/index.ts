import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALERT_EMAIL  = "vamsee@bounceshare.com";
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };

async function sendAlert(reason: string) {
  if (!RESEND_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "alerts@bounceops.online", to: ALERT_EMAIL, subject: "🚨 Supabase DB Health Check Failed", html: `<p><strong>Supabase DB is unreachable.</strong></p><p>Reason: ${reason}</p><p>Time: ${new Date().toISOString()}</p>` }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const t0 = Date.now();
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await sb.rpc("health_check_ping");
    const ms = Date.now() - t0;
    if (error) { await sendAlert(error.message); return new Response(JSON.stringify({ status: "unhealthy", error: error.message, ms }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } }); }
    return new Response(JSON.stringify({ status: "healthy", result: data, ms }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    const ms = Date.now() - t0;
    await sendAlert(String(err));
    return new Response(JSON.stringify({ status: "unhealthy", error: String(err), ms }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
