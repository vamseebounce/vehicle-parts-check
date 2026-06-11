# Fleetpro — Context File
*Last updated: 2026-06-12 (session 6 — Phase 0 complete + 2½ additive tables + ticket_status_history + 1.2)*

## 🏗 Architecture Roadmap (session 5)
- `ARCHITECTURE-PROPOSAL.md` created at repo root — 6-phase productization roadmap (PROPOSAL ONLY, nothing executed)
- Phases: 0 git/migrations → 1 security (RLS+single auth) → 2 data model (upsert + ticket_events) → 3 Vite shared lib → 4 staging+CI → 5 observability → 6 multi-city
- Execution happens in the OTHER window (Sonnet); execute phases in order; see §6 "Execution notes" + verify-first list in the proposal
- 5 open decisions (D1–D5) in proposal §5 need Vamsee's call before execution: hosting, staging type, TS scope, Metabase dependency, realtime strategy
- Verified this session: fw_bikes_live exposes rider_phone via anon REST; tech.html line 673 updates rsa_tickets_cache directly from client; RSA_EMAILS allowlist client-side at fw-map.html:736; admin secret NOT hardcoded in admin-techs.html (user-entered) but is plaintext in this file
- Added §7 "Phase 2½ ML data foundation" to proposal: bike_telemetry_history, ticket_status_history, fw_pending_history, vehicles dim table, Parquet archival tiering — because Vamsee wants predictive systems later and current pipeline overwrites all history (bike_location_cache latest-only every 5 min)

> **Session rules:** Use grep/sed instead of reading full files. Keep bash output minimal. All changes go in `/Bounce/fleetpro/`. RRR is a separate project — ignore it in this window.
> **At session end: update this file with any changes.**

---

## Git / GitHub (set up session 6)

- **Repo:** https://github.com/vamseebounce/vehicle-parts-check
- **Branch:** `main` → GitHub Pages → bounceops.online
- **PAT:** embedded in remote URL for sandbox-autonomous pushes. ⚠️ Token `<REDACTED_REGENERATE_IN_GITHUB>` was shared in chat — **regenerate it**.
- **Lock file gotcha:** Sandbox creates `.git/index.lock` and `refs/remotes/origin/main.lock` on macOS FUSE mount but cannot delete them. Workaround: `git add` + `git commit` must run from user's **Terminal**; sandbox handles `git push` and `git tag`.
- **Rollback tags:** `phase-0.0`, `v8-final`, `phase-0.3`, `phase-0.4`, `phase-0.5`, `phase-0.6`, `phase-2half-additive` (vehicles, sync_heartbeats, fw_pending_history), `phase-2half-additive-2` (ticket_status_history)
- **Task tracker:** `PRODUCTIZATION-TASKS.md` in repo root — 47 tasks across Phase 0–6 + Phase 2½
- **.gitignore:** excludes `.DS_Store`, `v6/`, `v7/`, `archive/`, `*.lock`

### Phase 0 status (paused here)
| Task | Status |
|------|--------|
| 0.0 Push v8 to GitHub | ✅ `phase-0.0` |
| 0.1 Tag v8-final | ✅ `v8-final` |
| 0.2 Move v6/v7 to archive/ | ✅ gitignored |
| 0.3 Capture all 13 edge fns → supabase/functions/ | ✅ `phase-0.3` |
| 0.4 DB dump → baseline migration | ✅ `phase-0.4` |
| 0.5 Cron job definitions → supabase/cron-jobs.sql | ✅ `phase-0.5` |
| 0.6 README | ✅ `phase-0.6` |

## Window Split
- **RRR window** → Analysis, SQL queries, RRR project work
- **Fleetpro window** → All HTML/code, Supabase schema, crons, deployments

---

## Current Status

**v8 is latest.** All files in `/Bounce/fleetpro/v8/`. Push all to GitHub.

---

## 🟡 Pending Issues

