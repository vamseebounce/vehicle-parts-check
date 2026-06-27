import { createClient } from 'jsr:@supabase/supabase-js@2';

// v16 — dedup fix (timestamp(0)), freeze completed weeks (Thursday +10d), SQL rebuild, alias-priority name fix

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SYNC_SECRET = Deno.env.get('SYNC_SECRET');

const METABASE_BASE = 'https://metabaselatest-dy7gqwqrma-el.a.run.app';
const CARD_UUID = '9a4c0477-92b1-450d-93b2-6b4ccd1e3473';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function getWeekStart(dateStr: string): string {
  const dt = new Date(dateStr);
  const day = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() - (day === 0 ? 6 : day - 1));
  return dt.toISOString().split('T')[0];
}

/**
 * Normalize a JC name (Layer 1 → Layer 2):
 * - Trim outer whitespace
 * - Collapse multiple spaces to one
 * - Standardize hub separator: any spaces+dash+spaces → " - "
 * e.g. "PRITAM -   OKHLA" → "PRITAM - OKHLA"
 *      "AMAN SHARMA-HSR LAYOUT" → "AMAN SHARMA - HSR LAYOUT"
 */
function normalizeJcName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')                       // collapse spaces
    .replace(/\s*-\s*/g, ' - ')                 // standardize dash spacing
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (SYNC_SECRET) {
    const auth = req.headers.get('Authorization') ?? '';
    if (auth.replace('Bearer ', '') !== SYNC_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // 1. Fetch from Metabase public API — /query/json has no 2000-row API cap
    console.log(`[sync-incentive v16] Fetching from Metabase card ${CARD_UUID}`);
    const mbRes = await fetch(`${METABASE_BASE}/api/public/card/${CARD_UUID}/query/json`);
    if (!mbRes.ok) throw new Error(`Metabase fetch failed: ${mbRes.status}`);
    // /query/json returns a flat array of row objects: [{col: val, ...}, ...]
    const parsed = await mbRes.json();
    if (!Array.isArray(parsed)) {
      throw new Error(`Metabase /query/json returned non-array: ${JSON.stringify(parsed).slice(0, 300)}`);
    }
    const rawRows: Record<string, unknown>[] = parsed;
    console.log(`[sync-incentive v16] Metabase returned ${rawRows.length} rows`);

    const col = (row: Record<string, unknown>, name: string) => row[name];

    // 2. Load jc_name_aliases: normalized JC name → employee_id
    const { data: aliases } = await supabase
      .from('jc_name_aliases')
      .select('technician_name, employee_id');

    const aliasMap: Record<string, string> = {};
    for (const a of aliases ?? []) {
      aliasMap[a.technician_name] = a.employee_id;
    }
    console.log(`[sync-incentive v16] Loaded ${Object.keys(aliasMap).length} aliases`);

    // 3. Load legacy name mappings from incentive_technicians (raw → normalized display name)
    // This handles the old mapping system — will be phased out as aliases take over
    const { data: techDir } = await supabase
      .from('incentive_technicians')
      .select('name_normalized, name_in_system')
      .not('name_in_system', 'is', null);

    const legacyNameMap: Record<string, string> = {};
    for (const t of techDir ?? []) {
      const jcNames: string[] = Array.isArray(t.name_in_system) ? t.name_in_system : [];
      for (const raw of jcNames) {
        if (raw && t.name_normalized && raw !== t.name_normalized) legacyNameMap[raw] = t.name_normalized;
      }
    }
    console.log(`[sync-incentive v16] Loaded ${Object.keys(legacyNameMap).length} legacy name mappings`);

    // 4. Build jc_log rows
    const jcLogRows = rawRows.map((row) => {
      const billedDateRaw = col(row, 'jc_billed_date') as string;
      const billedDate = billedDateRaw?.slice(0, 10) ?? '';

      // jc_billed_datetime column is timestamp(0) — DB truncates subseconds automatically.
      // No need to truncate in JS; pass raw string and let Postgres handle precision.
      const billedDt = (col(row, 'jc_billed_datetime') as string | null) ?? null;
      const firstComeback = (col(row, 'first_comeback_datetime') as string | null) ?? null;

      const rawName = (col(row, 'technician_name') as string) ?? '';
      const normalizedName = normalizeJcName(rawName);  // Layer 2
      const isVoid = Number(col(row, 'rr_count_3d_comeback') ?? 0) > 0;

      // Resolve employee_id: alias map keyed by normalized name (Layer 2 → Layer 3)
      const employeeId = aliasMap[normalizedName] ?? null;

      // technician_name display: if alias resolves this name, use normalized (canonical);
      // only fall back to legacyNameMap for names that have NO alias, to avoid wrong name overrides
      const techName = employeeId ? normalizedName : (legacyNameMap[rawName] ?? normalizedName);

      return {
        jc_billed_date: billedDate,
        jc_billed_datetime: billedDt,
        intrip: Number(col(row, 'intrip') ?? 0),
        reg_number: (col(row, 'reg_number') as string) ?? '',
        bike_model: (col(row, 'bike_model') as string) ?? '',
        technician_name_raw: rawName,                  // Layer 1: as-is from Metabase
        technician_name_normalized: normalizedName,    // Layer 2: trimmed, spaces collapsed, dash standardized
        technician_name: techName,                     // display name (legacy map or normalized)
        employee_id: employeeId,                       // Layer 3: resolved via jc_name_aliases
        hub_name: (col(row, 'hub_name') as string) ?? '',
        city: (col(row, 'city') as string) ?? '',
        is_void: isVoid,
        first_comeback_datetime: firstComeback,
        week_start: getWeekStart(billedDate),
      };
    }).filter(r => r.jc_billed_date && r.reg_number);

    // 5. Upsert jc_log
    const BATCH = 500;
    let upserted = 0;
    for (let i = 0; i < jcLogRows.length; i += BATCH) {
      const { error } = await supabase.from('incentive_jc_log').upsert(
        jcLogRows.slice(i, i + BATCH),
        { onConflict: 'jc_billed_datetime,technician_name_raw,reg_number', ignoreDuplicates: false }
      );
      if (error) throw new Error(`jc_log upsert: ${error.message}`);
      upserted += Math.min(BATCH, jcLogRows.length - i);
    }

    // 6. Freeze completed weeks, then rebuild open weeks only
    // Completed = week's Sunday has passed; those rows are locked and never overwritten
    const { error: freezeErr } = await supabase.rpc('freeze_completed_weeks');
    if (freezeErr) throw new Error(`freeze_completed_weeks: ${freezeErr.message}`);
    const { error: rebuildErr } = await supabase.rpc('rebuild_incentive_weekly_stats');
    if (rebuildErr) throw new Error(`weekly_stats rebuild: ${rebuildErr.message}`);

    // 7. Backfill employee_id on all historical rows that now have an alias but no employee_id yet
    //    (handles case where admin adds a new alias between syncs)
    const { error: backfillErr } = await supabase.rpc('backfill_employee_ids');
    if (backfillErr) {
      // Non-fatal — log but don't fail the sync
      console.warn(`[sync-incentive v16] backfill_employee_ids warning: ${backfillErr.message}`);
    }

    const resolvedCount = jcLogRows.filter(r => r.employee_id).length;

    return new Response(JSON.stringify({
      ok: true,
      rows_fetched: rawRows.length,
      rows_upserted: upserted,
      alias_mappings_loaded: Object.keys(aliasMap).length,
      legacy_mappings_loaded: Object.keys(legacyNameMap).length,
      employee_id_resolved: resolvedCount,
      employee_id_unresolved: jcLogRows.length - resolvedCount,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[sync-incentive v16] ERROR:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
