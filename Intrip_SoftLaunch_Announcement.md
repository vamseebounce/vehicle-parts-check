# Intrip Flow Enhancement — Soft Launch Note
**Date:** June 8, 2026  
**Launch Hub:** Bilekahalli  
**Status:** 🟡 Soft Launch (Phase 1 of 3)

---

## What We Launched

We soft-launched an enhancement to the **intrip repair flow** at Bilekahalli today.

The core change: **intrip vehicles are now marked OOS the moment repair is entered in OpsApp, and only move back to RFD once the Job Card is billed in DMS.**

This creates a proper handshake between vehicle-in and vehicle-out — something we didn't have before.

---

## Why This Matters for RRR

This directly impacts two of our biggest data quality problems:

- **Duplicate JCs** were inflating RR event counts and distorting failure reason data
- **Open JC pendency** was leaving repair events unresolved, hiding true first-fix rates
- **RFD validation bypass** during intrip meant bikes were going back to riders without quality checks

All three are now closed by this flow.

---

## New Flow (Simple Version)

```
Rider arrives with breakdown
        ↓
Ops agent creates intrip entry in OpsApp
        ↓
Bike moves to OOS automatically
        ↓
Service team repairs → DMS JC created and billed (same as before)
        ↓
Bike moves to RFD automatically on billing
        ↓
Rider gets bike back via Start Booking (with photos)
```

---

## Early Issues Flagged

Four issues surfaced during testing — none are blockers for Bilekahalli, but need fixes before scaling:

| Issue | Risk Level | Action Needed |
|-------|-----------|---------------|
| SOC < 10% blocks redeployment post-repair | Medium | Hub SOP for battery swap; or SOC override with approval |
| Only 2 HO approvers for JC — delays at peak | Medium | Expand approval authority to 4–5 per hub |
| JC billing lag at high volume | High (at scale) | Stress test at larger hub before Phase 2 |
| New photos overwrite original deployment photos | High | Fix photo archival before scaling — damage recovery risk |

---

## What's Next

- Monitor Bilekahalli for 1–2 weeks
- Resolve photo overwrite and approver bottleneck
- Phase 2 rollout to mid-volume hubs (TBD)
- Phase 3 full rollout

---

*Soft launch lead: Vamsee | +91 8956652852*
