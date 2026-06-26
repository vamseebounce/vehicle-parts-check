import { createClient } from 'jsr:@supabase/supabase-js@2';
import postgres from 'npm:postgres';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOUNCE_DB_URL = Deno.env.get('BOUNCE_DB_URL')!;
const SYNC_SECRET = Deno.env.get('SYNC_SECRET');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function calcPayout(eligible: number): number {
  if (eligible <= 50) return 0;
  const a = eligible - 50;
  let p = Math.min(a, 10) * 25;
  if (a > 10) p += Math.min(a - 10, 20) * 50;
  if (a > 30) p += Math.min(a - 30, 10) * 75;
  if (a > 40) p += (a - 40) * 100;
  return Math.min(p, 5000);
}

function getWeekStart(d: Date): string {
  const dt = new Date(d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
  return dt.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (SYNC_SECRET) {
    const auth = req.headers.get('Authorization') ?? '';
    if (auth.replace('Bearer ', '') !== SYNC_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    }
  }

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const lookbackDays: number = body.lookback_days ?? 14;

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - lookbackDays);
  const since = sinceDate.toISOString().split('T')[0];

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const sql = postgres(BOUNCE_DB_URL, { ssl: 'require', max: 1, connect_timeout: 30 });

  try {
    console.log(`[sync-incentive] Running query since ${since} (lookback ${lookbackDays}d)`);

    const rows = await sql`
      WITH
      billed_jcs AS (
        SELECT DISTINCT ON (jcsl.id)
          jcsl.id AS jcsl_id, jc.id AS jc_id, b.id AS booking_id,
          COALESCE(b.first_booking, b.id) AS journey_root,
          bike.reg_number, b.bike_id, bm.model_name AS bike_model,
          (jcsl.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS jc_billed_datetime,
          (jcsl.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS jc_billed_date,
          (jc.created_at  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS jc_created_at,
          CASE WHEN jc.intrip = true THEN 1 ELSE 0 END AS intrip,
          REGEXP_REPLACE(TRIM(jcsl.technician_name), '\s+', ' ') AS technician_name,
          rl.location_name AS hub_name, ci.name AS city,
          (b.booking_ended_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS booking_end_datetime,
          (b.booking_ended_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS booking_end_date,
          CASE WHEN jc.intrip = true THEN NULL ELSE (
            SELECT MIN((dep.booking_start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date)
            FROM booking dep WHERE dep.bike_id = b.bike_id
              AND (dep.booking_start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
                  > (jc.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
              AND dep.status IN (
                'booking started and is in progress','booking renewed in another plan',
                'renewal payment confirmed and booking extended',
                'booking started and plan has expired','booking complete and has no dues',
                'booking complete and has dues',
                'payment confirmed and waiting for user to come to hub','user in hub and bike allocated'
              )
          ) END AS next_deployment_date
        FROM job_card_status_log jcsl
        JOIN job_card jc ON jc.id = jcsl.job_card_id
        JOIN booking b ON b.id = jc.booking_id
        JOIN bike bk ON bk.id = b.bike_id
        JOIN bike_model bm ON bm.id = bk.bike_model_id
        JOIN rental_location rl ON rl.id = b.ended_at_location
        JOIN city ci ON ci.id = rl.city_id
        WHERE jcsl.new_status = 'Billed' AND jcsl.technician_name IS NOT NULL
          AND (jcsl.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date >= ${since}
          AND LOWER(bk.reg_number) NOT LIKE '%test%'
        ORDER BY jcsl.id, jcsl.created_at DESC
      ),
      dup_rr AS (
        SELECT DISTINCT booking_id FROM (
          SELECT b.id AS booking_id,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM booking bx JOIN booking bx_chg ON bx.booking_after_changing_bike = bx_chg.id
                WHERE bx.bike_id = b.bike_id
                  AND (bx.booking_ended_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
                      = (b.booking_ended_at  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
                  AND bx_chg.created_for_bike_change = 'true' AND bx.total_premium_fees IS NULL
                  AND bx_chg.bike_id <> bx.bike_id
              ) THEN 'dup'
              WHEN ROW_NUMBER() OVER (
                PARTITION BY b.bike_id, (b.booking_ended_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
                ORDER BY b.booking_ended_at
              ) > 1 THEN 'dup' ELSE NULL
            END AS flag
          FROM booking b
          INNER JOIN booking bc ON b.booking_after_changing_bike = bc.id AND bc.bike_id = b.bike_id
          LEFT JOIN ops_user ou ON b.booking_ended_by = ou.id
          WHERE b.intrip_dues='true' AND b.extra_premium_collected IS NULL
            AND b.paid_premium_fees IS NULL AND b.total_premium_fees IS NULL
            AND (ou.name NOT IN ('Charan','Srinivas Naik') OR ou.name IS NULL)
        ) x WHERE flag IS NOT NULL
      ),
      clean_rr AS (
        SELECT b.id AS comeback_booking_id, COALESCE(b.first_booking,b.id) AS journey_root,
          b.bike_id,
          (b.booking_ended_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS repair_date,
          (b.booking_ended_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS repair_datetime,
          EXISTS (
            SELECT 1 FROM final_items_in_job_card fi
            LEFT JOIN part_list pl ON fi.part_id::integer = pl.id
            LEFT JOIN labour_list ll ON fi.labour_id::integer = ll.id
            WHERE fi.job_card_id = jc.id AND fi.dms_cat = 'A'
              AND lower(COALESCE(pl.part_name,ll.labour_name,'')) !~ 'tyre|tire|tube|puncture|puncher|punchar'
          ) AS is_void
        FROM booking b
        INNER JOIN booking bc ON b.booking_after_changing_bike = bc.id
        INNER JOIN job_card jc ON b.id = jc.booking_id
        LEFT JOIN dup_rr dr ON b.id = dr.booking_id
        LEFT JOIN ops_user ou ON b.booking_ended_by = ou.id
        WHERE (
          (b.intrip_dues='true' AND b.extra_premium_collected IS NULL
           AND b.paid_premium_fees IS NULL AND b.total_premium_fees IS NULL AND bc.bike_id=b.bike_id)
          OR (bc.created_for_bike_change='true' AND b.total_premium_fees IS NULL AND bc.bike_id<>b.bike_id)
        )
        AND dr.booking_id IS NULL
        AND (ou.name NOT IN ('Charan','Srinivas Naik') OR ou.name IS NULL)
        AND (b.booking_ended_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date >= ${since}
      ),
      rr_counts AS (
        SELECT bj.jcsl_id,
          COUNT(*) FILTER (
            WHERE cr.is_void=TRUE AND cr.comeback_booking_id!=bj.booking_id AND (
              (bj.intrip=1 AND cr.repair_datetime>bj.booking_end_datetime
               AND cr.repair_datetime<=bj.booking_end_datetime+INTERVAL '3 days')
              OR (bj.intrip=0 AND bj.next_deployment_date IS NOT NULL
                  AND cr.repair_date BETWEEN bj.next_deployment_date AND bj.next_deployment_date+3)
            )
          ) AS rr_count_3d_comeback
        FROM billed_jcs bj
        LEFT JOIN clean_rr cr ON (
          (bj.intrip=1 AND cr.journey_root=bj.journey_root)
          OR (bj.intrip=0 AND cr.bike_id=bj.bike_id)
        )
        GROUP BY bj.jcsl_id
      ),
      first_comeback AS (
        SELECT DISTINCT ON (bj.jcsl_id) bj.jcsl_id, cr.repair_datetime AS comeback_datetime
        FROM billed_jcs bj
        JOIN clean_rr cr ON (
          (bj.intrip=1 AND cr.journey_root=bj.journey_root)
          OR (bj.intrip=0 AND cr.bike_id=bj.bike_id)
        )
        WHERE cr.comeback_booking_id!=bj.booking_id AND cr.is_void=TRUE AND (
          (bj.intrip=1 AND cr.repair_datetime>bj.booking_end_datetime
           AND cr.repair_datetime<=bj.booking_end_datetime+INTERVAL '3 days')
          OR (bj.intrip=0 AND bj.next_deployment_date IS NOT NULL
              AND cr.repair_date BETWEEN bj.next_deployment_date AND bj.next_deployment_date+3)
        )
        ORDER BY bj.jcsl_id, cr.repair_datetime ASC
      )
      SELECT bj.jc_billed_date, bj.jc_billed_datetime, bj.intrip, bj.reg_number, bj.bike_model,
        bj.technician_name, bj.hub_name, bj.city,
        COALESCE(rc.rr_count_3d_comeback,0) AS rr_count_3d_comeback,
        fc.comeback_datetime AS first_comeback_datetime
      FROM billed_jcs bj
      LEFT JOIN rr_counts rc ON rc.jcsl_id=bj.jcsl_id
      LEFT JOIN first_comeback fc ON fc.jcsl_id=bj.jcsl_id
      ORDER BY bj.jc_billed_date DESC, bj.technician_name
    `;

    console.log(`[sync-incentive] Query returned ${rows.length} rows`);

    const { data: techDir } = await supabase
      .from('incentive_technicians')
      .select('name_normalized, name_in_system')
      .not('name_in_system', 'is', null);

    const nameMap: Record<string, string> = {};
    for (const t of techDir ?? []) {
      const jcNames: string[] = Array.isArray(t.name_in_system) ? t.name_in_system : [];
      for (const raw of jcNames) {
        if (raw && t.name_normalized && raw !== t.name_normalized) nameMap[raw] = t.name_normalized;
      }
    }
    console.log(`[sync-incentive] Loaded ${Object.keys(nameMap).length} name mappings`);

    const jcLogRows = rows.map((r: Record<string, unknown>) => {
      const billedDate = r.jc_billed_date instanceof Date ? r.jc_billed_date.toISOString().split('T')[0] : String(r.jc_billed_date).slice(0, 10);
      const billedDt = r.jc_billed_datetime instanceof Date ? r.jc_billed_datetime.toISOString().replace('Z','') : r.jc_billed_datetime ? String(r.jc_billed_datetime).replace(' ','T') : null;
      const firstComeback = r.first_comeback_datetime instanceof Date ? r.first_comeback_datetime.toISOString().replace('Z','') : r.first_comeback_datetime ? String(r.first_comeback_datetime).replace(' ','T') : null;
      const rawName = r.technician_name as string;
      return {
        jc_billed_date: billedDate, jc_billed_datetime: billedDt,
        intrip: Number(r.intrip), reg_number: r.reg_number as string, bike_model: r.bike_model as string,
        technician_name_raw: rawName, technician_name: nameMap[rawName] ?? rawName,
        hub_name: r.hub_name as string, city: r.city as string,
        is_void: Number(r.rr_count_3d_comeback) > 0, first_comeback_datetime: firstComeback,
        week_start: getWeekStart(new Date(billedDate)),
      };
    });

    const BATCH = 500;
    let upserted = 0;
    for (let i = 0; i < jcLogRows.length; i += BATCH) {
      const { error } = await supabase.from('incentive_jc_log').upsert(jcLogRows.slice(i, i+BATCH), { onConflict: 'jc_billed_datetime,technician_name,reg_number', ignoreDuplicates: false });
      if (error) throw new Error(`jc_log upsert: ${error.message}`);
      upserted += Math.min(BATCH, jcLogRows.length - i);
    }

    const affectedWeeks = [...new Set(jcLogRows.map((r) => r.week_start))];
    for (const week of affectedWeeks) {
      const { data: weekRows, error: weekErr } = await supabase.from('incentive_jc_log').select('technician_name,hub_name,city,intrip,is_void').eq('week_start', week);
      if (weekErr) throw new Error(`weekly fetch: ${weekErr.message}`);
      const byTech: Record<string, {hub_name:string;city:string;intrip:number;submission:number;voided_intrip:number;voided_submission:number}> = {};
      for (const row of weekRows ?? []) {
        const t = row.technician_name;
        if (!byTech[t]) byTech[t] = {hub_name:row.hub_name??'',city:row.city??'',intrip:0,submission:0,voided_intrip:0,voided_submission:0};
        if (row.is_void) { if (row.intrip===1) byTech[t].voided_intrip++; else byTech[t].voided_submission++; }
        else { if (row.intrip===1) byTech[t].intrip++; else byTech[t].submission++; }
      }
      const statsRows = Object.entries(byTech).map(([tech, s]) => {
        const eligible = s.intrip+s.submission, voided = s.voided_intrip+s.voided_submission;
        return { tech_name:tech, week_start:week, total_jcs:eligible+voided, intrip_jcs:s.intrip, submission_jcs:s.submission, voided_jcs:voided, eligible_jcs:eligible, payout_amount:calcPayout(eligible), intrip_void_rate:(s.intrip+s.voided_intrip)>0?s.voided_intrip/(s.intrip+s.voided_intrip):0, submission_void_rate:(s.submission+s.voided_submission)>0?s.voided_submission/(s.submission+s.voided_submission):0, hub_name:s.hub_name, city:s.city };
      });
      if (statsRows.length > 0) {
        const { error: delErr } = await supabase.from('incentive_weekly_stats').delete().eq('week_start', week);
        if (delErr) throw new Error(`weekly_stats delete: ${delErr.message}`);
        const { error: insErr } = await supabase.from('incentive_weekly_stats').insert(statsRows);
        if (insErr) throw new Error(`weekly_stats insert: ${insErr.message}`);
      }
    }

    await sql.end();
    return new Response(JSON.stringify({ok:true,rows_fetched:rows.length,rows_upserted:upserted,weeks_updated:affectedWeeks.length,weeks:affectedWeeks,since,name_mappings_applied:Object.keys(nameMap).length}), {headers:{...CORS,'Content-Type':'application/json'}});
  } catch (err) {
    await sql.end().catch(()=>{});
    console.error('[sync-incentive] ERROR:', err);
    return new Response(JSON.stringify({ok:false,error:String(err)}), {status:500,headers:{...CORS,'Content-Type':'application/json'}});
  }
});
