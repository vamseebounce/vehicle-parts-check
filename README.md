# FleetPro — Bounce Fleet Operations

Live ops platform for Bounce fleet management: RSA warroom, FW flash map, OOS queue, deployment tracker, and preventive maintenance.

**Live site:** https://bounceops.online

---

## Repo Structure

```
fleetpro/
├── v8/                          # Frontend (GitHub Pages)
│   ├── index.html               # Hub / landing (magic link auth)
│   ├── rsa.html                 # RSA Warroom (live ticket map)
│   ├── fw-map.html              # FW Flash Map (bike locations)
│   ├── tech.html                # Technician PWA
│   ├── admin-techs.html         # Tech account management
│   ├── maintenance.html         # Preventive maintenance checker
│   ├── queue.html               # OOS work queue
│   ├── deployment.html          # Deployment queue
│   └── logo.jpg                 # Brand logo
├── maintenance/index.html       # Redirect → /v8/maintenance.html
├── queue/index.html             # Redirect → /v8/queue.html
├── deployment/index.html        # Redirect → /v8/deployment.html
├── index.html                   # Root redirect → v8/index.html
├── logo.jpg                     # Root-level logo (for pages using ../logo.jpg)
├── CNAME                        # bounceops.online
├── supabase/
│   ├── functions/               # All 13 edge functions (Deno)
│   │   ├── rsa-ticket-sync/
│   │   ├── bike-location-sync/
│   │   ├── fw-sheet-sync/
│   │   ├── fw-map-rider-sync/
│   │   ├── fw-map-proxy/
│   │   ├── OOS_QUEUE/
│   │   ├── refresh-deployment-cache/
│   │   ├── metabase-sync/
│   │   ├── jc-history-sync/
│   │   ├── admin-create-tech/
│   │   ├── rsa-history/
│   │   ├── health-check/
│   │   └── db-health-check/
│   ├── migrations/
│   │   └── 00000000000000_baseline.sql   # Full schema snapshot
│   └── cron-jobs.sql            # All pg_cron job definitions
├── ARCHITECTURE-PROPOSAL.md     # Productization roadmap (Phase 0–6)
└── PRODUCTIZATION-TASKS.md      # Task tracker
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/JS/CSS, hosted on GitHub Pages |
| Auth | Supabase Auth (magic link for ops, email/password for techs) |
| Database | Supabase (Postgres + PostGIS) |
| Backend | Supabase Edge Functions (Deno) |
| Scheduling | pg_cron via Supabase |
| Maps | Leaflet (RSA/FW map) |
| Alerts | Resend (email) |
| Domain | bounceops.online → GitHub Pages via CNAME |

---

## Supabase Project

- **Project ID:** `clkfvmmlgwcvntxnolsv`
- **Region:** Tokyo (ap-northeast-1)
- **Plan:** Pro ($25/mo, 250GB egress)
- **Extensions required:** `postgis`, `pg_cron`, `pg_net`

---

## Bootstrap a New/Staging Project

### 1. Create Supabase project
Create a new project at https://supabase.com. Note the project URL and keys.

### 2. Apply baseline schema
In Supabase SQL editor, run:
```
supabase/migrations/00000000000000_baseline.sql
```
This creates all tables, views, functions, triggers, indexes, and RLS policies.

### 3. Set edge function secrets
In Supabase dashboard → Edge Functions → Secrets, add:

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key |
| `RESEND_API_KEY` | For alert emails (Resend.com) |
| `Login_key` | Admin secret for admin-create-tech fn (e.g. change from default) |

### 4. Deploy edge functions
```bash
supabase login
supabase link --project-ref <your-project-id>
supabase functions deploy --no-verify-jwt rsa-ticket-sync
supabase functions deploy --no-verify-jwt bike-location-sync
supabase functions deploy --no-verify-jwt fw-map-rider-sync
supabase functions deploy --no-verify-jwt fw-map-proxy
supabase functions deploy --no-verify-jwt refresh-deployment-cache
supabase functions deploy --no-verify-jwt rsa-history
supabase functions deploy --no-verify-jwt health-check
supabase functions deploy --no-verify-jwt db-health-check
supabase functions deploy fw-sheet-sync       # verify_jwt=true
supabase functions deploy OOS_QUEUE           # verify_jwt=true
supabase functions deploy metabase-sync
supabase functions deploy jc-history-sync
supabase functions deploy admin-create-tech
```

### 5. Set up cron jobs
Edit `supabase/cron-jobs.sql` — replace `<SERVICE_ROLE_KEY>` and `<ANON_KEY>` with your project's actual keys (from dashboard → Project Settings → API), then run in SQL editor.

### 6. Update frontend keys
In `v8/*.html`, replace the Supabase `SUPABASE_URL` and anon key constants with your new project's values. Search for `clkfvmmlgwcvntxnolsv` to find all occurrences.

---

## GitHub Pages Setup

1. Push repo to GitHub
2. Go to repo Settings → Pages → Source: `main` branch, root `/`
3. Add custom domain: `bounceops.online` (CNAME file already present)
4. Enable HTTPS

---

## Key Edge Functions

| Function | Schedule | Notes |
|----------|----------|-------|
| `rsa-ticket-sync` | `*/2 * * * *` | Core RSA sync from Metabase card f79c5050 |
| `bike-location-sync` | `0 * * * *` | ~10k bike GPS positions |
| `fw-sheet-sync` | `*/15 * * * *` | FW-pending from Google Sheet |
| `fw-map-rider-sync` | `0 * * * *` | Rider PII (name, phone) |
| `refresh-deployment-cache` | `*/15 * * * *` | Deployment + pending bookings |
| `OOS_QUEUE` | `5 * * * *` | OOS work queue |
| `metabase-sync` | `0 * * * *` | vehicle_parts_check_flag |
| `jc-history-sync` | `30 20 * * *` | Job card history (daily at 02:00 IST) |
| `health-check` | on-demand | DB health via RPC + Resend alert |
| `admin-create-tech` | on-demand | Create/manage technician accounts |

---

## RSA Team Bikes (GPS tracked)

| Name | Chassis | Reg |
|------|---------|-----|
| Nishanth | P6EBE1JYK25000288 | KA05AR5056 |
| Pavan | P6EBE1JYK25000072 | KA05AR3238 |

---

## Rollback Tags

| Tag | Description |
|-----|-------------|
| `phase-0.0` | Initial git push of v8 |
| `v8-final` | v8 tagged as stable baseline |
| `phase-0.3` | All 13 edge fns captured |
| `phase-0.4` | Baseline schema migration added |
| `phase-0.5` | Cron job definitions added |

---

## Auth

- **Ops users** (rsa.html, fw-map.html, index.html): Supabase magic link, restricted to `@bounceshare.com`
- **Technicians** (tech.html): email/password via `admin-create-tech` edge fn
- **Admin panel** (admin-techs.html): protected by `Login_key` env var secret

---

## Contacts

- Supabase project owner: vamsee@bounceshare.com
- Domain registrar: bounceops.online (check DNS for CNAME → vamseebounce.github.io)
