# Fleetpro — Architecture Proposal (Productization Roadmap)
*Author: Architect window (Claude) · Date: 2026-06-11 · Status: PROPOSAL ONLY — execute in Sonnet window*

**Goal per Vamsee:** product-ize Fleetpro. Open to a build step. Solo operator (Vamsee + Claude).

---

## 1. Current Architecture (as audited)

```
Metabase cards ──┐
Google Sheets ───┼─► Edge Fns (pg_cron) ─► Supabase Postgres (+PostGIS, Realtime, Storage)
Bass GPS feed ───┘                              │
                                                ▼
                    8 standalone HTML pages (GitHub Pages, bounceops.online)
                    each with inline JS, own Supabase client, anon key
```

- ~6,500 lines across 8 HTML files; zero shared code. `parseUtcTs`, client init, auth, map helpers duplicated per file.
- Versioning = folder copies (`v6/ v7/ v8/`). Edge fn source lives only in Supabase dashboard.
- Three different auth schemes: client-side email allowlist (fw-map), Supabase email/password (tech), shared secret `Bounce@123` in client HTML (admin-techs).
- Sync = delete + reinsert full table every 2 min (rsa) / 15 min (fw_pending).
- RLS disabled on location tables; tech.html writes `status='DONE'` directly to `rsa_tickets_cache` and the next cron overwrites it.
- One environment (prod). No CI, no tests, no error tracking. Already hit one egress outage.

**Verdict:** excellent prototype velocity, but the system has three structural debts that will bite as it grows: (A) security model, (B) cache-as-source-of-truth data model, (C) 8x code duplication. The roadmap below fixes them in risk order.

---

## 2. Top Risks (ranked)

| # | Risk | Why it matters now |
|---|------|--------------------|
| R1 | **Anon key + weak/no RLS = open database.** Anyone who views page source can read (and possibly write) tables via REST — verified: `fw_bikes_live` serves `rider_phone` to the anon key, and tech.html updates `rsa_tickets_cache` from the client. Admin secret `Bounce@123` sits in plaintext in Fleetpro-context.md (in the repo). | Customer/rider PII, ticket data, and write access exposed. Blocks any "product" claim. |
| R2 | **Two writers, one table, last-write-wins.** Tech marks DONE → cron delete+reinserts from Metabase → status reverts. Acknowledged in context as "overwrites until next cron". | Data loss by design. Gets worse with more techs/cities. |
| R3 | **Edge fn source + schema exist only in Supabase dashboard.** No migrations, no fn source in git. | One bad dashboard edit = unrecoverable. Sonnet window can't safely change what it can't see. |
| R4 | **8x duplicated frontend code.** The gotchas list itself shows the same bug fixed in one file recurring in another (`parseUtcTs`). | Every fix is 8 fixes. Velocity decays with each page added. |
| R5 | **Full-refetch patterns.** Realtime event → refetch whole view; delete+reinsert churns Realtime + egress. | Already caused a 402% egress incident. Linear cost growth with tickets × cities. |
| R6 | **Single environment.** All changes tested in prod, on live ops tooling. | One bad deploy blinds the warroom during an incident. |

---

## 3. Target Architecture

```
Sources (Metabase, Sheets, Bass)
        │  upsert-based sync fns (source in git, deployed via CLI)
        ▼
Supabase Postgres = SYSTEM OF RECORD
  • rsa_tickets (upsert by ticket_number, updated_at)
  • ticket_events (append-only: tech actions, status changes)
  • effective status = view merging sync data + events (precedence rules)
  • RLS ON everywhere; anon = SELECT on curated views only
  • roles: admin / ops / tech via one Supabase Auth + JWT claim
        ▼
Vite multi-page build (TypeScript shared core, pages stay simple)
  /src/lib: supabase client, auth guard, time utils, map kit, design tokens
  /src/pages: rsa, tech, fw-map, admin, ... (thin)
        ▼
GitHub Actions CI ─► staging (Supabase branch / 2nd project) ─► prod
Sentry (frontend) + heartbeat table (crons) + existing Cowork health check
```

Stack stays Supabase + static hosting — no servers. The build step is the only new moving part, and it removes more complexity (duplication, hand-rolled SW) than it adds.

---

## 4. Roadmap — 6 Phases, each independently shippable

Order = risk-first. Don't reorder Phase 1 and 2 after 3; the frontend refactor is wasted if the data model underneath changes after.

