-- Task 2½.1: vehicles dimension table
CREATE TABLE IF NOT EXISTS public.vehicles (
  chassis_number  text PRIMARY KEY,
  reg_number      text,
  model           text,
  city            text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read vehicles"
  ON public.vehicles FOR SELECT USING (true);

COMMENT ON TABLE public.vehicles IS 'Dimension table: one row per bike chassis. Populated from bike_location_cache + Metabase. Used as ML training anchor.';

-- Rollback:
-- DROP TABLE IF EXISTS public.vehicles;
