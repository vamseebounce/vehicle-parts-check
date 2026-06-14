# Fleetpro — Productization Task Tracker
*Last updated: 2026-06-13 (session 11 — Tasks 2.6 + 2.7 done: partition + archival pipeline)*

Legend: ⬜ TODO · 🔄 IN PROGRESS · ✅ DONE · ⏸ BLOCKED

---

## Performance & Infrastructure (session 13)

| # | Task | Status | Notes |
|---|------|--------|-------|
| P1 | Remove Supabase Realtime `postgres_changes` → Broadcast pub/sub | ✅ | rsa.html + rsa-ticket-sync v19; zero WAL polling |
| P2 | Add 15-min idle guard on rsa.html + fw-map.html | ✅ | Stops polling when tabs left open overnight |
| P3 | Add off-hours guard to rsa-ticket-sync (midnight–6am IST skip) | ✅ | rsa-ticket-sync v19; saves ~180 cron runs/day |
| P4 | VACUUM rsa_tickets_cache + weekly cleanup-cron-history job | ✅ | Dead tuples 17.3% → 0%; cron.job_run_details auto-trims |
| P5 | Drop `rsa_ticket_locations_old` + `rsa_team_locations_old` | ✅ | migration 20260614000001; freed 3.7MB buffer cache |
| P6 | Investigate services loaded in RAM — optimize or drop what's unused | 🔄 | PostGIS candidate for removal if geography col unused |
| P7 | Upgrade compute Micro → Small (2 GB RAM) | ⬜ | BLOCKED: budget. Costs $5/month extra. Fixes red dot permanently |

---

## Hotfixes (production issues fixed outside phase order)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| H1 | rsa-ticket-sync cron (job 13) dead since June 9 — over-escaped headers | ✅ | Recreated as job 17 with clean escaping. First success 2026-06-12 20:10 UTC |

---

## Phase 0 — Get everything into git (½ day)
*Prerequisite for all else*

| # | Task | Status | Notes |
|---|------|--------|-------|
| 0.0 | Push v8 files to GitHub | ✅ | tag: `phase-0.0` |
| 0.1 | Tag repo `v8-final` | ✅ | tag: `v8-final` |
| 0.2 | Move `v6/` and `v7/` to `archive/` | ✅ | Preserved in archive/, gitignored |
| 0.3 | Pull all edge fn source into `supabase/functions/` | ✅ | tag: `phase-0.3` — all 13 fns captured + CNAME restored |
| 0.4 | DB dump → baseline migration `supabase/migrations/00000000000000_baseline.sql` | ✅ | tag: `phase-0.4` |
| 0.5 | Cron job definitions → `supabase/cron-jobs.sql` | ✅ | 9 jobs captured, keys redacted |
| 0.6 | Write / update README so fresh clone can rebuild backend | ✅ | tag: `phase-0.6` |

---

## Phase 1 — Security hardening (1–2 days)
*Do before sharing URLs any wider*

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Rotate admin secret (`Login_key` / `Bounce@123`) in Supabase env vars | ✅ | Rotated 2026-06-13; no code change needed (user enters secret manually) |
| 1.2 | Remove all plaintext secrets from `Fleetpro-context.md` | ✅ | PAT + Bounce@123 redacted |
| 1.3 | Add `role` claim (`admin`/`ops`/`tech`) to `app_metadata` via admin-create-tech fn | ✅ | edge fn v5 deployed; role dropdown added to admin-techs.html; set_role action added |
| 1.4 | Replace RSA_EMAILS allowlist in fw-map with Supabase Auth + role check | ✅ | DB-driven via groups/group_features/user_groups. RSA_EMAILS kept as fallback. admin-permissions.html built for matrix management. |
| 1.5 | Replace admin-techs unlock screen with Supabase Auth + role check | ✅ | Two-stage: magic link → role=admin check → Login_key secret |
| 1.6 | RLS on `rsa_tickets_cache`: SELECT authenticated, INSERT/UPDATE service role only | ✅ | Removed anon policy; authenticated_select only; service_role bypasses |
| 1.7 | RLS on `bike_rider_cache` (rider PII): authenticated ops/admin only | ✅ | Removed public read policy; authenticated only |
| 1.8 | RLS on location tables: service-role write, authenticated read | ✅ | bike_location_cache, rsa_ticket_locations, rsa_team_locations — RLS enabled authenticated-only |
| 1.9 | Expose hub list via curated view, not base table | ✅ | `hubs` view created + migration 20260613000001; live in Supabase |
| 1.10 | `verify_jwt=true` on all browser-facing edge fns | ⏸ | Parked — do after Vite migration (Phase 3) when shared auth lib exists |
| 1.11 | Re-test all pages after RLS changes | ✅ | All edge fn logs 200; crons healthy; authenticated reads confirmed; anon blocked |