### 0. 🔴 URGENT (found session 5): rsa-ticket-sync cron dead since June 9 ~17:34 UTC
- pg_cron job 13 (`rsa-ticket-sync-2min`): 1,299 consecutive failures, "job startup timeout", 0 successes
- rsa.html data only fresh via users clicking Refresh (manual edge fn calls work fine — Metabase card f79c5050 alive, 45 tickets synced 12:48 UTC June 11)
- Suspected cause: job 13 command has over-escaped headers JSON (`\\\"` doubled) vs working job 11 — likely bad edit during June 9 fw-sheet-sync 401 fix session
- Fix (execute in Sonnet window): `cron.unschedule(13)` + re-`cron.schedule` with clean escaping modeled on job 11; rsa-ticket-sync is verify_jwt=false so no auth headers needed
- Side effects while down: rsa_ticket_locations trails + edge-fn team tracking not appending (rsa-team-track-2min SQL job unaffected, healthy)
- Also confirmed: Supabase/Fleetpro CANNOT delete Metabase tables — edge fn only GETs a public card URL, holds no Metabase credentials (Vamsee saw a Tickets table removed in Metabase; cause is upstream, not this project)

### 1. Historical data null lat/lng + null city
- Tickets synced before edge fn v9 (old card 6f11e26e) have null city/GPS
- Fix: select date range in rsa.html + click Refresh → edge fn v9 re-syncs with Bass_Lat/Bass_Lng/city from card f79c5050
- Known gap: BT-3763 (HYD, June 9) missing — re-sync 09/06-10/06 to recover it

### 2. rsa_ticket_locations and rsa_team_locations empty
- Both tables have 0 rows — no open tickets existed during a v9 cron run yet
- Will self-populate once a NEW/IN_PROGRESS ticket is active and cron fires
- Team locations need Nishanth/Pavan chassis to be active in bike_location_cache

### 3. fw-sheet-sync 401 — FIXED ✅
- Root cause: pg_cron job (id=10) called edge fn with no Authorization header, but fn has verify_jwt=true
- Fix: updated cron job command to include Authorization + apikey headers (anon key)
- Gotcha: bike-location-sync + fw-map-rider-sync have no auth in cron but work fine — those fns have verify_jwt=false

### 4. tech.html PWA install not working on Android
- "Add to Home Screen" creates shortcut instead of standalone PWA
- Manifests updated with scope/id/proper icons — push to GitHub + retest
- `beforeinstallprompt` not firing — Install App button added as fallback

### 5. Supabase egress outage (resolved)
- June 11: hit 402% egress (20GB/5GB), Supabase returned 546 for all edge fns
- Fix: upgraded to Pro ($25/mo, 250GB egress)
- All crons recovered after upgrade

---

### Files in v8 (latest)
| File | Key changes |
|------|-------------|
| `fw-map.html` | unchanged from v7 |
| `index.html` | unchanged from v7 |
| `maintenance.html` | unchanged from v7 |
| `queue.html` | unchanged from v7 |
| `deployment.html` | unchanged from v7 |
| `rsa.html` | Session 4: timestamp fix (parseUtcTs), negative TAT shows '--', PWA manifest added |
| `tech.html` | **NEW** — Technician PWA (Supabase auth, ticket view, GPS nav, complete+evidence) |
| `tech-manifest.json` | PWA manifest for tech.html |
| `tech-sw.js` | Service worker for tech.html |
| `rsa-manifest.json` | PWA manifest for rsa.html |
| `rsa-sw.js` | Service worker for rsa.html |
| `admin-techs.html` | **NEW** — Admin panel: create/manage tech accounts, view actions log |

---

## RSA Warroom (rsa.html)

### What it does
Live ops map for RSA (Roadside Assistance) tickets. Central team monitors open tickets across cities, tracks RSA technician locations, filters by status/TAT/city/zone.

### Data pipeline
```
Metabase (card f79c5050, last 30 days) → rsa-ticket-sync edge fn (v9) → rsa_tickets_cache → rsa_tickets_live view → rsa.html
```
- **Today**: Supabase Realtime subscription — on any change to `rsa_tickets_cache`, 3s debounce then full re-fetch from `rsa_tickets_live`. Fallback poll only if Realtime silent >5 min.
- **Historical**: user picks date range → edge fn syncs → polls until fresh data appears
- **Live location**: edge fn enriches open (NEW/IN_PROGRESS) tickets with live GPS from bike_location_cache → stored as live_lat/live_lng
- **Movement tracking**: every 2-min cron appends open ticket locations to rsa_ticket_locations + RSA team locations to rsa_team_locations

### Layout (3 rows)
1. **Global bar** (blue tint): City dropdown + From/To date + Refresh + sync status
2. **Tiles**: NEW · IN PROGRESS · DONE · Avg Closure TAT · Avg Response TAT · RSA >1hr % — scoped to City+Date only (ignore map filters)
3. **Map filters**: Zone · Status · TAT · Assigned + Search (right-aligned) — affect map only

