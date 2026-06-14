import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const METABASE_URL  = "http://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/f79c5050-213f-4a6e-962f-1369de907cdb/query/json?parameters=%5B%5D";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEDUP_SECONDS = 100;

const RSA_TEAM = [
  { name: 'Nishanth', chassis: 'P6EBE1JYK25000288', reg: 'KA05AR5056' },
  { name: 'Pavan',    chassis: 'P6EBE1JYK25000072', reg: 'KA05AR3238' },
];

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

function todayIST(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 330);
  return d.toISOString().slice(0, 10);
}

// Returns current IST hour (0–23)
function hourIST(): number {
  return new Date(Date.now() + 330 * 60 * 1000).getUTCHours();
}

// Off-hours: midnight–6am IST — no RSA ops, skip all cron work
const OFF_HOURS_START = 0;  // midnight IST
const OFF_HOURS_END   = 6;  // 6am IST (exclusive)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = new Date().toISOString();

  let start_date = todayIST();
  let end_date   = todayIST();
  let isScheduled = true;

  try {
    const body = await req.json().catch(() => ({}));
    if (body.start_date) { start_date = body.start_date; isScheduled = false; }
    if (body.end_date)   { end_date   = body.end_date;   isScheduled = false; }
  } catch (_) {}

  // ── Off-hours guard: skip cron runs midnight–6am IST (no ops, saves ~180 DB hits/day) ──
  if (isScheduled) {
    const h = hourIST();
    if (h >= OFF_HOURS_START && h < OFF_HOURS_END) {
      return new Response(JSON.stringify({ skipped: true, reason: 'off-hours', ist_hour: h }), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }
  }

  // ── Step 0: RSA team tracking — runs first, always, no dedup ──
  if (isScheduled) {
    try {
      const { data: teamLocs } = await sb
        .from('bike_location_cache')
        .select('chassis_number,lat,lng')
        .in('chassis_number', RSA_TEAM.map(t => t.chassis));

      const teamRows = (teamLocs || []).map((loc: any) => {
        const member = RSA_TEAM.find(t => t.chassis === loc.chassis_number);
        if (!member || !loc.lat || !loc.lng) return null;
        return { name: member.name, chassis: member.chassis, reg_number: member.reg, lat: loc.lat, lng: loc.lng, synced_at: now };
      }).filter(Boolean);

      if (teamRows.length > 0) {
        const { error } = await sb.from('rsa_team_locations').insert(teamRows);
        if (error) console.error('Team insert error:', error.message);
        else console.log(`Team tracking: appended ${teamRows.length} rows`);
      } else {
        console.log('Team tracking: no bikes found in cache');
      }
    } catch (e) {
      console.error('Team tracking error:', String(e));
    }
  }

  // ── Step 1: Dedup check ──
  if (isScheduled) {
    try {
      const { data } = await sb.from('app_settings').select('value').eq('key','rsa_ticket_last_sync').single();
      if (data?.value) {
        const elapsed = (Date.now() - new Date(data.value).getTime()) / 1000;
        if (elapsed < DEDUP_SECONDS) {
          return new Response(JSON.stringify({ skipped: true, elapsed_seconds: Math.round(elapsed) }), { headers: { 'Content-Type': 'application/json', ...CORS } });
        }
      }
    } catch (_) {}
    try {
      await sb.from('app_settings').upsert(
        { key: 'rsa_ticket_last_sync', value: now, updated_at: now },
        { onConflict: 'key' }
      );
    } catch (_) {}
  }

  // ── Step 2: Ticket sync from Metabase ──
  try {
    console.log(`Syncing RSA tickets for ${start_date} → ${end_date}`);
    const res = await fetch(METABASE_URL);
    if (!res.ok) throw new Error(`Metabase error: ${res.status}`);
    const all = await res.json();

    const filtered = all.filter((r: any) => {
      const d = (r.Created_at_IST || '').slice(0, 10);
      return d >= start_date && d <= end_date;
    });
    console.log(`Filtered: ${filtered.length}`);

    const records = filtered
      .filter((r: any) => r.ticketNumber)
      .map((r: any) => ({
        ticket_number:          String(r.ticketNumber),
        status:                 r.status              ?? null,
        category:               r.category            ?? null,
        reg_number:             r['Reg Number']       ?? null,
        technician_name:        r['Technician Name']  ?? null,
        fault_details:          r.faultDetails        ?? null,
        created_at_ist:         r.Created_at_IST      ?? null,
        inprogress_at_ist:      r.InProgress_at_IST   ?? null,
        resolved_at_ist:        r.Resolved_at_IST     ?? null,
        tat_minutes:            r.TAT_Minutes          ?? null,
        city:                   r.city                ?? null,
        lat:                    r.Bass_Lat            ?? null,
        lng:                    r.Bass_Lng            ?? null,
        bass_location_time_ist: r.Bass_Location_Time_IST ?? null,
        synced_at:              now,
      }));

    const openTickets = records.filter((r: any) => r.status !== 'DONE' && r.reg_number);
    const liveLocMap: Record<string, { lat: number; lng: number }> = {};

    if (openTickets.length > 0) {
      const { data: liveRows } = await sb
        .from('bike_location_cache')
        .select('reg_number,lat,lng')
        .in('reg_number', openTickets.map((r: any) => r.reg_number));
      (liveRows || []).forEach((row: any) => {
        if (row.reg_number) liveLocMap[row.reg_number] = { lat: row.lat, lng: row.lng };
      });
      records.forEach((r: any) => {
        if (r.status !== 'DONE' && liveLocMap[r.reg_number]) {
          r.live_lat = liveLocMap[r.reg_number].lat;
          r.live_lng = liveLocMap[r.reg_number].lng;
        }
      });
    }

    // 2.1: Upsert on ticket_number (PK) — no more delete+reinsert
    // Stops Realtime churn; preserves rows not in current sync window
    const BATCH = 200;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error } = await sb.from('rsa_tickets_cache')
        .upsert(records.slice(i, i + BATCH), { onConflict: 'ticket_number' });
      if (error) throw new Error(`Upsert error: ${error.message}`);
    }

    if (isScheduled && openTickets.length > 0) {
      try {
        const trailRows = openTickets
          .filter((r: any) => liveLocMap[r.reg_number])
          .map((r: any) => ({
            ticket_number: r.ticket_number, status: r.status,
            lat: liveLocMap[r.reg_number].lat, lng: liveLocMap[r.reg_number].lng,
            synced_at: now,
          }));
        if (trailRows.length > 0) {
          await sb.from('rsa_ticket_locations').insert(trailRows);
          console.log(`Ticket trail: ${trailRows.length} rows`);
        }
      } catch (e) { console.error('Ticket trail error:', String(e)); }
    }

    return new Response(JSON.stringify({ success: true, count: records.length, start_date, end_date }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (err) {
    console.error('Ticket sync error:', String(err));
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
