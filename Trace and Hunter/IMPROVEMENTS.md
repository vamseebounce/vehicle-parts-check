# Trace & Hunter — Improvement Review & Rebuild Plan
*Created: 2026-06-18 · Reviewer pass after Phase 1 build*

## Constraints (do not violate)
1. **Map view + UI/UX must match RSA Warroom** (`v8/rsa.html`) — same components, interactions, look.
2. **No impact to other modules** — all changes additive (new tables/views/edge fns; never alter shared tables like `bike_location_cache`, `rental_locations`).
3. **Minimize Supabase RAM, push work to edge functions** — running on **Micro compute (~1 GB RAM)**. The DB is the constrained resource; edge functions run on separate infra.

---

## 🔴 Tier 1 — Supabase RAM / architecture (highest priority)

**Problem:** `trace-ho.html loadData()` runs 4+ queries with a **client-side join, per client, every 60s**:
1. all open `recovery_tickets` (all columns, all cities)
2. separate "recovered today" query
3. **batch loop** over `bike_location_cache` in chunks of 200 (`.in('reg_number',…)`) — repeated IN-scans of a ~9,800-row table
4. `zone_configs`

This is the opposite of RSA, where the **edge fn** pre-joins GPS during its cron → writes `rsa_tickets_cache`; the client reads **one** thin view (`rsa_tickets_live`) with a 1-min localStorage cache + fire-and-forget sync.

**Fix (additive):**
- New denormalized cache table **`recovery_tickets_cache`** (one row per open/recently-closed ticket, GPS already joined in: `display_lat/lng`, `gps_ts`, plus all display fields). Keep `marked_at_utc` raw so age is computed client-side (always current).
- Extend **`recovery-ticket-sync`** (already every 5 min): after Q1/Q2, rebuild the cache (delete + reinsert open tickets enriched from `bike_location_cache`).
- Client reads **one** query from the cache + localStorage cache + poll. Drops the N+1 batch loop and client-side join.
- Net on Micro: GPS join runs **1×/5min in edge fn** instead of **M clients × /60s**.
- Honors spec rule "GPS not stored on ticket" — the cache is an explicit refreshed snapshot, not the ticket source of truth.
- Same treatment for Hunter PWA (read its slice of the cache).

---

## 🟠 Tier 2 — UI/UX parity with RSA (full clone rebuild)

trace-ho today uses city **tabs** + zone-card **sidebar** + age chips. RSA uses global bar → clickable tiles → map-filter row → rich map. **Decision: rebuild trace-ho from `rsa.html` as the base template**, then adapt to recovery data.

| RSA feature | trace-ho today | Action |
|---|---|---|
| Global bar: city dropdown + date + Refresh + sync badge | city tabs, no date | Rebuild as RSA global bar |
| Multi-select filter dropdowns | age/status chips | Adopt RSA `getChecked`/dropdown components |
| Tile click → flash pins 5s | tiles filter | Add `flashStatus()` |
| Search → zoom + ring flash | substring filter | Adopt `searchZoom()` |
| 🛤 Track panel (slide-in) | none | Add (hunter trail / ticket trail) |
| Layers panel | none | Add (pins/zones/hubs/hunters toggles) |
| Hub markers (`rental_locations`) | none | Add |
| Live agent dots | none | Add `hunter_locations` table + HO dots |
| Popup: Directions/Copy/Track | Maps/Call only | Match RSA popup |
| `parseUtcTs()` | raw `new Date()` | Adopt — see Tier 3 |

Keep recovery-specific bits: pin colors by `hours_in_recovery` (amber/coral/orange/red), Voronoi zone overlays, Location-Unknown list.

---

## 🟡 Tier 3 — Correctness bugs

1. **Safari/iOS NaN timestamp bug.** `new Date('2026-06-18 14:15:57+00')` → `NaN` in Safari. Trace uses raw `new Date(marked_at_utc)` everywhere (trace-ho + Hunter PWA, which is iOS-installable) → ages/pin colors break on iPhone. **Adopt RSA's `parseUtcTs()`.** High impact, low effort.
2. **Hunter location never persisted** — `watchPosition` updates only the local marker; HO can't show agent dots. Add `hunter_locations` table; Hunter writes throttled GPS; HO renders dots (RSA team-dot parity).
3. **No localStorage cache** on either Trace page → every refresh/tab-switch is a fresh DB hit (RAM + egress).
4. **Out-of-range GPS distorted the HO map (FIXED 2026-06-19, deployed `6ca86db`).** The only marker guard was `display_lat==null`, so a ticket with `0,0` / swapped / out-of-range coords still plotted a pin **and** entered `bounds` → `fitBounds` zoomed out to world view. Added `validLL(lat,lng)` (India bbox lat 6.5–37.5, lng 68–97.5) on every marker / `fitBounds` path (tickets, hubs, hunter dots, hunter trail, critical-flash, search-zoom); invalid-GPS tickets now route to the Location-Unknown list.

---

## 🟢 Tier 4 — Quick wins
- Scope reads by city/cache server-side (not all-cities-then-filter-client-side).
- Trim selected columns to what's rendered.
- Use raw `fetch` + anon key for reads (lighter than supabase-js), matching RSA.

---

## Rebuild sequence (chosen: Full RSA-clone)
1. **Backend cache** — migration: `recovery_tickets_cache` + thin `recovery_tickets_live` view + `hunter_locations` table; extend `recovery-ticket-sync` to populate cache + GPS enrichment.
2. **trace-ho rebuild** — clone rsa.html shell (global bar, tiles, filters, track/layers panels, cache+poll, `parseUtcTs`), adapt to recovery data + Voronoi + Location-Unknown.
3. **Hunter PWA** — adopt `parseUtcTs`, write `hunter_locations`, read cache slice.
4. Push + deploy (migrations, edge fn redeploy).
