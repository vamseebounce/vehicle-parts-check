# FleetPro — Project Memory

Bounce Daily's internal fleet operations hub. Static HTML/JS frontend deployed via GitHub Pages at **bounceops.online**. Backend is Supabase (Postgres + Edge Functions).

## 🔒 Edit Lock Protocol (all windows + Cowork)

Before editing any page/feature, **claim its row in `LOCKS.md`** (owner + UTC timestamp +
note) and commit that change first. If the row is already locked by another window →
**STOP and wait.** Release it (`(free)`) when done. This keeps terminal windows and Cowork
desktop from clobbering each other on the shared folder.

## 📑 Docs map

Every FleetPro doc is indexed in `docs/INDEX.md` — one canonical context file + one
checklist per area. This is the deploy repo (`vehicle-parts-check`); edit & commit here,
push via the `/tmp` clone (see Repo & Deployment below).

## Repo & Deployment

- **Repo**: `vamseebounce/vehicle-parts-check` (main branch → GitHub Pages)
- **Live URL**: `https://bounceops.online/v8/`
- **Supabase project**: `clkfvmmlgwcvntxnolsv`
- **Push workaround**: macOS FUSE lock prevents pushing from the mounted folder. Always clone to `/tmp/fleetpro-push/`, copy changed files, push from there.

```bash
cd /tmp && rm -rf fleetpro-push
git clone https://<PAT>@github.com/vamseebounce/vehicle-parts-check.git fleetpro-push
cp <changed files> /tmp/fleetpro-push/<same paths>
cd /tmp/fleetpro-push
git add . && git commit -m "<msg>" && git push origin main
```

**PAT**: Never commit to any file. Pass inline to clone URL only.

## Tech Stack

- Vanilla HTML/JS/CSS — no build step, no npm
- Supabase JS v2 (`@supabase/supabase-js@2`) loaded from CDN
- Leaflet.js for maps, CARTO `light_nolabels` tiles
- Inter font from Google Fonts
- GitHub Pages for hosting (bounceops.online CNAME)

## File Structure

```
v8/
  index.html          — Home dashboard (tile grid, auth, sidebar)
  maintenance.html    — Preventive Maintenance
  queue.html          — OOS (Out-of-Service) repair queue
  deployment.html     — Deployment Queue
  fw-map.html         — Firmware Pending Map
  rsa.html            — RSA Warroom
  trace-ho.html       — Trace HO Dashboard (FPI Recovery, HO view)
  trace-hunter.html   — Hunter PWA (field agent app)
  trace-hunter-manifest.json — Hunter PWA manifest
  trace-hunter-sw.js  — Hunter service worker
  icon-192.png / icon-512.png — Hunter PWA install icons
  admin-techs.html    — Admin: Manage Technicians
  admin-permissions.html — Admin: Permissions
  logo.jpg            — Bounce logo
```

## Auth Pattern (CRITICAL — do not change)

All pages use Supabase auth. The pattern:

1. Auth screen covers the page (`z-index:9999`) on load
2. `bootPage()` calls `sb.auth.getSession()`
3. If session exists → `activateSession(session)` which:
   - Calls `loadAndApplyPermissions(session)` FIRST
   - If permissions fail → redirect to `index.html`
   - Only then calls `hideAuthScreen()`
4. NO permission veil (`position:fixed;z-index:8000`) — auth screen IS the cover

All pages including `trace-hunter.html` now follow this exact flow (the Hunter PWA previously used a `#perm-veil` + checked permissions after hiding the auth screen — fixed 2026-06-18 to boot permissions-first like the rest).

**Superadmin short-circuit**: `session.user.app_metadata.is_superadmin` → grants all features, bypasses DB queries. Present on every page including `trace-hunter.html`.

**Feature gating**: `user_groups` → `group_features` → `{key:true}` map → `data-feature` attributes on DOM elements.

**Auth bug discipline (mandatory before declaring any auth fix)**:
1. Grep file for every `signOut()` call
2. For each one, trace exact condition and simulate against affected user's state
3. Confirm full session completes without hitting any of them

## Sidebar Layout (index.html)

Sections and their labels:
- **Fleet Tools**: Home
- **Service Operations**: Preventive Maintenance, OOS Queue
- **Hub Operations**: Deployment Queue
- **RSA Operations**: FW Pending Map, RSA Warroom
- **Recovery Operations**: Trace, Hunter ← (data-feature="trace-ho")
- **Admin**: Manage Technicians, Permissions
- **Coming Soon**: Fleet Analytics, Alert Centre

Sidebar never auto-pins. No `@media(min-width:900px)` rule. `localStorage('sb_pinned')` for user preference only.

