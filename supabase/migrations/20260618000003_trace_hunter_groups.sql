-- ============================================================
-- Trace & Hunter — FPI Groups & Feature Keys
-- Created: 2026-06-18
-- ============================================================

-- ── Insert FPI groups ────────────────────────────────────────
INSERT INTO groups (name, description) VALUES
  ('FPI Hunter', 'FPI ground agents — Hunter PWA access (mobile)'),
  ('FPI Admin',  'FPI operations admin — HO Dashboard + roster management')
ON CONFLICT (name) DO NOTHING;

-- ── Feature keys for FPI Hunter ─────────────────────────────
-- trace-hunter: Hunter PWA (trace-hunter.html)
INSERT INTO group_features (group_id, feature_key)
SELECT id, 'trace-hunter'
FROM groups WHERE name = 'FPI Hunter'
ON CONFLICT (group_id, feature_key) DO NOTHING;

-- ── Feature keys for FPI Admin ──────────────────────────────
-- trace-ho:     HO Dashboard (trace-ho.html) + roster editing
-- trace-hunter: also sees the Hunter PWA (for testing/QA)
INSERT INTO group_features (group_id, feature_key)
SELECT id, unnest(ARRAY['trace-ho', 'trace-hunter'])
FROM groups WHERE name = 'FPI Admin'
ON CONFLICT (group_id, feature_key) DO NOTHING;

-- ── Extend existing Admin group with both trace features ─────
INSERT INTO group_features (group_id, feature_key)
SELECT id, unnest(ARRAY['trace-ho', 'trace-hunter'])
FROM groups WHERE name = 'Admin'
ON CONFLICT (group_id, feature_key) DO NOTHING;