### Features
- Default load: City=BLR, Status=NEW+IN_PROGRESS (hides DONE), today's date
- Map pins use `display_lat`/`display_lng`: open tickets → live GPS; DONE → Bass snapshot
- **Tile click**: flash matching pins on map for 5s with coloured ring (city-filtered, no pan-India jump)
- **Search**: zooms to matching reg/ticket in filtered set, amber ring flash for 2s
- **⊙ Recenter**: snaps map back to current city selection
- **🛤 Track panel** (slide-in right):
  - *RSA Team tab*: pick person + date range → polyline trail with start/end markers
  - *Ticket tab*: enter ticket number → dashed trail with grey pins, status-change labels
- **Popup actions**: 📍 Directions (Google Maps link) · 📋 Copy loc (coords to clipboard) · 🛤 Track
- Zone shading: selecting North/South draws light indigo rectangle over that half
- Hub icons: logo.jpg (same as fw-map)
- Realtime: subscribed to `rsa_tickets_cache` (event:'*'); 3s debounce → clean re-fetch from view (not payload patch — avoids accumulation bug)
- Fallback poll: 5-min interval, only fires if `_lastRealtimeUpdate` > 5 min ago
- RSA team location: refreshes every 2 min (matches cron cadence)

### Filters logic
- All checkboxes selected in a group → `getChecked()` returns `[]` → treated as "no filter"
- Zone filter uses `display_lat` (respects live GPS for open tickets)
- `inferCity(t)`: uses t.city if set, else infers from lat/lng bounds, defaults to 'BLR'
- `flashStatus(status, color)`: respects current city filter (no cross-city jumps)
- Date range: max 30 days; `date-to` min/max enforced in picker and code
- Map fit: only refits when city selection changes (`_lastCitySel` guard); status/TAT/assigned changes don't move map

---

## Technician PWA (tech.html)

### Auth
- Supabase email/password. Admin creates accounts via `admin-techs.html`.
- Edge fn `admin-create-tech` (verify_jwt=false, protected by `x-admin-secret` header).
- **IMPORTANT**: Set `ADMIN_SECRET=<your-secret>` in Supabase dashboard → Edge Functions → admin-create-tech → Secrets. Same secret goes in admin-techs.html unlock screen.

### Flow
1. Tech logs in with email/password
2. Profile fetched from `rsa_technicians` (name must match `technician_name` in rsa_tickets_cache)
3. Active tickets shown (NEW/IN_PROGRESS assigned to tech)
4. Actions: On My Way, On Site, Mark Complete (with resolution type + notes + photos/videos)
5. Evidence uploaded to `rsa-evidence` Supabase Storage bucket
6. Mark Complete also writes `status='DONE'` to `rsa_tickets_cache` (overwrites until next cron)

### New Supabase Objects
| Object | Type | Notes |
|--------|------|-------|
| `rsa_technicians` | Table | id (=auth.users.id), name, email, phone, is_active |
| `rsa_tech_actions` | Table | ticket_number, technician_id, action, resolution_type, notes, evidence_urls[] |
| `rsa-evidence` | Storage bucket | photos/videos, 50MB limit, authenticated upload only |
| `admin-create-tech` | Edge fn | create/deactivate/reset_password/list — protected by ADMIN_SECRET |

---

## New Tables (session 6 — Phase 2½ + 5.1)

| Table | Purpose | Notes |
|-------|---------|-------|
| `vehicles` | Dimension table: one row per chassis (reg, model, city) | ML training anchor. Empty — needs backfill from bike_location_cache |
| `sync_heartbeats` | One row per edge fn run (status, duration_ms, rows_affected) | Edge fns not yet wired to write here — Task 5.2 |
| `fw_pending_history` | Daily snapshot of fw_pending_cache (chassis, hub, reg) | Cron `fw-pending-daily-snapshot` runs 18:25 UTC (23:55 IST) daily |
| `ticket_status_history` | Immutable log of every ticket status transition | Trigger `trg_ticket_status_history` on rsa_tickets_cache INSERT/UPDATE |

---

## Supabase Objects

