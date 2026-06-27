import { createClient } from 'jsr:@supabase/supabase-js@2';

// Spreadsheet: 1BQLXsYQS2KfFS9MRkQWQMBgUH9kr5TizmhyB4r2hbRU
// Sheet1         → hr_employees  (Employee ID, Candidate Name, Designation, City, Working Location, Contact, Email)
// Nomenclature Map → incentive_technicians (Employee ID, JC Name Raw, Normalized Name, Hub, City, Status, Remarks)
const SHEET_ID = '1BQLXsYQS2KfFS9MRkQWQMBgUH9kr5TizmhyB4r2hbRU';
const HR_SHEET_URL    = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sheet1`;
const NOMEN_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Nomenclature+Map`;

const NOT_A_PERSON = new Set(['FREELANCER', 'VECNOCOM', 'VECMOCON', 'READY ASSET', 'VAMSEE - HEBBALA']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const results: Record<string, unknown> = {};

  // ── 1. HR Sheet → hr_employees ──────────────────────────────────────────────
  try {
    const res = await fetch(HR_SHEET_URL);
    if (!res.ok) throw new Error(`HR sheet fetch failed: ${res.status}`);
    const rows = parseCSV(await res.text());
    if (rows.length < 2) throw new Error('HR sheet: no data rows');

    const header = rows[0].map((h: string) => h.trim().toLowerCase());
    const col = (name: string) => header.findIndex((h: string) => h.includes(name));
    const iEmpId = col('employee id'), iName = col('candidate name');
    const iDesg = col('designation'), iCity = col('city');
    const iHub = col('working location'), iContact = col('contact'), iEmail = col('email');

    if (iEmpId === -1 || iName === -1) throw new Error(`HR sheet: missing columns. Header: ${JSON.stringify(header)}`);

    const employees = rows.slice(1)
      .filter((r: string[]) => r[iEmpId]?.trim() && r[iName]?.trim())
      .map((r: string[]) => ({
        employee_id:   r[iEmpId]?.trim(),
        employee_name: r[iName]?.trim(),
        designation:   r[iDesg]    !== undefined ? r[iDesg]?.trim()    || null : null,
        city:          r[iCity]    !== undefined ? r[iCity]?.trim()    || null : null,
        hub:           r[iHub]     !== undefined ? r[iHub]?.trim()     || null : null,
        contact:       r[iContact] !== undefined ? r[iContact]?.trim() || null : null,
        email:         r[iEmail]   !== undefined ? r[iEmail]?.trim()   || null : null,
        synced_at:     new Date().toISOString(),
      }));

    if (employees.length === 0) throw new Error('HR sheet: no valid rows after filtering');
    const { error } = await supabase.from('hr_employees').upsert(employees, { onConflict: 'employee_id' });
    if (error) throw error;
    results.hr_employees = { success: true, upserted: employees.length };
  } catch (err: unknown) {
    results.hr_employees = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  // ── 2. Nomenclature Map → incentive_technicians ──────────────────────────────
  try {
    const res = await fetch(NOMEN_SHEET_URL);
    if (!res.ok) throw new Error(`Nomenclature sheet fetch failed: ${res.status}`);
    const rows = parseCSV(await res.text());
    if (rows.length < 2) throw new Error('Nomenclature sheet: no data rows');

    const header = rows[0].map((h: string) => h.trim().toLowerCase());
    const col = (name: string) => header.findIndex((h: string) => h.includes(name));
    const iEmpId  = col('employee id');
    const iJcName = col('jc name');
    const iNorm   = col('normalized');
    const iHub    = col('hub');
    const iCity   = col('city');
    const iStatus = col('status');

    if (iJcName === -1) throw new Error(`Nomenclature sheet: missing columns. Header: ${JSON.stringify(header)}`);

    // Filter out "Not a person" rows and empty rows
    const validRows = rows.slice(1).filter((r: string[]) => {
      const jcName = r[iJcName]?.trim();
      const status = r[iStatus]?.trim();
      if (!jcName) return false;
      if (status === 'Not a person') return false;
      if (NOT_A_PERSON.has(jcName.toUpperCase())) return false;
      return true;
    });

    // Group by employee_id — collect all JC raw names per employee
    const byEmpId: Record<string, { jcNames: string[]; norm: string; hub: string; city: string }> = {};
    const noEmpId: Array<{ jcName: string; norm: string; hub: string; city: string }> = [];

    for (const r of validRows) {
      const empId  = iEmpId !== -1 ? r[iEmpId]?.trim()  : '';
      const jcName = r[iJcName]?.trim() || '';
      const norm   = iNorm   !== -1 ? r[iNorm]?.trim()   || '' : '';
      const hub    = iHub    !== -1 ? r[iHub]?.trim()    || '' : '';
      const city   = iCity   !== -1 ? r[iCity]?.trim()   || '' : '';

      if (empId) {
        if (!byEmpId[empId]) byEmpId[empId] = { jcNames: [], norm, hub, city };
        byEmpId[empId].jcNames.push(jcName);
        // Keep the most complete normalized name
        if (norm && !byEmpId[empId].norm) byEmpId[empId].norm = norm;
        if (hub  && !byEmpId[empId].hub)  byEmpId[empId].hub  = hub;
        if (city && !byEmpId[empId].city) byEmpId[empId].city = city;
      } else {
        noEmpId.push({ jcName, norm, hub, city });
      }
    }

    let upsertedMapped = 0, upsertedUnmatched = 0;

    // Upsert mapped rows (have employee_id) — conflict on employee_id
    const mappedRows = Object.entries(byEmpId).map(([empId, d]) => ({
      employee_id:    empId,
      name_in_system: d.jcNames,
      name_normalized: d.norm || null,
      hub_name:       d.hub  || null,
      city:           d.city || null,
      active:         true,
      updated_at:     new Date().toISOString(),
    }));

    if (mappedRows.length > 0) {
      const { error } = await supabase
        .from('incentive_technicians')
        .upsert(mappedRows, { onConflict: 'employee_id' });
      if (error) throw new Error(`Mapped upsert failed: ${error.message}`);
      upsertedMapped = mappedRows.length;
    }

    // Unmatched rows (no employee_id) — upsert by checking name_in_system[0]
    for (const row of noEmpId) {
      // Check if already exists by jc_name match in name_in_system
      const { data: existing } = await supabase
        .from('incentive_technicians')
        .select('id')
        .contains('name_in_system', [row.jcName])
        .maybeSingle();

      if (existing) {
        // Update existing
        await supabase.from('incentive_technicians').update({
          name_normalized: row.norm || null,
          hub_name:  row.hub  || null,
          city:      row.city || null,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        // Insert new
        await supabase.from('incentive_technicians').insert({
          employee_id:    null,
          name_in_system: [row.jcName],
          name_normalized: row.norm || null,
          hub_name:  row.hub  || null,
          city:      row.city || null,
          active:    true,
          updated_at: new Date().toISOString(),
        });
      }
      upsertedUnmatched++;
    }

    results.incentive_technicians = {
      success: true,
      upserted_mapped: upsertedMapped,
      upserted_unmatched: upsertedUnmatched,
      skipped_not_a_person: rows.length - 1 - validRows.length,
    };
  } catch (err: unknown) {
    results.incentive_technicians = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  return new Response(
    JSON.stringify({ ...results, synced_at: new Date().toISOString() }),
    { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
  );
});

// Minimal CSV parser — handles quoted fields with commas/newlines
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cells.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}
