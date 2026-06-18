# Trace & Hunter — Context File
**Created:** June 17, 2026 | **Last updated:** June 18, 2026

---

## What Is This Project

**Trace & Hunter** is the system/tech layer for Bounce's FPI (vehicle recovery) team operations.

Currently the recovery process is manual, WhatsApp-coordinated, and has zero real-time visibility. This project replaces that with a structured, map-based operations dashboard built inside FleetPro.

**Build target:** FleetPro (bounceops.online) — Supabase backend, same infra as RSA tracking.

---

## Business Context

- Customer doesn't recharge beyond 24 hrs → vehicle **marked for recovery**
- Till 24hr mark → CC team follows up for renewal (not FPI's job)
- Once marked → **FPI ground team (Hunters)** takes over

### Current Process (to be replaced)
1. Evening → team downloads list, calls customers to inform pickup coming
2. Next morning → manually creates KML files, assigns to 4–5 agents via WhatsApp
3. Agents visit, locate 2–3 vehicles, book Porter/leased vehicle, move to nearest hub
4. Status: Marked for Recovery → Recovered
5. **Zero real-time visibility** — 100% WhatsApp coordination

---

## Recovery Status Flow

```
Marked for Recovery
  → FPI Assigned (auto-clustered into zone at 6 PM daily)
  → Hunter calls customer (outcome: Informed / No response)
     → If cool-off eligible + first call → 2hr cool-off starts (one time only per ticket)
     → Cool-off shows countdown: "Called · Cooling off (1h 45m left)"
     → After cool-off expires → Hunter proceeds to visit
  → Hunter En Route
  → Mark Found  [PHOTO: vehicle condition/state proof]     ← GREEN starts here
                 Internal to Trace & Hunter only — no write to bike_operations_log
  → In Transit  [PHOTO: vehicle loaded on porter proof]    ← GREEN
                 Internal to Trace & Hunter only — NO write to bike_operations_log
                 (DECISION 2026-06-18 — overrides the earlier "writes recovered" spec)
  → At Hub      Hub creates JC                             ← GREEN (done)
                 Hub writes bike_operations_log: new_vehicle_status = 'oos' (existing flow)
  → Damage Assessment (out of scope for FPI team)

  ↳ Cancelled (any stage)  — customer_renewed / ops_intervention
```

> Porter Booked — phase 2, out of scope for now (sits between In Transit and At Hub)

---

## Cool-off Rule

- **Hunter-initiated** — hunter calls rider, rider says "I'll pay and renew", hunter manually taps "Grant cool-off" in the app
- **One time only per ticket** — button disappears after used; no second chance
- Duration: **2 hours** from tap time
- `cooloff_expires_at` set on ticket; UI shows countdown: "Called · Cooling off (1h 45m left)"
- After expiry → hunter proceeds to visit

### Visibility on vehicle card (before calling)
Hunter sees cool-off status on the card **before** making the call:
- **"Cool-off available"** — not yet used, rider can be granted one
- **"Cooling off — Xh Ym left"** — cool-off active, do not visit yet
- **"Cool-off used"** — already granted once, no more chances; visit now
- **No indicator** — cool-off never triggered

---

## bike_operations_log — State Mapping

Source of truth for opening and closing recovery tickets.

### Possible statuses after `marked for recovery`
(confirmed via `SELECT DISTINCT new_vehicle_status FROM bike_operations_log WHERE previous_vehicle_status = 'marked for recovery'`)

| `new_vehicle_status` | What happened | Ticket action |
|---|---|---|
| `active` | Customer paid / renewed | Cancel ticket → reason: `customer_renewed` |
| `recovered` | Hunter loaded vehicle on porter | Update ticket → `in_transit` |
| `oos` | Manually moved to hub (ops intervention) | Close ticket → `at_hub` (skips mark_found/in_transit) |
| `marked for recovery` | Re-marked (edge case) | Ignore — ticket already open |

### Full journey example (bike DL9SCU8981)
```
OOS → active                 (DMS automatic)      ← bike available
active → marked for recovery (cron job)            ← TICKET OPENS
marked for recovery → recovered (hunter/Amit)      ← in_transit written
recovered → OOS              (hub staff/Saurabh)   ← at_hub written
OOS → active                 (DMS automatic)       ← next cycle
```

> **DECISION 2026-06-18:** BOTH Mark Found AND In Transit are **internal to Trace & Hunter only** — neither writes `bike_operations_log`. (The table row above documents how Q2 reconciliation interprets a `recovered` row IF one appears from another system; the Hunter app itself no longer writes it.) Do not add an ops_log write to the Hunter app.

---

## Edge Function Architecture (Ticket Lifecycle)

Two mechanisms — no Supabase table triggers needed:

### Step 1 — New ticket creation (every 5 mins)
- Edge function polls Q1 directly against Supabase
- Finds bikes where latest ops_log entry = `marked for recovery` AND no open `recovery_tickets` row exists
- Filters out bikes in `recovery_blocked_vehicles` (active rows)
- Creates new `recovery_tickets` row with `source_ops_log_id` as unique anchor

### Step 2 — Open ticket reconciliation (every 5 mins, same run)
- For all open tickets, LATERAL join gets next ops_log entry after `source_ops_log_id`
- `id > source_ops_log_id ORDER BY id ASC LIMIT 1` — always immediate next record
- Applies state mapping → updates or cancels ticket
- **Special case — en_route + customer renews:** if Q2 detects `active` on an `en_route` ticket, fire push notification immediately to that hunter before next cycle. Hunter is physically driving — 5-min lag is not acceptable here.

**5-min lag is acceptable for all other transitions** — hunter sees updates within one cycle.

### Hub suggestion (at Mark Found — not a cron)
- Called when hunter taps Mark Found
- Haversine in edge function code against `hubs` view
- No Metabase query needed

### Hunter vehicle list (not a cron)
- Supabase query on `recovery_tickets` + `bike` tables directly
- Haversine distance in Postgres, sorted nearest-first
- Phase 1: hunter's assigned bike GPS as reference point
- Phase 2: phone GPS passed from PWA as reference point (fallback: bike GPS)

---

## 6 PM Daily Sequence

```
Step 0 → Sync recovery_blocked_vehicles from Google Sheet
Step 1 → Zone clustering per city (Voronoi, uses updated blocked list)
Step 2 → Edge function 5-min cycle begins
```

Hunters stop work at ~6 PM. New zone assignments apply to the new day's list. Open tickets carry forward with their existing `assigned_hunter_id`.

---

## Metabase Queries (2 total — validation only)

**Edge function runs its own SQL directly on Supabase — Metabase queries are for validation/ops visibility only.**

### Q1 — New Ticket Detection
**File:** `recovery_source_query.sql`
**Metabase ID:** `8ef20d85-0485-4e85-b25a-9d7c96279d8e`
**Public link:** http://metabaselatest-dy7gqwqrma-el.a.run.app/public/question/8ef20d85-0485-4e85-b25a-9d7c96279d8e

Fields added to original Metabase query:
- `source_ops_log_id` — unique ticket anchor
- `marked_at_ist` — full IST timestamp for display
- `hours_in_recovery` — computed from UTC for color coding
- `baas_lat`, `baas_long`, `baas_location_time` — bike GPS

### Q2 — Open Ticket Reconciliation
**File:** `recovery_reconciliation_query.sql`
**Metabase ID:** `67f2823d-e46c-49c0-90c1-51c8bc9e8340`
**Public link:** http://metabaselatest-dy7gqwqrma-el.a.run.app/public/question/67f2823d-e46c-49c0-90c1-51c8bc9e8340

> Returns "invalid-query" until `recovery_tickets` table is created in FleetPro build.

---

## Zone System

- City split into **4 zones per city: NE, NW, SE, SW**
- **Clustering runs independently per city** (NCR, Bangalore, Hyderabad — city IDs 1, 2, 5)
- Zones dynamically generated at 6 PM daily based on that city's vehicle locations
- **Time window:** 6 PM → 6 PM next day
- New vehicles added mid-window → auto-assigned to nearest Voronoi cell; `is_base_list = false`
- Real-time additions: pulsing pin on map
- **Filter:** All / Base list only / Added today

---

## Zone Clustering Algorithm (runs at 6 PM daily, per city)

1. **Filter** — exclude blocked vehicles (`recovery_blocked_vehicles`)
2. **Dynamic center** — centroid of all that city's recovery vehicles
3. **Active hunter count** — check roster for that city; k = active hunters
4. **Balanced k-means** — equal vehicle count per cluster
5. **Label clusters** — centroid vs dynamic center → NE/NW/SE/SW
6. **Voronoi tessellation** — MECE boundaries, any shape
7. **Store** — GeoJSON in `zone_configs` per city
8. **Real-time additions** — assigned to Voronoi cell; `is_base_list = false`

---

## Color Coding (Vehicle Pins on Map)

`hours_in_recovery` used for accurate coloring (not `age_days`):

| Color | Age | Meaning |
|---|---|---|
| Amber | 0–1 days | Just entered recovery |
| Coral | 1–2 days | Overdue |
| Orange | 2–3 days | Urgent |
| Red | 3+ days | Critical |
| Green | — | Recovered (Mark Found → In Transit → At Hub) |

**Call status ring around pin:**
- Blue ring = Called + informed
- Grey ring = Called + no response
- No ring = Not called yet
- Dotted ring = Manually reassigned

**Newly added vehicles** → pulsing animation

---

## Bike GPS

Two GPS sources on `bike` table. Use whichever has the **most recent timestamp**:

| Column set | Provider | Timestamp |
|---|---|---|
| `baas_lat`, `baas_long` | BaaS (primary) | `baas_location_time` |
| `current_lat`, `current_long` | IoT/Intellicar (fallback) | `latlong_updated_time` |

Logic: compare `baas_location_time` vs `latlong_updated_time` → use the more recent pair. If both NULL → bike shows as "Location unknown" in a separate list on HO Dashboard (not on map).

---

## Two Views

### 1. HO Dashboard (Desktop)
- Live stats bar: total pending, recovered today, calls made, agents active
- Zone summary cards per city (hunter name, vehicle count, recovered count)
- Map: all zones + color-coded vehicle pins + hunter live location dots
- "Location unknown" list — bikes with no GPS from either source (visibility only; admin fixes GPS via telemetry portal / central dashboard — no action in Trace & Hunter)
- Vehicle list panel: sortable by urgency, filterable by zone + base/added toggle
- Live override panel (Admin): drag vehicle from one hunter to another

### 2. Hunter View (Mobile — PWA)
- **Platform:** Progressive Web App (PWA) — installable Android/iOS, works offline
- Their zone only (map + list)
- Stats: assigned / called / recovered
- Banner + push notification when new vehicle added to their zone mid-day
- **Vehicle list sorted by nearest distance** (Haversine, re-sorts as hunter moves)
  - Phase 1: uses assigned bike GPS
  - Phase 2: uses phone GPS (browser geolocation) primary; fallback to assigned bike GPS if permission denied
- Vehicle cards: Bike ID, age bucket, last known address, **GPS age** ("Location updated Xh ago"), Call / Navigate / Mark Found / In Transit / Deprioritize
  - **Navigate** automatically sets ticket status to `en_route`
  - **Deprioritize** — flags ticket as low-priority; vehicle sinks to bottom of sorted list; ticket stays open; HO can see deprioritized count per hunter
- **Mark Found:** photo of vehicle condition required
- **In Transit:** photo of vehicle loaded on porter required
- Recovered vehicles collapse to confirmation line

---

## Hunter Roster System

- **Mon–Sun matrix**: Hunter 1–5 × 7 days → zone(s), Leave, or Weekoff
- `roster_template` — default weekly pattern
- `roster_overrides` — today/week overrides (logged with changed_by, reason)

### Bulk Reassign (when hunter is absent)
1. Admin marks absent hunter as Leave in roster overrides
2. Admin assigns the covering hunter to both zones (their own + absent hunter's)
3. Admin clicks **"Reassign"** — all open tickets from absent hunter transfer to covering hunter
4. Covering hunter sees both zones in their PWA
5. Zone boundaries unchanged — no re-clustering

---

## Role Permissions

| Role | Access |
|---|---|
| **Hunter** | Own zone map + list, Call, Navigate, Mark Found, In Transit |
| **Admin** | Roster editor, live override panel (drag reassign), daily ops |
| **Super admin** | System config, Re-cluster now + all admin access |

**Re-cluster now** (Super admin only) — reshapes all zone boundaries mid-day.
**Zone shapes locked at 6 PM** — reassigned vehicles show dotted ring, zones don't reshape.
**Config changes** take effect at next 6 PM run.

---

## System Config (Super Admin)

Stored in existing `app_settings` table — no new table needed.

| Setting | Default |
|---|---|
| Cluster trigger time | 6:00 PM |
| Amber threshold | 0–1 days |
| Coral threshold | 1–2 days |
| Orange threshold | 2–3 days |
| Red threshold | 3+ days |
| Balancing weight | Equal vehicle count |
| Force k=4 | Off (k = active hunter count) |

---

## Data Model

**`recovery_tickets`** — one row per vehicle per recovery episode
- `id` uuid PK
- `bike_id` + `source_ops_log_id` — **unique together**
  - `source_ops_log_id` = `bike_operations_log.id` of the `marked for recovery` row
- `user_id` uuid (from latest booking at ticket creation time)
- `marked_at_utc` timestamptz — stored as UTC, displayed as IST in UI
- `zone` (NE/NW/SE/SW), `city_id`, `assigned_hunter_id`
- `status` enum: `marked → assigned → called → en_route → mark_found → in_transit → at_hub → cancelled`
- `cancel_reason` text — `customer_renewed` / `ops_intervention` / etc.
- `call_status`: none / informed / no_response
- `is_deprioritized` boolean (default false) — hunter-flagged, sinks to bottom of list
- `deprioritized_at` timestamptz (nullable)
- `cooloff_expires_at` timestamptz (nullable)
- `called_at`, `mark_found_at`, `in_transit_at`, `at_hub_at`, `cancelled_at`
- `mark_found_photo_url` text (required at Mark Found)
- `in_transit_photo_url` text (required at In Transit)
- `hub_id` (set live at Mark Found via Haversine)
- `is_base_list` boolean
- `added_at`
- `notes`
- Denormalised from Q1 (static at creation): `reg_number`, `model_name`, `speed_segment`, `city_name`, `plan_type`, `last_user_name`, `last_user_phone`, `referred_count`
- GPS **not** denormalized — always read live from `bike` table

**`recovery_ticket_events`** — event log (mirrors `ticket_events`)
- `ticket_id`, `event_type`, `created_at`, `created_by`, `metadata` (JSONB)
- Event types: `called`, `cool_off_start`, `cool_off_end`, `en_route`, `mark_found`, `in_transit`, `at_hub`, `cancelled`, `note`, `reassigned`, `deprioritized`

**`zone_configs`** — daily clustering output
- `date`, `city_id`, `zone_label`, `hunter_id`
- `centroid_lat`, `centroid_lng`, `dynamic_center_lat`, `dynamic_center_lng`
- `boundary_polygon` (GeoJSON — nulled after 90 days)
- `vehicle_count`

**`roster_template`** — `hunter_id`, `day_of_week`, `default_zones[]`

**`roster_overrides`** — `hunter_id`, `date`, `zones[]`, `status`, `override_reason`, `changed_by`, `changed_at`

**`recovery_blocked_vehicles`** — police station / impounded exclusions
- `id` uuid PK, `reg_number` text UNIQUE
- `police_station` text, `city` text
- `synced_at` timestamptz (last Google Sheet sync)

> GPS always read live from `bike` table (`baas_lat/lng` or `current_lat/lng` — whichever timestamp is newer).

---

## FleetPro Base Tables (Reuse)

| Table | Reuse For |
|---|---|
| `bike_location_cache` | Bike lat/lng — already synced |
| `bike_rider_cache` | Rider name + phone |
| `app_settings` | Super admin config key/value store |
| `ticket_events` | Pattern → mirror as `recovery_ticket_events` |
| `rsa_tickets_cache` | Pattern → mirror as `recovery_tickets` |
| `hubs` view | Nearest hub Haversine at Mark Found |

---

## Blocked Vehicles (Police Station / Impounded)

**Source:** [Google Sheet](https://docs.google.com/spreadsheets/d/1btPXx08qDyQSOTWWZHEWHgTQuo1CC2pcL4s10Ndj6J4) — columns: `Vehicle no`, `police station`, `city`

**Sync:** Step 0 of 6 PM job — full replace (blindly sync sheet → table, no audit trail needed).
**Failure handling:** Only replace table if Google Sheet fetch succeeds. If API call fails → keep existing table as-is, log error, proceed to Step 1 with stale-but-safe data.

Q1 edge function filters out any `reg_number` present in `recovery_blocked_vehicles`.

---

## Data Retention Policy

| Data | Retention |
|---|---|
| `recovery_tickets` + events | Forever |
| `roster_template` + `roster_overrides` | Forever |
| `zone_configs` boundary polygon | 90 days → nulled; centroid kept forever |
| `zone_configs` metadata | Forever |

---

## Tech Stack

| Component | Tech |
|---|---|
| Frontend (HO) | FleetPro (bounceops.online) |
| Frontend (Hunter) | PWA — installable Android/iOS |
| Backend | Supabase (clkfvmmlgwcvntxnolsv, Tokyo) |
| Ticket sync | Edge Function, 5-min cron |
| Blocked vehicles sync | Edge Function, 6 PM, Google Sheets API |
| Hunter list / distances | Supabase Postgres Haversine inline |
| Hub suggestion | Edge Function at Mark Found tap |
| Zone clustering | Edge Function at 6 PM per city |
| Build window | FleetPro - 5 |

---

## Key Metrics (HO Dashboard)

- Total pending by zone / city
- Recovered today vs pending
- Avg time: marked → recovered (by zone / hunter / week)
- Call completion rate
- Hunter productivity (recoveries per day)
- Damage fee exposure cleared

---

## Reference Numbers

- Recovery part cost March 2026: ₹7.99L (▲20% MoM)
- Damage fee charged: ₹12.98L | Collected: ₹0.23L → **1.8% collection rate**

---

## Phased Feature List

### Phase 1 — Core Ops (Build first)
- [ ] `recovery_tickets` + `recovery_ticket_events` table migrations
- [ ] `recovery_blocked_vehicles` table + 6 PM Google Sheet sync
- [ ] Q1 edge function (5-min cron) — new ticket creation
- [ ] Q2 edge function (5-min cron) — open ticket reconciliation
- [ ] Zone clustering per city at 6 PM (k-means + Voronoi)
- [ ] Auto zone + hunter assignment from roster
- [ ] Hunter PWA: map view, vehicle list (sorted by distance), Call, Navigate
- [ ] Hunter PWA: Mark Found (photo required)
- [ ] Hunter PWA: In Transit (photo required, writes ops_log)
- [ ] HO Dashboard: map with color-coded pins, zone cards, stats bar
- [ ] HO Dashboard: "Location unknown" list for no-GPS bikes
- [ ] GPS fallback logic (baas → current, pick latest timestamp)
- [ ] GPS staleness indicator on vehicle card ("Location updated Xh ago")

### Phase 2 — Ops Quality
- [ ] Admin live override panel (drag-reassign vehicles between hunters)
- [ ] Roster system UI (Mon–Sun matrix, template + overrides)
- [ ] Bulk reassign — roster override → "Reassign" button transfers all tickets to covering hunter
- [ ] Cool-off mechanism (hunter-initiated, 2hr, one-time per ticket)
- [ ] Deprioritize vehicle — hunter flags ticket, sinks to bottom of list, HO visibility
- [ ] Instant push to hunter when customer renews while en_route (Q2 special case)
- [ ] Re-cluster now button (Super admin)
- [ ] PWA push notifications (new vehicle added mid-day)
- [ ] Newly added vehicle pulsing animation on map
- [ ] Base list / Added today filter

### Phase 3 — Intelligence
- [ ] Porter booking (in-system, replaces WhatsApp)
- [ ] Key metrics dashboard (avg recovery time, hunter productivity)
- [ ] Call attempts tracking (`call_attempts` count + `last_called_at`)
- [ ] Damage fee exposure tracking
- [ ] Historical zone performance analytics
- [ ] Zone config history viewer

---

## Open Items

- **Backfill resolved** — All bikes currently in `marked for recovery` status are shown every day, regardless of age. Blocked vehicles (police station list) excluded. No cutoff date. Old unresolved cases stay in the queue until recovered or status changes.

---

## As-Built Addendum (2026-06-18 — supersedes spec where they conflict)

> This section records how Phase 1 was actually built/decided. Where it conflicts with the spec above, **this wins**. Code is pushed to GitHub; **Supabase deploy is still pending** (see CLAUDE.md "Build Status" for the exact deploy checklist).

**Decisions that override the spec**
- **In Transit & Mark Found are internal state only** — Trace & Hunter never writes `bike_operations_log`.
- **HO dashboard (`trace-ho.html`) is a full clone of RSA Warroom (`rsa.html`)** — same shell/components/interactions. The earlier city-tabs + zone-card-sidebar design is replaced by RSA's single full-screen-map layout (global bar → tiles → map-filter row → map; Track + Layers panels).

**Architecture (Micro-RAM driven — push work to edge fns, minimise DB RAM)**
- New table **`recovery_tickets_cache`** = denormalised snapshot of open + today-recovered tickets with GPS pre-joined. The `recovery-ticket-sync` edge fn rebuilds it every 5 min (delete+reinsert). The HO dashboard reads ONLY this table (one query) — no client-side join over `bike_location_cache`.
- New table **`hunter_locations`** (+ `hunter_locations_latest` view, 7-day retention) — Hunter PWA writes throttled (~45s) breadcrumbs; HO shows live agent dots + Track trail.
- **GPS rule still honored:** the cache is an explicit refreshed snapshot, not the ticket source of truth — tickets still carry no stored GPS.

**Correctness fixes worth knowing**
- All timestamp parsing uses `parseUtcTs()` (handles `+00`/`+05:30`/`Z`) — raw `new Date('…+00')` returns `NaN` on Safari/iOS and broke ages on iPhones.
- `marked_at_utc`: Q1 query now emits the true UTC column; edge fn also converts an IST-only fallback → UTC (never stores IST raw).
- `recovery_tickets` UPDATE is RLS-restricted to owner-or-superadmin (Phase 2 admin drag-reassign will need a broader policy).
- `recovery-photos` storage bucket created (Mark Found / In Transit proof uploads).

**Migrations added beyond the original two:** `…0004` photo bucket · `…0005` RLS ownership · `…0006` HO cache + hunter_locations.