## Index Tile Layout

Pattern: **2 → 1(full-width) → 2 → 1(full-width)**

1. Preventive Maintenance + Pending OOS Vehicles
2. Deployment Queue (full-width, horizontal layout)
3. FW Pending Map + RSA Warroom
4. Trace (full-width, horizontal layout, same structure as Deployment Queue)

Tile accent bars are 5px top gradient, department-based:
- Fleet Health (PM): `#E8191C → #F97316`
- Workshop (OOS): `#1D4ED8 → #0891B2`
- Deployment: `#7C3AED, #0369A1, #059669`
- Tech/FW: `#0369A1 → #0891B2`
- RSA: `#7C3AED → #A855F7`
- Trace/Recovery: `#F59E0B → #EF4444`

## Tile Stats Data Flow (index.html)

`loadTileStats()` called on login, refreshes every 5 minutes via `setInterval`.

| Tile | Table | Filter | Metric |
|------|-------|--------|--------|
| PM | `vehicle_parts_check_flag` | `check_required=true` | count + overdue/due-soon breakdown |
| OOS | `oos_work_queue` | all | count + hub count + est. time |
| Trace | `recovery_tickets` | `status NOT IN (cancelled, at_hub)` | pending count + critical (72h+) count |

Uses `Prefer: count=exact` + `Range: 0-0` header to get counts without fetching rows.

## Trace & Hunter — Build Status

Full spec in `Trace and Hunter/context.md`.

> **2026-06-18 — work PAUSED here.** Two passes landed in code & pushed to GitHub, but **NOT yet applied/deployed to Supabase**:
> 1. **Bug-fix pass** (commits `6410c87`, `056c837`): 14 Phase-1 fixes — Hunter actions, auth alignment, HO map/stats, Voronoi zones, `marked_at_utc` tz, RLS ownership, `user_id`.
> 2. **RSA-clone rebuild** (commit `1847e69`): `trace-ho.html` rebuilt from `rsa.html` as a faithful clone + a Micro-RAM cache architecture (HO reads one pre-joined `recovery_tickets_cache`; the GPS join moved into the edge fn). New `hunter_locations` for live agent dots. Hunter PWA got `parseUtcTs` (Safari fix) + breadcrumb writes.
>
> **PENDING DEPLOY (do this in Supabase before the dashboard works):**
> - Apply migrations `…0004` (photo bucket), `…0005` (RLS ownership), **`…0006` (recovery_tickets_cache + hunter_locations) — HO dashboard is blank until this is applied + the edge fn has run once**.
> - Redeploy edge fns `zone-cluster` (now imports d3-delaunay) and `recovery-ticket-sync` (now rebuilds the cache).
> - Re-publish Metabase Q1 (`8ef20d85…`) so it emits `marked_at_utc` + `user_id` (edge fn has a safe fallback for both, so non-blocking).
> - Optional: schedule `cleanup_hunter_locations()` (monthly cron).

### Phase 1 — Core Ops

- [x] `recovery_tickets` + `recovery_ticket_events` table migrations
- [x] `recovery_blocked_vehicles` table
- [x] Edge function: Q1 — new ticket creation (5-min cron)
- [x] Edge function: Q2 — open ticket reconciliation (5-min cron)
- [x] Edge function: blocked-sync — Google Sheet → table (6 PM cron)
- [x] Edge function: zone-cluster — k-means + Voronoi per city (6 PM cron)
- [x] Auto zone + hunter assignment from clustering output
- [x] FPI groups + feature permissions (`trace-ho`, `trace-hunter`)
- [x] HO Dashboard (trace-ho.html) — map, color-coded pins, zone cards, stats bar, filter bar, auto-refresh
- [x] Hunter PWA shell (trace-hunter.html + trace-hunter-manifest.json + trace-hunter-sw.js)
- [x] Hunter PWA: vehicle list sorted by nearest distance (Haversine, Phase 1 = bike GPS as reference)
- [x] Hunter PWA: Call action → dials, then outcome sheet sets `call_status` (informed / no_response); never regresses status
- [x] Hunter PWA: Navigate action → sets ticket status to `en_route` (+ `en_route_at`, event)
- [x] Hunter PWA: Mark Found — photo upload required → sets `mark_found_at`, `mark_found_photo_url`, `hub_id` (nearest active `rental_locations` via client-side Haversine)
- [x] Hunter PWA: In Transit — photo upload required → sets `in_transit_at`, `in_transit_photo_url`. **Does NOT write `bike_operations_log`** — In Transit is Trace & Hunter internal state only (decision 2026-06-18, overrides the spec line that said it writes `recovered`)
- [x] HO Dashboard: "Location unknown" list — tickets with no GPS in `bike_location_cache`
- [~] GPS fallback logic — `bike_location_cache` exposes a single resolved `lat/lng` + `baas_location_time` (baas-vs-current fallback happens upstream at cache-sync). Verify upstream; no client-side fallback needed.
- [x] GPS staleness indicator — `gpsAge()` on Hunter cards + `gpsAgeStr()` in HO popups ("Xh / Xd ago")
- [x] Voronoi zone boundaries — `zone-cluster` computes GeoJSON (`boundary_polygon`) via d3-delaunay; trace-ho renders dashed colored cells under pins
- [x] `recovery-photos` storage bucket (public-read, authenticated-write) — migration `…0004`
- [x] RLS: UPDATE restricted to owner-or-superadmin — migration `…0005`
- [x] Edge functions redeployed: `zone-cluster` v2 (d3-delaunay), `recovery-ticket-sync` v2 (`marked_at_utc` IST→UTC + `user_id`)
- [x] Metabase Q1 (`8ef20d85…`) re-published with `marked_at_utc` + `user_id` columns

