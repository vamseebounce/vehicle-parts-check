// archive-location-partition — Session 11 / Task 2.7
//
// Called by pg_cron via schedule_partition_archival() when a location partition
// is >90 days old. Reads all rows, writes Arrow IPC to Supabase Storage, then
// drops the partition.
//
// Arrow IPC (.arrow) is columnar and ML-ready:
//   pandas : pd.read_feather('path.arrow')
//   DuckDB : SELECT * FROM 'path.arrow'
//   polars : pl.read_ipc('path.arrow')
//   → Parquet: COPY (SELECT * FROM 'path.arrow') TO 'out.parquet' (FORMAT PARQUET)
//
// Required edge fn secrets (set in Supabase dashboard → Edge Functions → Secrets):
//   SUPABASE_URL              — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
//   ARCHIVE_CRON_SECRET       — shared secret for cron auth (set manually)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { tableFromArrays, tableToIPC } from "npm:apache-arrow@14";

const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ARCHIVE_SECRET          = Deno.env.get("ARCHIVE_CRON_SECRET") ?? "";
const ARCHIVE_BUCKET          = "location-archives";
const PAGE_SIZE               = 1000;

const ALLOWED_TABLES = new Set(["rsa_ticket_locations", "rsa_team_locations"]);

serve(async (req: Request) => {
  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const secret = req.headers.get("x-archive-secret") ?? "";
    if (!ARCHIVE_SECRET || secret !== ARCHIVE_SECRET) {
      console.warn("[archive] Rejected — bad secret");
      return new Response("Unauthorized", { status: 401 });
    }

    const { table, partition } = await req.json() as { table: string; partition: string };

    if (!ALLOWED_TABLES.has(table)) {
      return new Response(`Invalid table: ${table}`, { status: 400 });
    }
    if (!/^[a-z_]+_\d{4}_\d{2}$/.test(partition)) {
      return new Response(`Invalid partition name: ${partition}`, { status: 400 });
    }

    console.log(`[archive] Starting: ${partition}`);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ── Build date range from partition name ──────────────────────────────────
    const [, year, month] = partition.match(/_(\d{4})_(\d{2})$/)!;
    const rangeStart = `${year}-${month}-01T00:00:00Z`;
    const rangeEnd   = new Date(parseInt(year), parseInt(month), 1).toISOString();

    // ── Fetch rows (paginated) ────────────────────────────────────────────────
    const allRows: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from(table)
        .select("*")
        .gte("synced_at", rangeStart)
        .lt("synced_at", rangeEnd)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw new Error(`Query error: ${error.message}`);
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    console.log(`[archive] ${partition}: ${allRows.length} rows`);

    if (allRows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, rows: 0, note: "empty partition — skipping" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Build Arrow IPC ───────────────────────────────────────────────────────
    // Skip geography column — lat/lng already capture the spatial data
    const keys = Object.keys(allRows[0]).filter((k) => k !== "location");
    const cols: Record<string, unknown[]> = {};
    for (const k of keys) {
      cols[k] = allRows.map((r) => r[k] ?? null);
    }
    const arrowTable = tableFromArrays(cols);
    const ipcBytes   = tableToIPC(arrowTable, "file");

    // ── Ensure bucket exists ─────────────────────────────────────────────────
    const { error: bucketErr } = await sb.storage.createBucket(ARCHIVE_BUCKET, {
      public: false,
      allowedMimeTypes: ["application/vnd.apache.arrow.file"],
    });
    // Ignore "already exists"
    if (bucketErr && !bucketErr.message.toLowerCase().includes("already exist")) {
      throw new Error(`Bucket error: ${bucketErr.message}`);
    }

    // ── Upload ───────────────────────────────────────────────────────────────
    const storagePath = `${table}/${year}_${month}.arrow`;
    const { error: uploadErr } = await sb.storage
      .from(ARCHIVE_BUCKET)
      .upload(storagePath, ipcBytes, {
        contentType: "application/vnd.apache.arrow.file",
        upsert: true,
      });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);
    console.log(`[archive] Uploaded: ${storagePath} (${ipcBytes.byteLength} bytes)`);

    // ── Log archive ───────────────────────────────────────────────────────────
    await sb.from("partition_archive_log").insert({
      table_name:     table,
      partition_name: partition,
      row_count:      allRows.length,
      file_bytes:     ipcBytes.byteLength,
      storage_path:   storagePath,
    });

    // ── Drop partition via SECURITY DEFINER RPC ───────────────────────────────
    const { error: dropErr } = await sb.rpc("drop_location_partition", {
      p_partition_name: partition,
    });
    if (dropErr) {
      console.error(`[archive] Drop failed for ${partition}: ${dropErr.message}`);
      // Return 207 — archive succeeded but cleanup failed (manual drop needed)
      return new Response(
        JSON.stringify({
          success:      false,
          archived:     true,
          rows:         allRows.length,
          path:         storagePath,
          drop_error:   dropErr.message,
          action_needed: `Run: DROP TABLE ${partition};`,
        }),
        { status: 207, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[archive] Dropped partition: ${partition}`);
    return new Response(
      JSON.stringify({ success: true, partition, rows: allRows.length, path: storagePath }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[archive-location-partition] Fatal:", err);
    return new Response(String(err), { status: 500 });
  }
});