### Tables
| Table | Rows | Purpose |
|-------|------|---------|
| `fw_pending_cache` | ~1,318 | FW-pending bikes from Google Sheet (full refresh every 15 min) |
| `bike_location_cache` | ~9,812 | All bike GPS locations (5-min cron) |
| `bike_rider_cache` | ~9,795 | Rider name+phone (hourly cron) |
| `rsa_tickets_cache` | ~58/day | RSA tickets; columns: ticket_number, status, category, reg_number, technician_name, fault_details, created_at_ist, inprogress_at_ist, resolved_at_ist, tat_minutes, city, synced_at, lat, lng, bass_location_time_ist, live_lat, live_lng |
| `rsa_team_locations` | append-only | Nishanth/Pavan GPS trail — appended every 2-min cron; columns: id, name, chassis, reg_number, lat, lng, location(geography), synced_at |
| `rsa_ticket_locations` | append-only | Per-ticket bike movement trail for open tickets — appended every 2-min cron while NEW/IN_PROGRESS; columns: id, ticket_number, status, lat, lng, location(geography), synced_at |
| `rental_locations` | 15 | Bounce hub locations (Bangalore) |
| `oos_work_queue` | 570 | OOS job queue |
| `dms_jc_history` | — | Job card history |
| `vehicle_parts_check_flag` | 10,563 | Maintenance check data |

### Views
| View | Purpose |
|------|---------|
| `fw_bikes_live` | fw_pending_cache ⨝ bike_location_cache ⨝ bike_rider_cache — 1,366 FW-pending bikes with location+rider |
| `rsa_tickets_live` | rsa_tickets_cache — adds `display_lat`/`display_lng`: DONE→Bass snapshot (lat/lng), NEW/IN_PROGRESS→COALESCE(live_lat, lat) |

### Edge Functions
| Function | Schedule | Purpose |
|----------|----------|---------|
| `bike-location-sync` | `*/5 * * * *` | Metabase → bike_location_cache (9,184 bikes incl. internal use) |
| `fw-sheet-sync` | `*/15 * * * *` | Google Sheet → fw_pending_cache (full refresh, delete+insert) |
| `fw-map-rider-sync` | `0 * * * *` | Metabase → bike_rider_cache (hourly) |
| `rsa-ticket-sync` | `*/2 * * * *` | **v9** (verify_jwt=false, CORS headers). Per run: (1) fetch Metabase card f79c5050, (2) enrich open tickets with live GPS from bike_location_cache → live_lat/live_lng, (3) delete+reinsert rsa_tickets_cache, (4) append open ticket locations to rsa_ticket_locations, (5) append RSA team locations to rsa_team_locations. Accepts start_date/end_date for historical re-sync. Dedup: 100s. |
| `rsa-history` | on-demand | Proxy for RSA historical Metabase fetch (likely unused now) |

### PostGIS Functions
| Function | Purpose |
|----------|---------|
| `get_ticket_trail_km(ticket_number text)` | Total km bike moved during ticket lifecycle (from rsa_ticket_locations) |
| `get_team_trail_km(name text, from timestamptz, to timestamptz)` | Total km covered by RSA team member in time window |
| `get_rsa_summary()` | Aggregate metrics (unused — metrics now client-side) |

### PostGIS
- Extension enabled on project
- `rsa_ticket_locations.location` and `rsa_team_locations.location` are `geography(Point, 4326)`
- Trigger `set_location_from_latlong()` auto-populates geography from lat/lng on every insert
- GIST spatial indexes on both tables
- `rsa_tickets_cache` published to `supabase_realtime`

---

## RSA Team Bikes (GPS tracked)
| Name | Chassis | Reg | Status |
|------|---------|-----|--------|
| Nishanth | P6EBE1JYK25000288 | KA05AR5056 | internal use — in bike_location_cache |
| Pavan | P6EBE1JYK25000072 | KA05AR3238 | internal use — in bike_location_cache |

Both have 7-day session (no 12h reauth) in fw-map.html. RSA_EMAILS list in fw-map.html.

---

## Egress Status
- June 11: hit 20GB/5GB (402%) → Supabase applied 546 errors → **upgraded to Pro** ($25/mo, 250GB egress)
- Root cause: fw-map fetching 9,812+9,795 rows every 1 min (fixed with fw_bikes_live view + 5-min interval)
- RSA page egress: ~109 MB/month
- Now on Pro — no egress restriction

## Observability
- Daily health check scheduled via Cowork at 8:00 AM IST
- Checks: cron last run (>10min=WARN, >30min=FAIL), DB reachable, tickets today, open tickets
- Task ID: `fleetpro-health-check` in Cowork Scheduled sidebar

