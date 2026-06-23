# Manual JC Approval Check — Canonical Context

> **Last updated:** 2026-06-23  
> **Status:** Live — 11k+ vehicles syncing every 5 min. Pending: email notifications + Alert Centre page.

---

## What it does

Lets a superadmin look up any vehicle by reg or chassis number and instantly see:
- Its current JC approval verdict (T0–T6 tier + reason)
- Current booking state
- Hub / location / ODO (from `fw_bikes_live` + `jc_history`)
- OOS queue entry (if in workshop)
- Last 12 JC history entries

Search is triggered by **Enter** or the **magnifier icon** — there is **no Check button** (a dead `search-btn` reference once crashed `runCheck()`; never reintroduce one).

Design language: `maintenance.html` — FleetPro topbar + hamburger, centered search hero, random "Try:" pills, last-synced line, footer.

Access is gated to **superadmin only** (checked client-side via `session.user.app_metadata.is_superadmin`; data is behind Supabase RLS requiring `authenticated` role, never exposed as public Metabase card).

---

## T0–T6 Verdict Waterfall

These are **stable routing keys** — shared across the SQL, the edge fn `ALERT_TIERS` set, and the HTML `TIER_STYLE` map. Touch all three if you ever add/rename a tier.

| Tier | Colour | Label | Meaning |
|------|--------|-------|---------|
| T0 | Slate | No JC found | Vehicle has no draft JC in the system |
| T1 | Red | Booking in progress | Active booking — JC premature |
| T2 | Amber | Prior JC deleted | Previous draft was deleted |
| T3 | Green | Draft already exists | Draft JC already in pipeline |
| T4 | Red | DMS push failed | JC created but DMS push errored — **alert tier** |
| T5a | Slate | Payment pending | Booking ended but payment not cleared |
| T5b | Amber | Push stuck | JC age > threshold, not pushed — **alert tier** |
| T5c | Blue | Push in flight | DMS push in progress |
| T6 | Purple | Needs manual review | Unclassified / edge case — **alert tier** |

Alert tiers (T4, T5b, T6) are written to `jc_approval_alerts` by the sync; email notification is pending.

---

## Architecture (Security-reviewed)

```
Private Metabase card (c100308c-…)
       ↓  server-side fetch (no browser exposure)
jc-approval-sync edge fn  ←  cron ~every 5 min
       ↓
jc_approval_status table  (delete + reinsert, RLS: authenticated read)
jc_approval_alerts table  (append-only, diff-based, RLS: authenticated read)
       ↓
jc-approval.html  ←  session-authed reads (user's JWT)
```

Second edge fn for JC history:
```
Private Metabase card (a2c3e48b-…)
       ↓
jc-history-sync edge fn  ←  (separate cron, same pattern)
       ↓
jc_history table  (delete + reinsert)
```

The HTML page also reads `fw_bikes_live` (hub/location/SOC) and `oos_work_queue` (current repair entry) in parallel.

---

## Tables

### `jc_approval_status` (PK: `reg_number`)
One row per vehicle. Rebuilt every sync (delete + reinsert).

| Column | Type | Notes |
|--------|------|-------|
| reg_number | text PK | |
| chassis_number | text | indexed |
| latest_draft_jc | text | JC number |
| latest_jc_status | text | |
| jc_created_ist | text | display string from query |
| current_booking_status | text | |
| current_booking_ended_ist | text | |
| jc_trip_ended_ist | text | |
| dms_json | text | `'Blank'` or `'Present'` |
| jc_age_minutes | float8 | |
| rental_status | text | |
| vehicle_status | text | |
| vehicle_sub_status | text | |
| tier | text | T0–T6, indexed |
| verdict | text | |
| reason | text | |
| refreshed_at | timestamptz | |

### `jc_approval_alerts` (append-only)
One row per (draft JC, tier) first-seen. `alerted_at` set once email fires; `resolved_at` set when vehicle leaves the alert tier.

