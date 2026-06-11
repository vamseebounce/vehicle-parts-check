import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MGMT_TOKEN    = Deno.env.get("MGMT_TOKEN") ?? "";
const RESEND_KEY    = Deno.env.get("RESEND_API_KEY") ?? "";
const ALERT_EMAIL   = "vamsee@bounceshare.com";
const PROJECT_REF   = "clkfvmmlgwcvntxnolsv";
const EGRESS_LIMIT_GB  = 250;
const EGRESS_WARN_PCT  = 0.70; // alert at 70% = 175 GB

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

async function sendAlert(subject: string, html: string) {
  if (!RESEND_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "alerts@bounceops.online", to: ALERT_EMAIL, subject, html }),
  });
}

async function checkEgress(): Promise<{ egress_gb: number; pct: number; warning: boolean } | null> {
  if (!MGMT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/usage`, {
      headers: { "Authorization": `Bearer ${MGMT_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json();

    // Supabase usage API — handle different response shapes
    let egress_gb: number | null = null;
    if (data?.usage?.egress?.usage != null)   egress_gb = data.usage.egress.usage;
    else if (data?.egress_gb != null)         egress_gb = data.egress_gb;
    else if (typeof data?.egress === "number") egress_gb = data.egress;

    if (egress_gb == null) return null;
    const pct = egress_gb / EGRESS_LIMIT_GB;
    return { egress_gb, pct, warning: pct >= EGRESS_WARN_PCT };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const t0 = Date.now();
  const now = new Date().toISOString();
  const result: Record<string, unknown> = { time: now };

  // ── 1. DB health check ────────────────────────────────────────────────────
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await sb.rpc("health_check_ping");
    const ms = Date.now() - t0;
    if (error) {
      result.db = { status: "unhealthy", error: error.message, ms };
      await sendAlert(
        "🚨 FleetPro DB Health Check Failed",
        `<p><strong>Supabase DB is unreachable.</strong></p><p>Reason: ${error.message}</p><p>Time: ${now}</p>`,
      );
    } else {
      result.db = { status: "healthy", result: data, ms };
    }
  } catch (err) {
    const ms = Date.now() - t0;
    result.db = { status: "unhealthy", error: String(err), ms };
    await sendAlert(
      "🚨 FleetPro DB Health Check Failed",
      `<p><strong>Supabase DB threw an exception.</strong></p><p>Error: ${String(err)}</p><p>Time: ${now}</p>`,
    );
  }

  // ── 2. Egress check ──────────────────────────────────────────────────────
  const egress = await checkEgress();
  if (egress) {
    result.egress = {
      used_gb: egress.egress_gb.toFixed(1),
      limit_gb: EGRESS_LIMIT_GB,
      pct: `${(egress.pct * 100).toFixed(1)}%`,
      warning: egress.warning,
    };
    if (egress.warning) {
      await sendAlert(
        `⚠️ FleetPro Egress Warning: ${(egress.pct * 100).toFixed(0)}% used`,
        `<p><strong>Supabase egress is at ${(egress.pct * 100).toFixed(1)}% this month.</strong></p>
         <p>Used: <b>${egress.egress_gb.toFixed(1)} GB</b> of ${EGRESS_LIMIT_GB} GB</p>
         <p>At this rate you may hit the limit before month-end. Consider reducing sync frequency or upgrading plan.</p>
         <p>Checked at: ${now}</p>`,
      );
    }
  } else {
    result.egress = MGMT_TOKEN ? { status: "check_failed" } : { status: "no_token_set" };
  }

  const dbStatus = (result.db as Record<string, unknown>)?.status;
  const overall = dbStatus === "healthy" ? "healthy" : "unhealthy";
  return new Response(JSON.stringify({ status: overall, ...result }), {
    status: overall === "healthy" ? 200 : 503,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
