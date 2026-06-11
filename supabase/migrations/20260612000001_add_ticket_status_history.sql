-- Task 2½.2: ticket_status_history table + trigger
CREATE TABLE IF NOT EXISTS public.ticket_status_history (
  id              bigserial PRIMARY KEY,
  ticket_number   text NOT NULL,
  old_status      text,
  new_status      text NOT NULL,
  changed_at      timestamptz NOT NULL,
  synced_at       timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_tsh_ticket_time
  ON public.ticket_status_history (ticket_number, changed_at DESC);

CREATE INDEX idx_tsh_changed_at
  ON public.ticket_status_history (changed_at DESC);

ALTER TABLE public.ticket_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read ticket_status_history"
  ON public.ticket_status_history FOR SELECT USING (true);

COMMENT ON TABLE public.ticket_status_history IS 'Immutable log of every ticket status transition. Written by trigger on rsa_tickets_cache. Used for SLA analytics + ML training data.';

-- Function: fires on INSERT or UPDATE when status changes
CREATE OR REPLACE FUNCTION public.log_ticket_status_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.ticket_status_history (ticket_number, old_status, new_status, changed_at)
    VALUES (
      NEW.ticket_number,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
      NEW.status,
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ticket_status_history
  AFTER INSERT OR UPDATE ON public.rsa_tickets_cache
  FOR EACH ROW EXECUTE FUNCTION public.log_ticket_status_change();

-- Rollback:
-- DROP TRIGGER IF EXISTS trg_ticket_status_history ON public.rsa_tickets_cache;
-- DROP FUNCTION IF EXISTS public.log_ticket_status_change();
-- DROP TABLE IF EXISTS public.ticket_status_history;
