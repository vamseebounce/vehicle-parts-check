# 📑 Documentation Index — FleetPro

The single map of every FleetPro doc. ONE canonical context file, ONE checklist per
area. If you find a duplicate, fold it into the canonical and delete the copy.

> FleetPro is its OWN git repo (`vehicle-parts-check`) and deploys to GitHub Pages.
> It is gitignored by the outer Bounce repo — edit & commit *here*, push via the
> `/tmp` clone (see CLAUDE.md). Outer-repo commits never deploy.

## Engineering rules & locks
| Doc | Path | Purpose |
|-----|------|---------|
| Project memory / rules | `CLAUDE.md` | Auth pattern, deploy, tables, do-not-violate decisions. Always-loaded. |
| Edit locks | `LOCKS.md` | Claim a page before editing. Protocol at top. |
| This index | `docs/INDEX.md` | Map of all FleetPro docs. |

## Core context & roadmap
| Doc | Path | Canonical? | Purpose |
|-----|------|-----------|---------|
| FleetPro context | `Fleetpro-context.md` | ✅ | Live source-of-truth: groups, features, table schemas, session log |
| Architecture proposal | `ARCHITECTURE-PROPOSAL.md` | ✅ | 6-phase productization roadmap |
| Productization tracker | `PRODUCTIZATION-TASKS.md` | ✅ | THE checklist — phase status, open decisions D1–D6 |
| README | `README.md` | ✅ | Fresh-clone rebuild guide |

## Trace & Hunter module
| Doc | Path | Canonical? | Purpose |
|-----|------|-----------|---------|
| T&H context | `Trace and Hunter/context.md` | ✅ CANONICAL | Full Phase 1/2/3 spec |
| T&H improvements | `Trace and Hunter/IMPROVEMENTS.md` | ✅ | Review & rebuild plan |

## Admin Tools
| Doc | Path | Canonical? | Purpose |
|-----|------|-----------|---------|
| JC Approval context | `docs/jc-approval-context.md` | ✅ CANONICAL | Manual JC Approval Check — tiers, architecture, tables, Cowork↔Code collab |

## Launch notes
| Doc | Path | Purpose |
|-----|------|---------|
| In-trip soft launch | `Intrip_SoftLaunch_*.md` | Soft-launch announcement + note |

## ⚠️ Known cleanups
- A stale divergent copy of the T&H context exists in the **outer** repo at
  `../Trace & Hunder/context.md` (misspelled folder). The copy *here* is canonical.
- Future: when Phase 3 (Vite) lands, move `Fleetpro-context.md`, `ARCHITECTURE-PROPOSAL.md`,
  `PRODUCTIZATION-TASKS.md` into this `docs/` folder and update this index.
