# Fleetpro — Productization Task Tracker
*Last updated: 2026-06-11*

Legend: ⬜ TODO · 🔄 IN PROGRESS · ✅ DONE · ⏸ BLOCKED

---

## Phase 0 — Get everything into git (½ day)
*Prerequisite for all else*

| # | Task | Status | Notes |
|---|------|--------|-------|
| 0.0 | Push v8 files to GitHub | ⬜ | tech.html, admin-techs.html, manifests, icons, rsa.html fixes |
| 0.1 | Tag repo `v8-final` | ⬜ | Before any cleanup |
| 0.2 | Delete `v6/` and `v7/` from working tree | ⬜ | History preserved in git |
| 0.3 | Pull all edge fn source into `supabase/functions/` | ⬜ | rsa-ticket-sync, fw-sheet-sync, bike-location-sync, fw-map-rider-sync, admin-create-tech, rsa-history |
| 0.4 | DB dump → baseline migration `supabase/migrations/00000000000000_baseline.sql` | ⬜ | Schema snapshot |
| 0.5 | Cron job definitions → `supabase/cron-jobs.sql` | ⬜ | Query `cron.job` table |
| 0.6 | Write / update README so fresh clone can rebuild backend | ⬜ | |

---

## Phase 1 — Security hardening (1–2 days)
*Do before sharing URLs any wider*

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Rotate admin secret (`Login_key` / `Bounce@123`) in Supabase env vars | ⬜ | Update admin-techs.html + edge fn after |
| 1.2 | Remove all plaintext secrets from `Fleetpro-context.md` | ⬜ | |
| 1.3 | Add `role` claim (`admin`/`ops`/`tech`) to `app_metadata` via admin-create-tech fn | ⬜ | |
| 1.4 | Replace RSA_EMAILS allowlist in fw-map with Supabase Auth + role check | ⬜ | |
| 1.5 | Replace admin-techs unlock screen with Supabase Auth + role check | ⬜ | |
| 1.6 | RLS on `rsa_tickets_cache`: SELECT authenticated, INSERT/UPDATE service role only | ⬜ | ⚠️ Test after |
| 1.7 | RLS on `bike_rider_cache` (rider PII): authenticated ops/admin only | ⬜ | ⚠️ Currently open to anon |
| 1.8 | RLS on location tables: service-role write, authenticated read | ⬜ | Verify pg_cron bypasses RLS as table owner first |
| 1.9 | Expose hub list via curated view, not base table | ⬜ | |
| 1.10 | `verify_jwt=true` on all browser-facing edge fns | ⬜ | |
| 1.11 | Re-test all pages after RLS changes | ⬜ | |

---

## Phase 2 — Data model: cache → system of record (2–3 days)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Change rsa-ticket-sync to upsert on `ticket_number` (stop delete+reinsert) | ⬜ | Fixes Realtime churn + egress |
| 2.2 | Create `ticket_events` table (append-only, extends rsa_tech_actions) | ⬜ | |
| 2.3 | Update tech.html to INSERT event instead of UPDATE rsa_tickets_cache | ⬜ | |
| 2.4 | Create `rsa_tickets_live` view (effective_status precedence logic) | ⬜ | Tech DONE survives next cron |
| 2.5 | Switch rsa.html + admin panels to query `rsa_tickets_live` | ⬜ | |
| 2.6 | Partition `rsa_ticket_locations` + `rsa_team_locations` by month | ⬜ | |
| 2.7 | pg_cron job: export partitions >90 days to Parquet in Supabase Storage | ⬜ | |

---

## Phase 2½ — ML data foundation (1–1.5 days)
*Start capturing history now — every week of delay = less training data*

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2½.1 | Create `vehicles` dimension table (`chassis_number` PK, reg, model, city) | ⬜ | Additive, safe now |
| 2½.2 | Create `ticket_status_history` table + trigger on `rsa_tickets_cache` upsert | ⬜ | Additive, safe now |
| 2½.3 | Create `fw_pending_history` table + daily pg_cron snapshot | ⬜ | Additive, safe now |
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
| 5.1 | Create `sync_heartbeats` table | ⬜ | Additive, safe now |
| 5.2 | Update each edge fn to write to `sync_heartbeats` | ⬜ | |
| 5.3 | Update Cowork 8 AM health check to read `sync_heartbeats` | ⬜ | |
| 5.4 | Add Sentry (free tier) to shared lib | ⬜ | All pages get error reporting |
| 5.5 | Add `Cache-Control` headers on static assets (Vercel/Pages config) | ⬜ | Egress guardrail |
| 5.6 | Set up Supabase built-in alerts (egress >80%, CPU >80%, RAM >80%) | ⬜ | Settings → Alerts |

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
| D5 | Realtime strategy | **Keep clean-refetch** vs row-level patch | Keep refetch |