UNIQUE constraint: `(latest_draft_jc, tier)` — prevents duplicate alerts from sync races.

### `jc_history`
JC line-item history (jc_no, reg_number, bike_odo, jc_date, hub_name, service_type, line_type, item_name, qty, amount, technician_name). Rebuilt by `jc-history-sync`.

### `jc_booking_history` (PK: `id`)  — added 2026-06-23, migration `…0623000001`
Last ~90d bookings per vehicle (booking chain, plan renewals). Cols: `reg_number,
bike_id, status, booking_started_at_ist, booking_ended_at_ist, created_for_bike_change,
intrip_dues`. Rebuilt by `jc-context-sync`. Indexed on `reg_number`.

### `jc_ops_log` (PK: `id`)  — added 2026-06-23
`bike_operations_log` status transitions + hub changes (~30d). Cols: `reg_number,
bike_id, previous_vehicle_status, new_vehicle_status, hub_name, performed_by_name,
created_at_ist`. Rebuilt by `jc-context-sync`. Indexed on `reg_number`.

### `jc_jc_status_log` (PK: `id`)  — added 2026-06-23
`job_card_status_log` progression incl. the DMS JC number. Cols: `reg_number,
job_card_id, new_status, technician_name, dmsjcid, remarks, created_at_ist`. Rebuilt by
`jc-context-sync`. Indexed on `reg_number`, `job_card_id`.

> `jc_approval_status` also gained two columns (migration `…0623000001`): **`intrip`**
> (bool — OOS JC vs Running Repair) and **`jc_hub_name`** (text — hub the JC was raised
> at, for the hub-mismatch warning). The approval SQL emits `"Intrip"` + `"JC Hub Name"`;
> `jc-approval-sync` maps them.

---

## Edge Functions

### `jc-approval-sync`
- Fetches Metabase card CSV server-side
- Step 1: Rebuilds `jc_approval_status` (delete + reinsert, 500-row batches)
- Step 2: Diffs `jc_approval_alerts` — inserts new T4/T5b/T6 cases, resolves cleared ones
- Step 3: TODO — email notification on newly-inserted alerts (stamp `alerted_at`)
- Writes heartbeat to `sync_heartbeats`
- Now also maps `intrip` + `jc_hub_name` from the query

### `jc-history-sync`
- Same pattern — fetches separate Metabase card, rebuilds `jc_history`

### jc-context buckets — three SINGLE-table fns (split 2026-06-23 to fix timeout)
The original combined `jc-context-sync` timed out (HTTP 546, ~26.5s) — it processed
all 3 cards sequentially and died before the JC-status-log table. **Split into three
independent fns, one per table.** Old `jc-context-sync` fn + its cron (job 28) are
RETIRED. Each new fn follows the `jc-history-sync` single-table pattern (fetch CSV →
parse → delete-all `.neq("id",0)` → reinsert 500-row batches → heartbeat). Card UUIDs
are **hardcoded per fn** (one card each — simpler than secrets):

| Fn | Card UUID | Table | Heartbeat name | Cron |
|----|-----------|-------|----------------|------|
| `jc-booking-sync`    | `c1efbecd-…` | `jc_booking_history` | `jc-booking-sync`    | `*/15 * * * *` (:00) |
| `jc-ops-sync`        | `98f2dc7c-…` | `jc_ops_log`         | `jc-ops-sync`        | `5,20,35,50 * * * *` (:05) |
| `jc-status-log-sync` | `b1470077-…` | `jc_jc_status_log`   | `jc-status-log-sync` | `10,25,40,55 * * * *` (:10) |

Crons staggered by 5 min so they don't overlap. Card C column header confirmed live:
`id,reg_number,job_card_id,new_status,technician_name,dmsjcid,remarks,created_at_ist`.
Hub names (in the approval SQL, not these fns) resolve via `rental_locations.location_name`
(no `public.hub` table; `hubs` is a VIEW over `rental_locations`).

---

## Frontend: `v8/jc-approval.html`

