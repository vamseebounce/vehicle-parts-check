# FleetPro — Project Memory

Bounce Daily's internal fleet operations hub. Static HTML/JS frontend deployed via GitHub Pages at **bounceops.online**. Backend is Supabase (Postgres + Edge Functions).

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
  manifest.json       — Hunter PWA manifest
  sw.js               — Hunter service worker
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

**Superadmin short-circuit**: `session.user.app_metadata.is_superadmin` → grants all features, bypasses DB queries.

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

## Trace & Hunter Module

### Key rules (do not violate)
- GPS always read live from `bike_location_cache` via `reg_number` — never stored on ticket
- Do not modify any existing FleetPro feature not in spec
- Build only Phase 1 items

### trace-ho.html (HO Dashboard — "Trace")
- CARTO tiles, Inter font, Leaflet map
- Filter bar: age chips (0–24h, 24–48h, 48–72h, 72h+) + status chips + search
- Filter state: `_filterAge`, `_filterStatus`, `_filterSearch` → `filterTickets()` → `rerender()`
- Pin colors: amber=#F59E0B (0–24h), coral=#F97316 (24–48h), orange=#EF4444 (48–72h), dark-red=#991B1B (72h+)
- Call-status ring on pins: blue=#3B82F6 (informed), grey=#9CA3AF (no_response)
- Summary stat tiles: total, critical, calls made, active agents — clickable to filter
- Map legend overlay + recenter button
- RSA-quality popups: 2-col grid, action buttons (call, mark found, etc.)
- Auto-refresh every 60 seconds (`setInterval(loadData, 60000)`)

### trace-hunter.html (Hunter PWA — "Hunter")
- Mobile-first PWA (manifest.json + sw.js)
- Field agent app for ground team

### Supabase tables (Trace & Hunter)
- `recovery_tickets` — core ticket table
- `bike_location_cache` — live GPS (never join via ticket, always via reg_number)
- `recovery_zones` — zone definitions
- `hunter_profiles` — hunter/agent profiles

### Edge functions
- `recovery-ticket-sync` — 5-min cron, syncs Q1+Q2 tickets
- `recovery-blocked-sync` — 6 PM cron, syncs Google Sheets blocked list
- `zone-cluster` — 6 PM cron, k-means zone clustering + assignment

### Feature keys
- `trace-ho` — HO Dashboard access
- `trace-hunter` — Hunter PWA access

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
