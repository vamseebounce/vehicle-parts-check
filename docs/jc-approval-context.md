# Manual JC Approval Check — Context File

> Canonical context for the JC Approval feature. ONE source of truth for both
> **Cowork** (desktop) and **Claude Code** (terminal). If you learn something new about
> this feature, update THIS file — don't scatter it.
>
> FleetPro is its OWN git repo (`vehicle-parts-check`). Edit & commit here, push via the
> `/tmp` clone (CLAUDE.md). Claim `jc-approval.html` in `LOCKS.md` before editing the page.

## What Is This

A superadmin-only tool that replaces **manual manager review** of "create a manual draft
JC" requests. A manager searches a vehicle (reg / chassis) and gets an automated
**verdict** on whether the draft JC should be approved — instead of hand-checking
booking, payment, and DMS-push state in multiple systems.

Live at: `https://bounceops.online/v8/jc-approval.html`
Sidebar: **Admin** section → "JC Approval Check". Tracker: `PRODUCTIZATION-TASKS.md` → A1.

## The Verdict Waterfall (stable tier codes T0–T6)

Codes are **stable routing keys** — never renumber. Defined in the SQL CASE
(`sql/rrr/RRR_Manual_JC_Approval_Check.sql`); UI labels/colors in `jc-approval.html`
(`TIER_STYLE`). Keep all three in sync.

| Tier | UI label | Verdict | Meaning / action |
|---|---|---|---|
| T1 | Booking in progress | **NOT APPROVED** | Rider is out now — never JC a live trip |
| T2 | Prior JC deleted | **CHECK & APPROVE** | Latest JC was deleted — safe to recreate |
| T3 | Draft already exists | **NO ACTION** | Draft exists for this trip; share Draft JC id w/ DMS team |
| T4 | DMS push failed | **APPROVE** | Auto-push failed — recreate is the fix |
| T5a | Payment pending | **DO NOT CREATE** | Pending, payment due |
| T5b | Push stuck (≥10m) | **CHECK & CREATE** | Pending, push stuck |
| T5c | Push in flight (<10m) | **WAIT** | Pending, push still in flight |
| T0 | No JC found | **REVIEW MANUALLY** | No JC on the bike |
| T6 | Needs manual review | **REVIEW MANUALLY** | Status not covered by the waterfall |

**Dual-booking model (do not collapse):** "is the rider out now?" uses the vehicle's
*current* booking; "was a draft made for this trip?" uses the JC's own `booking_id`.
These are different anchors — a JC from months ago must not be matched against today's
booking.

## Architecture (security-reviewed — NO public Metabase card in the client)

```
PRIVATE Metabase card (UUID c100308c-…)        ← card UUID lives ONLY in the edge fn
        │  CSV, server-side fetch
        ▼
jc-approval-sync edge fn  (cron JOB 20, every 5 min)
        │  rebuild (delete+reinsert)            diff
        ▼                                        ▼
jc_approval_status (1 row/vehicle)        jc_approval_alerts (append-only, T4/T5b/T6)
        │  session token + RLS (authenticated-read)
        ▼
jc-approval.html  (superadmin-gated via is_superadmin app_metadata)
```

- **Query**: `sql/rrr/RRR_Manual_JC_Approval_Check.sql` (outer Bounce repo, `sql/rrr/`).
- **Edge fn**: `supabase/functions/jc-approval-sync/index.ts`. `ALERT_TIERS = {T4, T5b, T6}`.
  Deployed via MCP (see memory `edge-fn-deploy-via-mcp`); git is source-of-record only.
- **Migration**: `supabase/migrations/20260619000001_jc_approval.sql`.
- **Cron**: JOB 20 `jc-approval-sync-5min` (`*/5 * * * *`) in `supabase/cron-jobs.sql`.
- **Frontend** mirrors `maintenance.html` design language: FleetPro topbar + hamburger,
  centered search hero, random "Try:" pills (only vehicles with a draft JC), last-synced
  line, site-footer. Search via Enter or the magnifier icon (there is NO Check button —
  a dead `search-btn` ref once crashed `runCheck()`; don't reintroduce it).

## Tables

`jc_approval_status` — PK `reg_number`; cols incl. `chassis_number, latest_draft_jc,
latest_jc_status, jc_created_ist, current_booking_status, jc_trip_ended_ist, dms_json,
jc_age_minutes, rental_status, vehicle_status, vehicle_sub_status, tier, verdict, reason,
refreshed_at`. Rebuilt every sync. Indexed on `chassis_number`, `tier`.

`jc_approval_alerts` — append-only log of actionable tiers. `UNIQUE (latest_draft_jc,
tier)` → one open alert per tier per JC. `alerted_at` set when notified; `resolved_at`
set when the tier clears.

## Collaboration (Cowork ↔ Code)

1. **One context file**: this doc. Read before working; update after.
2. **Lock before editing the page**: claim `jc-approval.html` in `LOCKS.md`, commit that
   first. If locked by the other window → STOP and wait. Release with `(free)` when done.
3. **Deploy**: push via the `/tmp` clone (FUSE-lock workaround). Edge-fn changes go live
   via MCP redeploy; the git push is source-of-record only.
4. **Validate before push**: balanced tags + `node --check` on inline `<script>` blocks.

## Pending

- ⬜ Email notification on new T4/T5b/T6 alerts (`TODO(email)` in the edge fn — transport
  not wired; the append-only log works without it).
- ⬜ Alert Centre page (reads `jc_approval_alerts`, lists actionable situations).
- ⬜ Recently added: sectioned layout + ODO + hub + location + search normalization
  (in `jc-approval.html`) — fold any follow-ups here.