Key behaviours:
- Auth: `sb.auth.getSession()` → `applyGate()` → superadmin check → show/hide search hero
- Search: `normalizeReg(q)` strips spaces/hyphens/dots, uppercases → `ilike *q*` on both `reg_number` and `chassis_number`; then exact match preferred over fuzzy
- Parallel fetches: `jc_approval_status`, `jc_history` (120 rows), `fw_bikes_live`; then a second parallel batch on the resolved reg: `oos_work_queue`, `jc_booking_history` (8), `jc_ops_log` (10), `jc_jc_status_log` (10)
- Sections rendered (8): Bike (with hub-mismatch warning + JC Hub) → Current Booking → Job Card (with In-Trip/RR flag + JC Hub) → JC History (grouped by jc_no, last 12) → **Booking History** → **Ops Log** → **JC Status Log** → OOS Queue
- Hub mismatch: amber warning in Bike section when `jc_hub_name` ≠ `fw_bikes_live.hub`
- In-Trip flag: `intrip` true → Running Repair (in-trip), false → OOS Job Card
- `TIER_STYLE` map drives chip colour + verdict label — must stay in sync with SQL/edge-fn tier definitions
- "Try:" pills: random 3 vehicles from `jc_approval_status` where `latest_draft_jc not null`
- Last-synced line: latest `refreshed_at` from `jc_approval_status`
- `sw.svg` (magnifier icon): `onclick="runCheck()"` — the ONLY search trigger besides Enter key
- **No `search-btn` element** — do not add one; referencing it crashes `runCheck()`
- Sidebar shows only: OOS Queue (service ops) + Admin section (Technicians, Permissions, JC Approval Check active)

---

## Migration

`supabase/migrations/20260619000001_jc_approval.sql`  
Creates `jc_approval_status`, `jc_approval_alerts`, indexes, and RLS policies (authenticated read, service role write/delete).

---

## Pending Work

1. **Email notifications** — On T4/T5b/T6 newly-inserted alerts: send email to JC team, stamp `alerted_at`. Hook into same transport as RSA/FW alert scripts. The `// TODO(email)` comment is at line ~138 of `jc-approval-sync/index.ts`.

2. **Alert Centre page** — New `v8/alert-centre.html` (or similar). Reads `jc_approval_alerts` (`resolved_at IS NULL` for open, full history). Design language: same maintenance.html shell. Listed as "Coming Soon" in the sidebar (`index.html`).

---

## Do-Not-Violate Decisions

- **Tier codes are stable routing keys** — T0–T6 are used in the SQL query, the edge fn `ALERT_TIERS` set, and the HTML `TIER_STYLE` map. Change all three together or not at all.
- **No `search-btn`** — search is Enter + magnifier icon only. A dead `search-btn` reference once crashed `runCheck()`.
- **Metabase card UUID never in browser** — the card UUID lives in the edge fn only (server-side). The page reads from Supabase tables via the user's session JWT.
- **RLS**: `jc_approval_status` and `jc_approval_alerts` require `authenticated` role to SELECT. Service role bypasses for edge fn writes.

---

## Collaboration (Cowork ↔ Code)

This is the shared source of truth for both **Cowork** (desktop) and **Claude Code**
(terminal). Read it before working; update it after.

1. **FleetPro is its OWN git repo** (`vehicle-parts-check`), gitignored by the outer
   Bounce repo. ⚠️ The mounted `fleetpro/` folder's git is the **outer Bounce repo** and
   does NOT deploy. Editing files there alone is invisible to production — deploy by
   pushing via the `/tmp` clone of `vehicle-parts-check` (see `CLAUDE.md`).
2. **Lock before editing the page**: claim `jc-approval.html` in `LOCKS.md` (owner + UTC
   + note), commit that first. If it's locked by the other window → STOP and wait.
   Release with `(free)` when done.
3. **Edge-fn changes** deploy via MCP; the git push is source-of-record only.
4. **Validate before push**: balanced tags + `node --check` on inline `<script>` blocks.