### Phase 0 — Get everything into git (½ day) — *prerequisite for all else*
1. Make the repo canonical: keep only latest code at root (or `/app`), delete `v6/v7` from the working tree (history preserves them). Tag current state `v8-final`.
2. `supabase init` + pull all edge fn source into `supabase/functions/` (rsa-ticket-sync, fw-sheet-sync, bike-location-sync, fw-map-rider-sync, admin-create-tech, rsa-history).
3. `supabase db dump` → baseline migration in `supabase/migrations/`. All future schema changes as migration files, applied via `supabase db push` or MCP `apply_migration`.
4. Check in cron job definitions as a SQL file (pg_cron is schema — treat it as such).

*Acceptance:* a fresh clone + the README can rebuild the entire backend. No logic exists only in a dashboard.

### Phase 1 — Security hardening (1–2 days) — *do before sharing URLs any wider*
1. **Rotate the admin secret.** `Bounce@123` is documented in plaintext in Fleetpro-context.md (and doubles as the admin panel unlock + edge fn `Login_key`). Rotate it; remove all plaintext secrets from Fleetpro-context.md. (Verified: admin-techs.html itself does NOT hardcode it — user-entered at unlock.)
2. **One auth system.** Supabase Auth for everyone; add `role` (`admin`/`ops`/`tech`) to `app_metadata` (set via admin-create-tech fn). Kill: client-side RSA_EMAILS allowlist in fw-map, the admin-techs unlock screen.
3. **RLS on, everywhere.**
   - `rsa_tickets_cache`/`rsa_tickets`: SELECT for authenticated; UPDATE/INSERT only via service role (sync fn) — techs never write it directly (see Phase 2).
   - `rsa_tech_actions` / `ticket_events`: INSERT where `technician_id = auth.uid()`; SELECT for ops/admin.
   - `bike_rider_cache` (rider PII): authenticated ops/admin only — this is the most sensitive table and is currently readable with the public anon key.
   - Location tables: re-enable RLS with a service-role-write / authenticated-read policy. The earlier "anon role fallback" blocker disappears once crons run as service role (pure-SQL cron jobs already bypass RLS as table owner — verify).
   - Curated public-ish data (hub list) → expose via a view with its own grant, not the base table.
4. **Edge fn posture:** `verify_jwt=true` for all fns called from browsers; service-role key only inside fns; admin-create-tech authorized by JWT role claim, not header secret.
5. Re-test every page after RLS — this is the phase most likely to break things, hence staging-first once Phase 4 lands (until then: test window + fast rollback via git).

*Acceptance:* anon key alone can read nothing sensitive and write nothing. No secret string appears in any HTML or md file. One login system, three roles.

### Phase 2 — Data model: from cache to system of record (2–3 days)
1. **Stop delete+reinsert.** rsa-ticket-sync upserts on `ticket_number` (`ON CONFLICT DO UPDATE`), sets `updated_at`, and deletes only rows whose ticket_number vanished from source in the synced date range. Fixes: Realtime churn, egress churn, and the R2 overwrite bug's blast radius.
2. **Event log as truth for field actions.** `ticket_events` (rename/extend `rsa_tech_actions`): append-only — `on_my_way`, `on_site`, `completed`, with evidence refs. Techs ONLY insert events; nobody overwrites sync data.
3. **Effective status via view.** `rsa_tickets_live` computes: `effective_status = ` tech `completed` event (if newer than Metabase `resolved_at`) `→ DONE`, else Metabase status. Precedence is explicit and testable. The "tech-DONE reverts on next cron" bug becomes structurally impossible.
4. **Retention = archive, not delete** *(revised for predictive goals — see §7)*. Partition `rsa_ticket_locations`/`rsa_team_locations` by month; pg_cron exports partitions older than 90 days to Parquet in Supabase Storage, then detaches them. Hot DB stays small; history stays available for ML.
5. **Incremental Realtime (optional, after 1–3 stabilize):** with upserts, the client can patch rows by PK instead of full refetch. Keep the current clean-refetch until metrics say otherwise — it's simple and correct.

*Acceptance:* a tech marking DONE survives the next 50 cron runs. Realtime fires only for actually-changed rows. Location tables have bounded size.

