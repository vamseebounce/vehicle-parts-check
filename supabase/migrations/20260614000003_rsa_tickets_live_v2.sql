-- 2.4: rsa_tickets_live v2 — add effective_status + ticket_events join
-- New columns appended at end (CREATE OR REPLACE VIEW constraint).
-- Existing columns unchanged — zero impact on tech.html or any current consumer.
--
-- New columns:
--   effective_status  — 'DONE' if latest event_type='completed', else t.status
--   latest_event_type — most recent ticket_events.event_type for this ticket
--   latest_event_at   — timestamp of that event
--   event_technician  — technician_name from that event
--
-- display_lat/lng now use effective_status logic (pin stays fixed once completed).

CREATE OR REPLACE VIEW rsa_tickets_live AS
SELECT
  t.ticket_number,
  t.status,
  t.category,
  t.reg_number,
  t.technician_name,
  t.fault_details,
  t.created_at_ist,
  t.inprogress_at_ist,
  t.resolved_at_ist,
  t.tat_minutes,
  t.city,
  t.synced_at,
  t.lat,
  t.lng,
  t.live_lat,
  t.live_lng,
  t.bass_location_time_ist AS loc_time,
  CASE
    WHEN CASE WHEN e.event_type = 'completed' THEN 'DONE' ELSE t.status END = 'DONE'
    THEN t.lat
    ELSE COALESCE(t.live_lat, t.lat)
  END AS display_lat,
  CASE
    WHEN CASE WHEN e.event_type = 'completed' THEN 'DONE' ELSE t.status END = 'DONE'
    THEN t.lng
    ELSE COALESCE(t.live_lng, t.lng)
  END AS display_lng,
  -- v2: appended columns
  CASE WHEN e.event_type = 'completed' THEN 'DONE' ELSE t.status END AS effective_status,
  e.event_type      AS latest_event_type,
  e.created_at      AS latest_event_at,
  e.technician_name AS event_technician
FROM rsa_tickets_cache t
LEFT JOIN LATERAL (
  SELECT event_type, created_at, technician_name
  FROM ticket_events
  WHERE ticket_number = t.ticket_number
  ORDER BY created_at DESC
  LIMIT 1
) e ON true;
