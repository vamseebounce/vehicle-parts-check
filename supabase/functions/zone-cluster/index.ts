/**
 * zone-cluster — Trace & Hunter
 * Runs at 6 PM IST (12:30 UTC) daily — Step 1 of the 6 PM sequence.
 * MUST run after recovery-blocked-sync (Step 0).
 *
 * Per city (NCR=1, BLR=2, HYD=5):
 *   1. Resolve active hunters from roster (overrides → template fallback)
 *   2. Load open recovery tickets + GPS from bike_location_cache
 *   3. Balanced k-means (k = active hunter count, max 4)
 *   4. Label clusters NE/NW/SE/SW relative to dynamic center (dot-product)
 *   5. Assign hunters to zones (by roster preference, then sequential)
 *   6. Upsert zone_configs rows
 *   7. UPDATE recovery_tickets: set zone + assigned_hunter_id + status='assigned'
 *      WHERE zone IS NULL AND city matches (unassigned tickets only)
 *
 * Tickets with null GPS stay zone=NULL / status='marked' (visible in "Location unknown" list).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Delaunay } from 'https://esm.sh/d3-delaunay@6'

const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// City definitions — id must match DMS city table
const CITIES = [
  { id: 1, aliases: ['ncr', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'faridabad'] },
  { id: 2, aliases: ['bangalore', 'bengaluru', 'blr'] },
  { id: 5, aliases: ['hyderabad', 'hyd', 'secunderabad'] },
]

// Resolve city_id from a city_name string (case-insensitive)
function resolveCityId(cityName: string | null): number | null {
  if (!cityName) return null
  const lower = cityName.toLowerCase().trim()
  for (const city of CITIES) {
    if (city.aliases.some(a => lower.includes(a))) return city.id
  }
  return null
}

// ── Haversine ────────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const a = sinDLat * sinDLat +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * sinDLng * sinDLng
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

// ── Balanced k-means ──────────────────────────────────────────────────────────
// Returns cluster index (0..k-1) for each point. Deterministic init (max-spread).
function balancedKMeans(
  points: Array<{ lat: number; lng: number }>,
  k: number,
  maxIter = 25
): number[] {
  const n = points.length

  // Edge cases
  if (k <= 0 || n === 0) return []
  if (k >= n) return points.map((_, i) => i % k)
  if (k === 1) return new Array(n).fill(0)

  // Init: deterministic max-spread centroids
  // First centroid: point closest to the mean of all points
  const meanLat = mean(points.map(p => p.lat))
  const meanLng = mean(points.map(p => p.lng))
  let firstIdx = 0
  let minD = Infinity
  for (let i = 0; i < n; i++) {
    const d = haversineKm(points[i].lat, points[i].lng, meanLat, meanLng)
    if (d < minD) { minD = d; firstIdx = i }
  }

  const centroidIndices: number[] = [firstIdx]
  for (let c = 1; c < k; c++) {
    // Pick the point with max min-distance to existing centroids
    let maxD = -Infinity, chosen = 0
    for (let i = 0; i < n; i++) {
      const minDistToExisting = Math.min(
        ...centroidIndices.map(ci =>
          haversineKm(points[i].lat, points[i].lng, points[ci].lat, points[ci].lng)
        )
      )
      if (minDistToExisting > maxD) { maxD = minDistToExisting; chosen = i }
    }
    centroidIndices.push(chosen)
  }

  let centroids = centroidIndices.map(i => ({ lat: points[i].lat, lng: points[i].lng }))
  let assignments = new Array(n).fill(0)
  const targetMax = Math.ceil(n / k)
  const targetMin = Math.floor(n / k)

  for (let iter = 0; iter < maxIter; iter++) {
    // ── Assign each point to nearest centroid ──
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity
      for (let c = 0; c < k; c++) {
        const d = haversineKm(points[i].lat, points[i].lng, centroids[c].lat, centroids[c].lng)
        if (d < bestD) { bestD = d; best = c }
      }
      assignments[i] = best
    }

    // ── Rebalance oversized clusters ──
    const sizes = new Array(k).fill(0)
    for (const a of assignments) sizes[a]++

    let anyMoved = false
    for (let c = 0; c < k; c++) {
      while (sizes[c] > targetMax) {
        // Find the point in cluster c closest to another underfull cluster's centroid
        let bestPt = -1, bestDest = -1, bestCost = Infinity

        for (let i = 0; i < n; i++) {
          if (assignments[i] !== c) continue
          const curDist = haversineKm(points[i].lat, points[i].lng, centroids[c].lat, centroids[c].lng)

          for (let c2 = 0; c2 < k; c2++) {
            if (c2 === c || sizes[c2] >= targetMax) continue
            const newDist = haversineKm(points[i].lat, points[i].lng, centroids[c2].lat, centroids[c2].lng)
            // Cost = distance increase for moving this point
            const cost = newDist - curDist
            if (cost < bestCost) {
              bestCost = cost
              bestPt = i
              bestDest = c2
            }
          }
        }

        if (bestPt === -1) break // No valid swap
        assignments[bestPt] = bestDest
        sizes[c]--
        sizes[bestDest]++
        anyMoved = true
      }
    }

    // ── Recompute centroids ──
    const prevCentroids = centroids.map(c => ({ ...c }))
    for (let c = 0; c < k; c++) {
      const pts = points.filter((_, i) => assignments[i] === c)
      if (pts.length === 0) continue
      centroids[c] = { lat: mean(pts.map(p => p.lat)), lng: mean(pts.map(p => p.lng)) }
    }

    // Convergence check
    const moved = centroids.some((c, i) =>
      haversineKm(c.lat, c.lng, prevCentroids[i].lat, prevCentroids[i].lng) > 0.05
    )
    if (!moved && !anyMoved) break
  }

  return assignments
}

// ── Zone labeling (NE/NW/SE/SW) ──────────────────────────────────────────────
// Assigns each centroid a zone label using dot-product scoring vs quadrant direction.
// Handles k < 4 cleanly — each centroid gets the best-fit label without collision.
function labelClusters(
  centroids: Array<{ lat: number; lng: number }>,
  center: { lat: number; lng: number }
): string[] {
  const ALL_LABELS = ['NE', 'NW', 'SE', 'SW']
  const VECTORS: Record<string, { dlat: number; dlng: number }> = {
    'NE': { dlat: 1, dlng: 1 },
    'NW': { dlat: 1, dlng: -1 },
    'SE': { dlat: -1, dlng: 1 },
    'SW': { dlat: -1, dlng: -1 },
  }

  const k = centroids.length
  const labels = new Array<string>(k)
  const usedLabels = new Set<string>()
  const usedCi = new Set<number>()

  // Score all (centroid, label) pairs
  type Scored = { ci: number; label: string; score: number }
  const scored: Scored[] = []

  for (let ci = 0; ci < k; ci++) {
    const dlat = centroids[ci].lat - center.lat
    const dlng = centroids[ci].lng - center.lng
    for (const label of ALL_LABELS) {
      const v = VECTORS[label]
      scored.push({ ci, label, score: dlat * v.dlat + dlng * v.dlng })
    }
  }

  // Greedy assignment: best score wins, no repeats
  scored.sort((a, b) => b.score - a.score)
  for (const s of scored) {
    if (usedCi.has(s.ci) || usedLabels.has(s.label)) continue
    labels[s.ci] = s.label
    usedCi.add(s.ci)
    usedLabels.add(s.label)
    if (usedCi.size === k) break
  }

  return labels
}

// ── Roster loading ────────────────────────────────────────────────────────────
interface HunterSlot { hunter_id: string; preferred_zones: string[] }

async function getActiveHunters(
  sb: ReturnType<typeof createClient>,
  cityId: number,
  todayDateStr: string, // 'YYYY-MM-DD'
  todayDow: number      // 0=Sun
): Promise<HunterSlot[]> {
  // Load overrides for today
  const { data: overrides } = await sb
    .from('roster_overrides')
    .select('hunter_id, zones, status')
    .eq('city_id', cityId)
    .eq('date', todayDateStr)

  const overrideMap = new Map<string, { zones: string[]; status: string }>()
  for (const o of (overrides ?? [])) {
    overrideMap.set(o.hunter_id, { zones: o.zones ?? [], status: o.status })
  }

  // Load template for today's day_of_week
  const { data: templates } = await sb
    .from('roster_template')
    .select('hunter_id, default_zones')
    .eq('city_id', cityId)
    .eq('day_of_week', todayDow)

  const hunters: HunterSlot[] = []
  const seen = new Set<string>()

  // Override-first: only include active hunters
  for (const [hunterId, override] of overrideMap.entries()) {
    seen.add(hunterId)
    if (override.status === 'active') {
      hunters.push({ hunter_id: hunterId, preferred_zones: override.zones })
    }
    // 'leave' or 'weekoff' → skip (marked seen so template doesn't reinstate)
  }

  // Template fallback for hunters without an override today
  for (const t of (templates ?? [])) {
    if (seen.has(t.hunter_id)) continue
    if ((t.default_zones ?? []).length > 0) {
      hunters.push({ hunter_id: t.hunter_id, preferred_zones: t.default_zones ?? [] })
    }
  }

  return hunters
}

// ── Hunter → Zone assignment ──────────────────────────────────────────────────
// Tries to honour roster zone preferences; falls back to sequential.
function assignHuntersToZones(
  hunters: HunterSlot[],
  zoneLabels: string[]
): Map<string, string> { // zone_label → hunter_id
  const result = new Map<string, string>()
  const usedHunters = new Set<string>()

  // Pass 1: preference match
  for (const label of zoneLabels) {
    const preferred = hunters.find(
      h => !usedHunters.has(h.hunter_id) && h.preferred_zones.includes(label)
    )
    if (preferred) {
      result.set(label, preferred.hunter_id)
      usedHunters.add(preferred.hunter_id)
    }
  }

  // Pass 2: sequential fill for unmatched zones
  for (const label of zoneLabels) {
    if (result.has(label)) continue
    const available = hunters.find(h => !usedHunters.has(h.hunter_id))
    if (available) {
      result.set(label, available.hunter_id)
      usedHunters.add(available.hunter_id)
    }
  }

  return result
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
async function writeHeartbeat(
  sb: ReturnType<typeof createClient>,
  status: string,
  durationMs: number,
  rows: number | null = null,
  errorMessage: string | null = null
) {
  try {
    await sb.from('sync_heartbeats').insert({
      function_name: 'zone-cluster',
      status,
      duration_ms: durationMs,
      rows_affected: rows,
      error_message: errorMessage,
      synced_at: new Date().toISOString(),
    })
  } catch (_) {}
}

// ── Main ──────────────────────────────────────────────────────────────────────
Deno.serve(async (_req) => {
  const t0 = Date.now()
  const sb = createClient(SB_URL, SB_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    // Today in IST (UTC+5:30)
    const nowUtc = new Date()
    const nowIst = new Date(nowUtc.getTime() + 5.5 * 60 * 60 * 1000)
    const todayDateStr = nowIst.toISOString().slice(0, 10) // 'YYYY-MM-DD'
    const todayDow = nowIst.getUTCDay() // 0=Sun … 6=Sat

    // ── Load all open recovery tickets ──
    const { data: allTickets, error: ticketErr } = await sb
      .from('recovery_tickets')
      .select('id, bike_id, reg_number, city_name, zone, status, assigned_hunter_id')
      .not('status', 'in', '("cancelled","at_hub")')

    if (ticketErr) throw new Error(`Failed to load tickets: ${ticketErr.message}`)
    if (!allTickets?.length) {
      await writeHeartbeat(sb, 'ok', Date.now() - t0, 0, 'No open tickets')
      return new Response(JSON.stringify({ ok: true, note: 'No open tickets' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── Load GPS from bike_location_cache ──
    const regNumbers = [...new Set(allTickets.map(t => t.reg_number).filter(Boolean))]
    const { data: gpsRows } = await sb
      .from('bike_location_cache')
      .select('reg_number, lat, lng, baas_location_time')
      .in('reg_number', regNumbers)

    const gpsMap = new Map<string, { lat: number; lng: number; ts: string | null }>(
      (gpsRows ?? [])
        .filter(g => g.lat != null && g.lng != null)
        .map(g => [g.reg_number, { lat: Number(g.lat), lng: Number(g.lng), ts: g.baas_location_time }])
    )

    // ── Load blocked vehicles ──
    const { data: blocked } = await sb
      .from('recovery_blocked_vehicles')
      .select('reg_number')
    const blockedSet = new Set((blocked ?? []).map((b: any) => b.reg_number.trim().toUpperCase()))

    // ── Group tickets by city_id ──
    const byCityId = new Map<number, typeof allTickets>()
    for (const ticket of allTickets) {
      const cityId = resolveCityId(ticket.city_name)
      if (!cityId) continue
      if (!byCityId.has(cityId)) byCityId.set(cityId, [])
      byCityId.get(cityId)!.push(ticket)
    }

    let totalAssigned = 0
    const cityResults: any[] = []

    // ── Process each city ──
    for (const { id: cityId } of CITIES) {
      const cityTickets = byCityId.get(cityId) ?? []
      if (cityTickets.length === 0) {
        cityResults.push({ city_id: cityId, skipped: 'no_tickets' })
        continue
      }

      // Get active hunters
      const hunters = await getActiveHunters(sb, cityId, todayDateStr, todayDow)
      if (hunters.length === 0) {
        cityResults.push({ city_id: cityId, skipped: 'no_active_hunters', tickets: cityTickets.length })
        continue
      }

      const k = Math.min(hunters.length, 4) // max 4 zones (schema constraint)

      // Points with GPS, excluding blocked
      const eligible = cityTickets.filter(t =>
        t.reg_number &&
        !blockedSet.has(t.reg_number.trim().toUpperCase()) &&
        gpsMap.has(t.reg_number)
      )

      if (eligible.length === 0) {
        cityResults.push({ city_id: cityId, skipped: 'no_gps_points', hunters: hunters.length })
        continue
      }

      const points = eligible.map(t => gpsMap.get(t.reg_number)!)

      // Dynamic center = mean of all eligible vehicle GPS
      const dynamicCenter = {
        lat: mean(points.map(p => p.lat)),
        lng: mean(points.map(p => p.lng)),
      }

      // Balanced k-means
      const effectiveK = Math.min(k, eligible.length) // can't have more clusters than points
      const assignments = balancedKMeans(points, effectiveK)

      // Compute cluster centroids and sizes
      const clusterPoints: Array<Array<{ lat: number; lng: number }>> = Array.from(
        { length: effectiveK }, () => []
      )
      for (let i = 0; i < eligible.length; i++) {
        clusterPoints[assignments[i]].push(points[i])
      }

      const centroids = clusterPoints.map(pts => ({
        lat: mean(pts.map(p => p.lat)),
        lng: mean(pts.map(p => p.lng)),
      }))

      // Label clusters NE/NW/SE/SW
      const zoneLabels = labelClusters(centroids, dynamicCenter)

      // Assign hunters to zones
      const zoneHunterMap = assignHuntersToZones(hunters.slice(0, effectiveK), zoneLabels)

      // ── Voronoi tessellation (MECE zone boundaries) ──
      // Cells are computed for the cluster centroids, clipped to a padded
      // bounding box around the city's vehicles. Stored as GeoJSON Polygons
      // ([lng,lat] rings) in boundary_polygon.
      const cellPolys: (number[][] | null)[] = new Array(effectiveK).fill(null)
      try {
        const pad = 0.15 // ~16 km padding so cells cover the whole city
        const lats = points.map(p => p.lat)
        const lngs = points.map(p => p.lng)
        const bbox: [number, number, number, number] = [
          Math.min(...lngs) - pad, Math.min(...lats) - pad,
          Math.max(...lngs) + pad, Math.max(...lats) + pad,
        ]
        if (effectiveK === 1) {
          // Single zone → the whole bbox is its cell.
          const [x0, y0, x1, y1] = bbox
          cellPolys[0] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
        } else {
          const vpts = centroids.map(c => [c.lng, c.lat]) // [x=lng, y=lat]
          const delaunay = Delaunay.from(vpts)
          const voronoi = delaunay.voronoi(bbox)
          for (let ci = 0; ci < effectiveK; ci++) {
            const poly = voronoi.cellPolygon(ci) // closed ring of [lng,lat] or null
            cellPolys[ci] = poly ? poly.map((pt: number[]) => [pt[0], pt[1]]) : null
          }
        }
      } catch (e) {
        console.error(`Voronoi failed for city ${cityId}:`, (e as any)?.message)
      }

      // ── Upsert zone_configs ──
      const zoneConfigRows = zoneLabels.map((label, ci) => ({
        date:               todayDateStr,
        city_id:            cityId,
        zone_label:         label,
        hunter_id:          zoneHunterMap.get(label) ?? null,
        centroid_lat:       centroids[ci].lat,
        centroid_lng:       centroids[ci].lng,
        dynamic_center_lat: dynamicCenter.lat,
        dynamic_center_lng: dynamicCenter.lng,
        vehicle_count:      clusterPoints[ci].length,
        boundary_polygon:   cellPolys[ci] ? { type: 'Polygon', coordinates: [cellPolys[ci]] } : null,
      }))

      const { error: upsertErr } = await sb
        .from('zone_configs')
        .upsert(zoneConfigRows, { onConflict: 'date,city_id,zone_label' })

      if (upsertErr) {
        console.error(`zone_configs upsert failed for city ${cityId}:`, upsertErr.message)
        cityResults.push({ city_id: cityId, error: upsertErr.message })
        continue
      }

      // ── Build ticket → (zone, hunter) map from k-means results ──
      // eligible[i] → assignments[i] → zoneLabels[assignments[i]]
      const ticketZoneMap = new Map<string, { zone: string; hunter_id: string | null }>()
      for (let i = 0; i < eligible.length; i++) {
        const ci = assignments[i]
        const label = zoneLabels[ci]
        const hunterId = zoneHunterMap.get(label) ?? null
        ticketZoneMap.set(eligible[i].id, { zone: label, hunter_id: hunterId })
      }

      // ── UPDATE recovery_tickets WHERE zone IS NULL ──
      // Only assign unassigned tickets — don't disturb already-assigned ones
      const toAssign = cityTickets.filter(t => t.zone === null || t.zone === undefined)
      let assignedCount = 0

      for (const ticket of toAssign) {
        const mapping = ticketZoneMap.get(ticket.id)
        if (!mapping) continue // no GPS → stays unassigned

        const { error: upErr } = await sb
          .from('recovery_tickets')
          .update({
            zone:               mapping.zone,
            assigned_hunter_id: mapping.hunter_id,
            city_id:            cityId,
            status:             'assigned',
            assigned_at:        new Date().toISOString(),
            is_base_list:       true, // this is the 6 PM daily base list
          })
          .eq('id', ticket.id)
          .eq('status', 'marked') // only advance from 'marked' (idempotent)

        if (upErr) {
          console.error(`Failed to assign ticket ${ticket.id}:`, upErr.message)
          continue
        }

        assignedCount++
        totalAssigned++

        // Log assignment event
        if (mapping.hunter_id) {
          await sb.from('recovery_ticket_events').insert({
            ticket_id:  ticket.id,
            event_type: 'reassigned',
            created_by: null,
            metadata:   {
              source:     'cron_zone_cluster',
              zone:       mapping.zone,
              hunter_id:  mapping.hunter_id,
              city_id:    cityId,
            },
          })
        }
      }

      cityResults.push({
        city_id:       cityId,
        k:             effectiveK,
        zones:         zoneLabels,
        eligible:      eligible.length,
        no_gps:        cityTickets.length - eligible.length,
        assigned_now:  assignedCount,
        already_had_zone: cityTickets.filter(t => t.zone != null).length,
      })
    }

    await writeHeartbeat(sb, 'ok', Date.now() - t0, totalAssigned)
    return new Response(
      JSON.stringify({ ok: true, total_assigned: totalAssigned, cities: cityResults }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('zone-cluster error:', err)
    await writeHeartbeat(sb, 'error', Date.now() - t0, null, err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