### Phase 3 — Frontend consolidation: Vite multi-page + shared core (3–4 days)
1. Scaffold Vite MPA: each page = an entry (`rsa.html`, `tech.html`, ...). URLs on bounceops.online stay identical.
2. Extract `src/lib/` (TypeScript): `supabase.ts` (single client + env-injected keys), `auth.ts` (guard + role check), `time.ts` (`parseUtcTs`, `fmtTime`, `tatMins`, `fmtTat` — once), `mapkit.ts` (pins, flash rings, trails, recenter), `ui.css` (design tokens).
3. Migrate pages thin-slice: start with the two that share most (rsa + tech), then fw-map, then the rest. Each page migration is its own PR/commit — never a big bang.
4. Replace hand-rolled `rsa-sw.js`/`tech-sw.js` with `vite-plugin-pwa` (workbox) — also the most credible fix for the Android "Add to Home Screen" issue (correct scope/manifest/SW generation).
5. Deploy: GitHub Actions builds `dist/` → Pages. (Option: move hosting to Vercel for per-PR preview URLs — you already have the Vercel MCP connected. Pages is fine if previews don't matter yet.)

*Acceptance:* one fix to `time.ts` fixes all pages. New page = import lib + write the page-specific 200 lines. PWA installs as standalone on Android.

### Phase 4 — Environments + CI (1 day)
1. Staging backend: Supabase branch (Pro feature) or a second free-tier project, seeded by the Phase 0 migrations + a small sample-data script.
2. GitHub Actions: on PR → typecheck + build + deploy preview pointing at staging; on merge to `main` → deploy prod. Frontend picks SUPABASE_URL/key from build env.
3. A 20-line smoke script (hit `rsa_tickets_live`, check cron heartbeats) run post-deploy.

*Acceptance:* no change reaches the live warroom without having rendered once against staging.

### Phase 5 — Observability + cost control (1 day)
1. Sentry (free tier) in the shared lib — every page gets error reporting for free.
2. `sync_heartbeats` table: each cron/fn writes `(fn_name, ran_at, rows, ok, error)`. The existing Cowork 8 AM health check reads this instead of inferring from data freshness; alert thresholds per fn.
3. Egress guardrails: keep column-projected selects (already good), add `Cache-Control` on static assets via host config, monitor egress weekly in the health check.

### Phase 6 — Multi-city & product readiness (ongoing)
1. `cities` config table: code, name, map bounds, default center, zone polygons. Replaces hardcoded `inferCity` bounds, `city_id=1`, and BLR defaults. Adding a city = 1 row, 0 deploys.
2. `hubs` keyed by city (generalize `rental_locations`).
3. Tenancy stub: nullable `org_id` on core tables now (cheap), RLS-by-org later only if Fleetpro is ever sold outward.
4. Feature flags table (`flags: key, city, enabled`) for per-city rollout of e.g. tech PWA.

---

## 5. Decisions needed from Vamsee (before execution)

| Decision | Options | Architect's lean |
|----------|---------|------------------|
| D1 Hosting after build step | GitHub Pages (keep) vs Vercel (previews, headers) | Vercel — preview deploys are worth it solo; MCP already connected |
| D2 Staging backend | Supabase branch vs 2nd project | Branch (same project, Pro feature) — less key juggling |
| D3 TypeScript scope | lib-only vs everything | Lib-only TS, pages stay JS — best effort/benefit for Claude-driven dev |
| D4 Metabase dependency | Keep polling Metabase vs go direct to upstream (Bass API/DB) | Keep Metabase for now; isolate it behind the sync fn so swapping later touches one file |
| D5 Realtime strategy | Keep clean-refetch vs row-level patching | Keep refetch until egress/latency data says otherwise |

## 6. Execution notes for the Sonnet window

- Execute phases in order; within a phase, items are ordered. Each numbered item ≈ one commit.
- **Verify-first list** (assumptions this proposal makes — check before relying on them):
  1. Current RLS state of `rsa_tickets_cache`, `bike_rider_cache`, `fw_pending_cache` (use `get_advisors` + `list_tables` on project `clkfvmmlgwcvntxnolsv`).
  2. Whether tech.html's DONE write currently succeeds via anon or authenticated role.
  3. pg_cron SQL job `rsa-team-track-2min` owner/role (affects RLS re-enable in Phase 1.3).
  4. Supabase branching availability on current Pro plan.
- After each phase: update `Fleetpro-context.md` (status + gotchas), tag the repo (`phase-1-done`, ...).
- Don't start Phase 3 while Phase 2 migrations are in flight.

## 7. Data architecture for predictive systems (NEW — Phase 2½)

**Goal:** Vamsee wants to run predictive models once data is richer. The blocker isn't model tooling — it's that the current pipeline *destroys history continuously*. Data only gets "richer" if we start keeping it. These items belong inside Phase 2 (same migrations), which is why this is 2½, not a later phase.

### 7.1 What today's pipeline throws away
| Signal | Current behavior | Predictive value lost |
|--------|------------------|----------------------|
| Bike SOC + GPS over time | `bike_location_cache` overwritten every 5 min (latest-only); trails kept for only 2 RSA bikes | Battery degradation, breakdown precursors, usage patterns — the #1 ML asset |
| Ticket state transitions | delete+reinsert; only final Metabase timestamps survive | TAT prediction, demand curves, dispatch optimization |
| FW-pending lifecycle | full refresh every 15 min, no history | How long bikes stay FW-pending, recovery rates |
| Ticket-level raw payloads | discarded after upsert | Schema drift recovery, re-featurization later |

### 7.2 Additions to the schema (all append-only, all cheap)
1. **`bike_telemetry_history`** — the big one. After each bike-location-sync run, insert a *downsampled* snapshot: `(chassis_number, lat, lng, soc, vehicle_status, recorded_at)`. Hourly snapshot of ~9.8k bikes ≈ 235k rows/day is too much for hot Postgres long-term → monthly partitions + Parquet archival from day one. Start at 1-hour granularity (≈ 86M rows/yr → archived); raise to 15-min only for bikes with an open ticket.
2. **`ticket_status_history`** — trigger on `rsa_tickets` upsert: when `status` changes, append `(ticket_number, old_status, new_status, changed_at)`. Tiny table, complete transition log.
3. **`fw_pending_history`** — daily 1-row-per-bike snapshot of fw_pending_cache (date, chassis, hub, status). ~1.3k rows/day.
4. **`ticket_events`** (already in Phase 2) doubles as the **label store**: `resolution_type` + notes from techs = ground-truth outcome labels for fault-classification models. Enforce `resolution_type` as a constrained enum, not free text — label quality decides model quality.
5. **Entity spine:** a `vehicles` dimension table (`chassis_number` PK, reg_number, model, city, in_service_since). Today chassis/reg mapping lives scattered in caches; every ML join needs one canonical key.

### 7.3 Storage tiering (keeps Pro plan cheap)
```
HOT  (Postgres, ≤90 days):  operational tables + recent history partitions
WARM (Supabase Storage, Parquet): detached monthly partitions, exported by pg_cron + edge fn
QUERY: DuckDB reads Parquet directly for model training / backtests (laptop or notebook)
```
No warehouse needed yet. If/when scale demands one: BigQuery (a connector is already available in this Cowork setup) — the Parquet layer makes that migration trivial.

### 7.4 Predictive use cases this unlocks (in order of feasibility)
1. **Demand forecasting** — tickets per zone/hour from `rsa_tickets` history → where to pre-position Nishanth/Pavan. Feasible after ~2–3 months of accumulation.
2. **TAT / ETA prediction** — features: zone, hour, category, tech, distance (PostGIS); label: actual TAT. Already have partial data.
3. **Breakdown / battery prediction** — needs `bike_telemetry_history` + `dms_jc_history` + `vehicle_parts_check_flag` (you already collect the last two — they become features). Needs ~3–6 months of telemetry; **every week of delay = a week less training data**, hence Phase 2½ priority.
4. **Dispatch recommendation** — builds on 1+2.

### 7.5 Design rules for the Sonnet window
- History tables: INSERT-only, no UPDATE/DELETE grants to anyone but the archiver.
- Every history row carries `recorded_at timestamptz` (UTC) and the natural key — no surrogate-only rows.
- Never let an operational-UI need reshape a history table; build views instead.
- Add `synced_at` + raw-payload JSONB column on `rsa_tickets` upserts (last-seen raw) — cheap insurance for re-featurization.

## 8. Effort summary

| Phase | Effort | Risk reduced |
|-------|--------|--------------|
| 0 Git/migrations | 0.5d | R3 |
| 1 Security | 1–2d | R1 |
| 2 Data model | 2–3d | R2, R5 |
| 2½ ML data foundation | 1–1.5d | history loss (irreversible) |
| 3 Vite + shared lib | 3–4d | R4 (+ PWA bug) |
| 4 Envs + CI | 1d | R6 |
| 5 Observability | 1d | ops blind spots |
| 6 Multi-city | ongoing | scale ceiling |

~8–11 working days of Sonnet-window execution to a productized footing, shippable in slices with zero downtime.