---

## Phase 2 — Data model: cache → system of record ✅ COMPLETE

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Change rsa-ticket-sync to upsert on `ticket_number` (stop delete+reinsert) | ✅ | rsa-ticket-sync v16 deployed |
| 2.2 | Create `ticket_events` table (append-only, extends rsa_tech_actions) | ✅ | migration 20260614000002; RLS authenticated only |
| 2.3 | Update tech.html to INSERT event instead of UPDATE rsa_tickets_cache | ✅ | Dual-write: ticket_events + rsa_tickets_cache kept until 2.5 |
| 2.4 | Create `rsa_tickets_live` view (effective_status precedence logic) | ✅ | migration 20260614000003; new cols: effective_status, latest_event_type, latest_event_at, event_technician |
| 2.5 | Switch rsa.html + admin panels to query `rsa_tickets_live` | ✅ | effStatus() helper; all 10 status refs switched; security_invoker on view; anon blocked; override tested |
| 2.6 | Partition `rsa_ticket_locations` + `rsa_team_locations` by month | ✅ | migration 20260614000006; RANGE on synced_at; June+July+DEFAULT partitions; pg_cron job 18 auto-creates next month on 25th; old tables kept as *_old |
| 2.7 | pg_cron job: export partitions >90 days to Parquet in Supabase Storage | ✅ | migration 20260614000007; edge fn archive-location-partition; Arrow IPC format (.arrow) in location-archives bucket; pg_cron job 19 on 1st of month 02:00 UTC; ⚠️ needs ARCHIVE_CRON_SECRET set (see migration header) |

---

## Phase 2½ — ML data foundation (1–1.5 days)
*Start capturing history now — every week of delay = less training data*

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2½.1 | Create `vehicles` dimension table (`chassis_number` PK, reg, model, city) | ✅ | Applied to DB + migration file |
| 2½.2 | Create `ticket_status_history` table + trigger on `rsa_tickets_cache` upsert | ✅ | phase-2half-additive-2 |
| 2½.3 | Create `fw_pending_history` table + daily pg_cron snapshot | ✅ | Applied to DB + migration file |
| 2½.4 | Create `bike_telemetry_history` table (partitioned) + hourly insert in bike-location-sync | ⬜ | High volume — design partitioning first |
| 2½.5 | Enforce `resolution_type` as constrained enum on ticket_events | ⬜ | Label quality for ML |
| 2½.6 | Add `synced_at` + raw-payload JSONB column to `rsa_tickets` upserts | ⬜ | Cheap insurance for re-featurization |

---

## Phase 3 — Frontend consolidation: Vite + shared core (3–4 days)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Scaffold Vite multi-page app (keep same URLs) | ⬜ | |
| 3.2 | Extract `src/lib/supabase.ts` (single client, env-injected keys) | ⬜ | |
| 3.3 | Extract `src/lib/time.ts` (`parseUtcTs`, `fmtTime`, `tatMins`, `fmtTat`) | ⬜ | Fix once, works everywhere |
| 3.4 | Extract `src/lib/mapkit.ts` (pins, flash rings, trails, recenter) | ⬜ | |
| 3.5 | Extract `src/lib/auth.ts` (guard + role check) | ⬜ | |
| 3.6 | Extract `src/lib/ui.css` (design tokens) | ⬜ | |
| 3.7 | Migrate `rsa.html` to Vite page | ⬜ | First — most complex |
| 3.8 | Migrate `tech.html` to Vite page | ⬜ | |
| 3.9 | Migrate `fw-map.html` to Vite page | ⬜ | |
| 3.10 | Migrate remaining pages | ⬜ | |
| 3.11 | Replace hand-rolled SW with `vite-plugin-pwa` (workbox) | ⬜ | Fixes Android PWA install |
| 3.12 | GitHub Actions: build `dist/` → deploy to Pages or Vercel | ⬜ | Decide D1 first |