### Phase 2 — Ops Quality

- [ ] Cool-off mechanism — hunter-initiated, 2hr, one-time per ticket; `cooloff_expires_at` countdown in UI
- [ ] Deprioritize vehicle — hunter flags, sinks to bottom of list, HO sees deprioritized count per hunter
- [ ] Admin live override panel — drag-reassign vehicles between hunters on HO map
- [ ] Roster system UI — Mon–Sun matrix (Hunter × 7 days), template + overrides
- [ ] Bulk reassign — mark absent → covering hunter inherits all open tickets
- [ ] Instant push notification to hunter when customer renews while `en_route` (Q2 special case, <5min lag)
- [ ] PWA push notifications — new vehicle added to zone mid-day
- [ ] Newly added vehicle pulsing pin animation on HO map
- [ ] Base list / Added today filter toggle
- [ ] Re-cluster now button (Super admin only)

### Phase 3 — Intelligence

- [ ] Porter booking (in-system, replaces WhatsApp)
- [ ] Key metrics dashboard (avg recovery time, hunter productivity, zone performance)
- [ ] Call attempts tracking (`call_attempts` count + `last_called_at`)
- [ ] Damage fee exposure tracking
- [ ] Historical zone performance analytics
- [ ] Zone config history viewer

---

## Trace & Hunter Module

### Key rules (do not violate)
- GPS always read live from `bike_location_cache` via `reg_number` — never stored on ticket
- Do not modify any existing FleetPro feature not in spec
- Build only Phase 1 items

