import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const METABASE_BASE = "http://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/6f11e26e-044f-440a-8d4d-576ebfafce74/query/json";

const CORS = {
  "Access-Control-Allow-Origin": "https://bounceops.online",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function normaliseRows(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw?.data?.rows && raw?.data?.cols) {
    const cols: string[] = raw.data.cols.map((c: any) => c.display_name || c.name);
    return raw.data.rows.map((row: any[]) => {
      const obj: Record<string, any> = {};
      cols.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }
  if (raw?.rows) return raw.rows;
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    const { start_date, end_date } = await req.json();
    if (!start_date || !end_date) throw new Error("start_date and end_date required");

    const params = JSON.stringify([
      { type: "category", target: ["variable", ["template-tag", "start_date"]], value: start_date },
      { type: "category", target: ["variable", ["template-tag", "end_date"]],   value: end_date   },
    ]);

    const url = `${METABASE_BASE}?parameters=${encodeURIComponent(params)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Metabase error ${res.status}: ${errText.slice(0, 300)}`);
    }
    const raw = await res.json();
    const rows = normaliseRows(raw);

    const tickets = rows
      .filter((r: any) => r.ticketNumber || r['ticketNumber'])
      .map((r: any) => ({
        ticket_number:     String(r.ticketNumber ?? r['ticketNumber']),
        status:            r.status              ?? null,
        category:          r.category            ?? null,
        reg_number:        r["Reg Number"]       ?? null,
        technician_name:   r["Technician Name"]  ?? null,
        fault_details:     r.faultDetails        ?? null,
        created_at_ist:    r.Created_at_IST      ?? null,
        inprogress_at_ist: r.InProgress_at_IST   ?? null,
        resolved_at_ist:   r.Resolved_at_IST     ?? null,
        tat_minutes:       r.TAT_Minutes          ?? null,
      }));

    return new Response(JSON.stringify(tickets), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", String(err));
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