---

## Key Gotchas
1. `rental_locations` has 15 rows (Bangalore hubs, city_id=1, status=active) — hub fetch works
2. RSA city codes from Metabase: `BLR`, `NCR` (Delhi). `HYD` filter ready; no HYD tickets yet.
3. Metabase date params don't work via URL query string — edge fn fetches ALL tickets, filters by `Created_at_IST` in Deno
4. `_syncLock` in fw-map.html prevents edge fn call pile-up (Metabase takes 30-60s)
5. Timestamps from Supabase come as `"2026-06-09 14:15:57+00"` — strip `+00` before treating as UTC
6. fw-sheet-sync: old approach was upsert-only (stale bikes stayed). Now: delete range + insert.
7. GitHub Pages deployment warning (Node.js 20 deprecated) — self-resolves June 16, 2026
8. `inferCity(t)`: uses t.city first, then lat/lng bounds inference, defaults to 'BLR' — tickets with null city/GPS always appear under BLR filter
9. Realtime uses clean re-fetch (not payload patching) to avoid ticket accumulation bug — old approach caused `_all` to grow to 237 tickets
10. `rsa_team_locations` and `rsa_ticket_locations` have RLS **disabled** — internal tables, no sensitive data. Edge fn was blocked by RLS (anon role fallback issue). Fix: disable RLS.
11. `rsa_team_locations` now populated by dedicated pg_cron job `rsa-team-track-2min` (pure SQL, no edge fn dependency)
12. `rsa_ticket_locations` populates when open NEW/IN_PROGRESS tickets exist during edge fn v11 cron run
13. Track panel shows "No trail yet" message if `rsa_ticket_locations` empty for that ticket — not an error
18. `parseUtcTs(ts)` — shared parser in rsa.html that handles `+00` (2-digit offset), `+05:30`, `Z`. Old regex `[+-]\d{2}:?\d{2}` didn't match `+00` → fixed to `[+-]\d{2}(?::?\d{2})?`. Both `fmtTime` and `tatMins` now use this.
19. Negative TAT (`tatMins` returns <0) → `fmtTat` shows `--` — happens when Metabase reports future-dated `created_at_ist` (data issue, not code bug)
12. `fmtTime(ts)` strips timezone, adds 'Z', converts UTC→IST with `timeZone:'Asia/Kolkata'` — safe for all timestamp columns
13. All timestamp columns (`created_at_ist`, `inprogress_at_ist`, `resolved_at_ist`, `synced_at`, `bass_location_time_ist`) stored as UTC in Supabase — `_ist` suffix is Metabase naming convention, not storage format
14. Popup buttons: 📍 Copy map link (copies `https://maps.google.com/?q=lat,lng`) + 🛤 Track (no Directions button)
15. `flashStatus(status, color)` respects city filter — uses `globalFiltered` not `_all`
16. `resetTiles()` called on date change and Refresh — prevents stale count flash from previous date range
17. `computeMetrics`: RSA >1hr% divides by DONE tickets only (not all); Avg Response TAT filters diffs <0 or >600 min
10. `flashStatus()` must use `globalFiltered` (city-scoped), NOT `_all` — otherwise clicking DONE in BLR shows pan-India view
11. Edge fn v9 is the current deployed version. Previous versions: v7=verify_jwt fix, v8=live_lat+team tracking, v9=ticket trail tracking

---

## Live URLs
- bounceops.online → redirects to v8/index.html (FleetPro hub, magic link auth)
- bounceops.online/v8/fw-map.html → FW Flash Map (restricted allowlist)
- bounceops.online/v8/rsa.html → RSA Warroom
- bounceops.online/v8/tech.html → Technician PWA (Supabase auth, email/password)
- bounceops.online/v8/admin-techs.html → Tech admin panel (unlock: <ADMIN_SECRET — see Supabase env var Login_key>)
- bounceops.online/v8/maintenance.html, /queue.html, /deployment.html
- All v8/ assets in git including logo.jpg (was missing, restored session 6)

## Supabase
- Project ID: `clkfvmmlgwcvntxnolsv` (Tokyo, ap-northeast-1)
- Plan: **Pro** ($25/mo, 250GB egress) — upgraded June 11, 2026
- Anon key in all HTML files
- Admin edge fn secret: env var `Login_key` — value stored in Supabase dashboard only (Task 1.1: rotate before sharing URLs wider)
