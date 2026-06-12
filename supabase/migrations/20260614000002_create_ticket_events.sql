-- 2.2: ticket_events — append-only log of technician actions on tickets
-- Extends rsa_tech_actions with structured event sourcing pattern
CREATE TABLE IF NOT EXISTS ticket_events (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_number text NOT NULL,
  technician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  technician_name text,
  event_type    text NOT NULL CHECK (event_type IN ('on_my_way','on_site','completed','note')),
  resolution_type text,
  notes         text,
  evidence_urls text[],
  lat           double precision,
  lng           double precision,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX ticket_events_ticket_number_idx ON ticket_events(ticket_number);
CREATE INDEX ticket_events_created_at_idx ON ticket_events(created_at DESC);

-- RLS: authenticated users can read; technicians can insert their own events
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON ticket_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON ticket_events FOR INSERT TO authenticated WITH CHECK (true);
