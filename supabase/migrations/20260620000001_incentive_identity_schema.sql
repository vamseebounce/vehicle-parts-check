-- ============================================================
-- Incentive Identity Schema — Three-layer name resolution
-- Applied: 2026-06-20
-- ============================================================

-- ── 1. hr_employees ─────────────────────────────────────────
-- Source of truth for all technician identities.
-- Synced from HR Google Sheet via sync-hr-employees edge function.

CREATE TABLE IF NOT EXISTS hr_employees (
  employee_id   TEXT PRIMARY KEY,           -- e.g. WRCT0123
  employee_name TEXT NOT NULL,
  designation   TEXT,
  city          TEXT,
  hub           TEXT,
  contact       TEXT,
  email         TEXT,
  synced_at     TIMESTAMPTZ DEFAULT now()
);

-- ── 2. jc_name_aliases ──────────────────────────────────────
-- Bridge: JC Name Normalized (Layer 2) → employee_id (Layer 3).
-- Seeded by exact HR name match; extended manually by admin.

CREATE TABLE IF NOT EXISTS jc_name_aliases (
  id                  SERIAL PRIMARY KEY,
  technician_name     TEXT NOT NULL UNIQUE,   -- Layer 2 normalized JC name
  employee_id         TEXT NOT NULL REFERENCES hr_employees(employee_id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  created_by          TEXT DEFAULT 'system'   -- 'system' | 'admin'
);

CREATE INDEX IF NOT EXISTS jc_name_aliases_employee_id_idx ON jc_name_aliases(employee_id);

-- ── 3. incentive_jc_log columns ─────────────────────────────
-- Add Layer 2 + Layer 3 columns to the JC log table.

ALTER TABLE incentive_jc_log
  ADD COLUMN IF NOT EXISTS technician_name_raw        TEXT,   -- Layer 1: as-is from Metabase
  ADD COLUMN IF NOT EXISTS technician_name_normalized TEXT,   -- Layer 2: trimmed + dash-standardized
  ADD COLUMN IF NOT EXISTS employee_id                TEXT REFERENCES hr_employees(employee_id);

CREATE INDEX IF NOT EXISTS incentive_jc_log_employee_id_idx ON incentive_jc_log(employee_id);
CREATE INDEX IF NOT EXISTS incentive_jc_log_tech_norm_idx   ON incentive_jc_log(technician_name_normalized);

-- ── 4. backfill_employee_ids() ───────────────────────────────
-- Called by sync-incentive-data (Step 7) after each sync.
-- Retro-applies new aliases to historical rows missing employee_id.

CREATE OR REPLACE FUNCTION backfill_employee_ids()
RETURNS void LANGUAGE sql AS $$
  UPDATE incentive_jc_log l
  SET employee_id = a.employee_id
  FROM jc_name_aliases a
  WHERE l.technician_name_normalized = a.technician_name
    AND l.employee_id IS NULL;
$$;