---

## Phase 4 — Environments + CI (1 day)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | Create Supabase branch for staging (Pro feature) | ⬜ | Seed with Phase 0 migrations |
| 4.2 | GitHub Actions: PR → build + typecheck + preview deploy (staging) | ⬜ | |
| 4.3 | GitHub Actions: merge to main → deploy prod | ⬜ | |
| 4.4 | Write 20-line smoke script (check `rsa_tickets_live`, cron heartbeats) | ⬜ | Run post-deploy |

---

## Phase 5 — Observability + cost control (1 day)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Create `sync_heartbeats` table | ✅ | Applied to DB + migration file |
| 5.2 | Update each edge fn to write to `sync_heartbeats` | ⬜ | |
| 5.3 | Update Cowork 8 AM health check to read `sync_heartbeats` | ⬜ | |
| 5.4 | Add Sentry (free tier) to shared lib | ⬜ | All pages get error reporting |
| 5.5 | Add `Cache-Control` headers on static assets (Vercel/Pages config) | ⬜ | Egress guardrail |
| 5.6 | Egress + DB health alert | ✅ | health-check fn emails at 70% egress; cron job 16 daily 08:30 IST |

---

## Phase 6 — Multi-city + product readiness (ongoing)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | Create `cities` config table (code, name, bounds, center, zones) | ⬜ | Replace hardcoded BLR defaults |
| 6.2 | Update all pages to use `cities` table instead of hardcoded `inferCity` | ⬜ | |
| 6.3 | Generalize `rental_locations` → `hubs` keyed by city | ⬜ | |
| 6.4 | Add nullable `org_id` to core tables (tenancy stub) | ⬜ | Cheap now, RLS-by-org later |
| 6.5 | Create `feature_flags` table (`key, city, enabled`) | ⬜ | Per-city rollout control |

---

## Open Decisions (needed before Phase 3+)

| # | Decision | Options | Lean |
|---|----------|---------|------|
| D1 | Hosting after build step | GitHub Pages vs **Vercel** | Vercel (preview deploys, Vercel MCP connected) |
| D2 | Staging backend | **Supabase branch** vs 2nd project | Branch (Pro feature, less key juggling) |
| D3 | TypeScript scope | **Lib-only TS**, pages stay JS | Lib-only |
| D4 | Metabase dependency | **Keep polling** vs go direct to Bass | Keep for now |
| D5 | Realtime strategy | **Broadcast pub/sub** (implemented) vs postgres_changes | Broadcast — done ✅ |
| D6 | Frontend framework | **Vite** (Phase 3 plan) vs **Next.js** (Amit suggestion) vs stay HTML | Next.js has better AI coding reliability + Server Components reduce PostgREST load; decide before Phase 3 |

---

## Permission System (built session 7)

| Object | Type | Notes |
|--------|------|-------|
| `groups` | Table | id, name, description. Current: RSA Field Team, RSA Warroom, Admin |
| `group_features` | Table | group_id → feature_key. RSA Field: fw-map. RSA Warroom: fw-map+rsa-warroom. Admin: all |
| `user_groups` | Table | user_id → group_id (one-to-many). Nishanth+Pavan in RSA Field Team |
| `admin-permissions` | Edge fn | list_groups, list_users, toggle_user_group, toggle_group_feature, create_group, delete_group. Protected by Login_key |
| `admin-permissions.html` | Page | Groups×Features matrix + Users×Groups matrix. Live checkbox toggles. |
| `loadUserPermissions()` | fw-map.html fn | Fetches user's features from DB. Falls back to RSA_EMAILS if no DB groups. |
| `window.FP_FEATURES` | Global | Feature map {key:true} set after login. Use fpCan('feature-key') anywhere on page. |

**Feature keys:** fw-map · rsa-warroom · tech-app · admin-panel · export-data · all-cities

**Pending permission tasks:**
- Add superadmin role (protected from role changes) — session 8
- Wire index.html home page to show only allowed links per user — session 8
- Add tech-app feature to RSA Field Team — session 8
- Wire rsa.html gate using same fpCan() pattern — session 8