### trace-ho.html (HO Dashboard — "Trace")
**Rebuilt 2026-06-18 as a full RSA-Warroom clone** (`v8/rsa.html` is the base template) — same shell/components/interactions, adapted to recovery data. Single full-screen map (no more city-tab/zone-card sidebar layout).
- Layout mirrors RSA: global bar (City multiselect + Marked-date range + Refresh + sync badge) → clickable tiles → map-filter row (Zone NE/NW/SE/SW + Status + Age + Hunter multiselects + search) → full map.
- **Reads ONE table: `recovery_tickets_cache`** (GPS pre-joined by the edge fn). localStorage cache (`trace_ho_v1`, 60s TTL) + 60s poll. No client-side join, no per-client GPS fan-out — Micro-RAM friendly.
- `parseUtcTs()` (copied from RSA) for all timestamp parsing — fixes Safari/iOS `NaN` on `+00` offsets.
- Pin colors by `hoursIn(t)`: amber<24h, coral<48h, orange<72h, dark-red 3d+. Call-status ring: blue=informed, grey=no_response.
- Tiles (city-scoped, clickable): Total Pending, Critical 3d+ (flashes pins), Recovered Today, Calls Made, Hunters Active.
- Layers panel: Zones (Voronoi from `zone_configs.boundary_polygon`) / Hubs (`rental_locations`) / Hunters (live dots from `hunter_locations_latest`).
- Track panel: Hunter Trail (`hunter_locations` polyline) / Ticket Events (`recovery_ticket_events` timeline by reg).
- Location-Unknown: slide-in panel (no-GPS tickets), opened from a map-control button.
- Auth: permissions-first + superadmin short-circuit (NO perm-veil — matches the documented pattern, not RSA's older veil).

### trace-hunter.html (Hunter PWA — "Hunter")
- Mobile-first PWA (trace-hunter-manifest.json + trace-hunter-sw.js)
- Field agent app for ground team; My Queue (list) + Map tabs
- Reads `recovery_tickets` directly (own small slice — real-time for own actions), NOT the cache.
- List sorted nearest-first by Haversine from live phone GPS (`watchPosition`); in-transit tickets sink to the bottom as a collapsed confirmation line
- Actions: **Call** (dial → outcome sheet: informed/no_response), **Navigate** (opens maps → sets `en_route`), **Mark Found** (photo → `recovery-photos` bucket → `mark_found_photo_url` + nearest `hub_id`), **In Transit** (photo → `in_transit_photo_url`, internal state only)
- Null phone → disabled "No phone" button; no GPS → disabled "No GPS" Navigate
- `parseUtcTs()` for age parsing (Safari fix). Writes a throttled (~45s) breadcrumb to `hunter_locations` on `watchPosition` → HO live dots + Track trail.

### Supabase tables (Trace & Hunter)
- `recovery_tickets` — core ticket table (GPS never stored here)
- `recovery_ticket_events` — append-only event log
- `bike_location_cache` — live GPS (never join via ticket, always via reg_number; cols: `reg_number, lat, lng, baas_location_time`)
- `zone_configs` — daily clustering output (centroids, hunter, `boundary_polygon` GeoJSON, per date/city/zone)
- `recovery_blocked_vehicles` — police-station / impounded exclusions (6 PM Google Sheet sync)
- `roster_template` / `roster_overrides` — hunter roster (Phase 2 UI; read by zone-cluster)
- `rental_locations` — hubs (`id, location_name, lat, lng, city_id, status`); nearest-hub Haversine at Mark Found
- `recovery_tickets_cache` — **denormalised HO snapshot** (open + today-recovered, GPS pre-joined). Rebuilt by `recovery-ticket-sync` every 5 min (delete+reinsert). The HO dashboard's only read source — keeps the GPS join off the client (Micro RAM).
- `hunter_locations` (+ `hunter_locations_latest` view) — hunter GPS breadcrumbs from the PWA; HO live dots + Track trail. 7-day retention.

### Storage
- `recovery-photos` bucket — Mark Found / In Transit proof photos (public-read, authenticated-write); path `<ticketId>/<ts>.<ext>`

### Migrations
- `…0002_trace_hunter_tables.sql` — tables, enums, RLS, triggers
- `…0003_trace_hunter_groups.sql` — FPI groups + feature keys
- `…0004_recovery_photos_bucket.sql` — storage bucket + policies
- `…0005_recovery_tickets_update_ownership.sql` — UPDATE restricted to owner-or-superadmin
- `…0006_recovery_ho_cache.sql` — `recovery_tickets_cache` + `hunter_locations` (+ latest view) + 7-day cleanup fn

### Edge functions
- `recovery-ticket-sync` — 5-min cron, syncs Q1+Q2 tickets (resolves `marked_at_utc` IST→UTC; sets `user_id`); **Step 3 rebuilds `recovery_tickets_cache`** (GPS-enriched snapshot for the HO dashboard)
- `recovery-blocked-sync` — 6 PM cron, syncs Google Sheets blocked list
- `zone-cluster` — 6 PM cron, balanced k-means + Voronoi (d3-delaunay) + roster-based hunter assignment

### Feature keys
- `trace-ho` — HO Dashboard access
- `trace-hunter` — Hunter PWA access

### Do-not-violate decisions
- **In Transit never writes `bike_operations_log`** — it's Trace & Hunter internal state (overrides context.md). Do not add an ops_log write.
- RLS `recovery_tickets` UPDATE = owner-or-superadmin. Phase 2 admin drag-reassign will need a broader policy.

## Security Constraints

- **PAT**: Never store in any committed file. Inline to git clone URL only, then discard.
- **Login key**: `Hatric1@3` — Supabase env only, never in code
- **ARCHIVE_CRON_SECRET**: In Supabase vault + edge fn secrets only, never in git
- **Supabase anon key**: Safe to commit (it's public-facing by design)

## Map Tiles (all map pages)

```js
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap © CARTO',
  maxZoom: 19,
  subdomains: 'abcd'
}).addTo(map);
```

## Common Patterns

**Counting rows without fetching data:**
```js
var h = { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + K, 'Prefer': 'count=exact', 'Range': '0-0' } };
fetch(SB + '/rest/v1/table_name?select=id&filter=eq.value', h)
  .then(r => parseInt(r.headers.get('Content-Range').split('/')[1]) || 0)
```

**IST date string:**
```js
function getIstDate(){ return new Date(Date.now()+5.5*3600000).toISOString().slice(0,10); }
```
