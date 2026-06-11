# Analyst Note — Intrip New Flow: Soft Launch Update
**Date:** June 8, 2026  
**Hub:** Bilekahalli (Soft Launch)  
**Shared by:** Vamsee | +91 8956652852

---

## What Changed

The intrip repair flow has been enhanced to create a tighter handshake between vehicle repair and redeployment.

**Previously:** A bike received for intrip repair could be redeployed before the Job Card (JC) was billed, leading to duplicate JC entries, open pendencies, and no RFD validation during the intrip window.

**Now (New Flow):**
1. Intrip entry created in OpsApp → bike status moves to **OOS (Out of Service)** immediately
2. Service team completes repair → DMS Job Card created and billed (existing process, no change)
3. Once JC is **billed**, bike automatically moves back to **RFD**
4. Rider receives vehicle via **Start Booking** section in OpsApp, with mandatory photo capture

---

## Problems This Solves

| # | Problem | How It's Fixed |
|---|---------|----------------|
| 1 | Duplicate intrip job cards being created | Once a bike is marked intrip, duplicate entry is blocked |
| 2 | Incorrect items in duplicate JCs | Single entry enforced — ops agent must collect all info upfront |
| 3 | No handshake between vehicle in and out | OOS → RFD transition is now gated by JC billing |
| 4 | Open JC pendency | Bike stays OOS until JC is billed — creates natural accountability |
| 5 | RFD validation skipped during intrip | RFD validation now runs for intrip bikes as well |

---

## Issues Observed During Testing

### 1. SOC Restriction Blocking Redeployment
- RFD validation requires SOC > 10%
- Intrip bikes often arrive with SOC below 10%
- System blocks redeployment even after JC is billed
- **Impact:** Rider wait time increases; hub needs to swap battery before redeployment
- **Mitigation needed:** Hub teams must ensure adequate charged batteries are available

### 2. HO Approval Bottleneck
- Only 2 HO personnel authorised to approve JCs in DMS
- Delays observed during peak hours
- Creates queuing at the approval stage, slowing the OOS → RFD transition
- **Impact:** Riders waiting longer than expected post-repair
- **Flag:** Approval authority may need to be expanded or delegated at hub level

### 3. JC Billing Lag at High Volume
- Service Managers face difficulty updating JC to "Billed" status in real time during high inflow
- Currently manageable at Bilekahalli (low-medium volume)
- **Risk:** Will become a bottleneck at larger hubs (Hoodi, Saket, Okhla) with higher RR volumes
- **Flag:** Process needs to be stress-tested at high-volume hubs before full rollout

### 4. Vehicle Photo Override Issue
- Post-repair, photos must be re-uploaded via both Executive App and Rider App
- New photos **overwrite the original deployment photos**
- Original deployment evidence is lost — creates risk during vehicle submission and damage assessment
- **Impact:** Damage cost recovery becomes harder; no baseline comparison available
- **Flag:** This is a data integrity issue that needs a fix before scaling — original photos must be preserved separately

---

## Test Scenarios Validated (from Testing PDF)

| Scenario | Result |
|----------|--------|
| Standard intrip repair flow: OpsApp entry → OOS → JC billed → RFD → Start Booking | ✅ Working |
| Attempted bike deployment while in OOS | ✅ Correctly blocked |
| Change bike before JC is closed/billed | ✅ Blocked (OOS error shown) |
| Change bike after JC is closed/billed | ⚠️ Allowed — needs review (booking table shows change) |
| Vehicle exchange scenario | ✅ Tested |
| Start Booking photo flow (covers last touch point other than deployment) | ✅ Working — bonus fix confirmed |
| End trip flow | ✅ Tested |

---

## Launch Phasing

Three-phase launch planned. Bilekahalli is Phase 1 (soft launch). Broader rollout pending resolution of identified issues.

---

## Recommended Actions Before Next Phase

1. **SOC issue:** Define a hub SOP for battery swap during intrip before redeployment — or add a SOC override with manager approval
2. **HO approval:** Review and expand approval authority to at least 4–5 persons per hub for peak coverage
3. **Photo integrity:** Build a fix to archive original deployment photos separately before intrip photos overwrite them
4. **JC billing lag:** Run a load test simulation at a higher-volume hub before Phase 2 rollout
5. **Single-entry enforcement:** Train ops agents on collecting all repair information in one go before creating OpsApp entry

---

*Note compiled from soft launch comms and testing documentation. For questions, contact Vamsee @ +91 8956652852.*
