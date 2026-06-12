-- Task 1.4: Role-based permission system
-- groups: named permission groups (RSA Ops, Technician, Admin)
CREATE TABLE groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text UNIQUE NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- group_features: which features a group can access
CREATE TABLE group_features (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  UNIQUE(group_id, feature_key)
);

-- user_groups: which groups a user belongs to (one-to-many)
CREATE TABLE user_groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE,
  UNIQUE(user_id, group_id)
);

-- Seed groups
INSERT INTO groups (name, description) VALUES
  ('RSA Ops',     'RSA warroom operators — fw-map and rsa-warroom access'),
  ('Technician',  'RSA field technicians — tech-app access'),
  ('Admin',       'Full access to all features and admin panels');

-- Seed features per group
INSERT INTO group_features (group_id, feature_key)
SELECT id, unnest(ARRAY['fw-map', 'rsa-warroom'])
FROM groups WHERE name = 'RSA Ops';

INSERT INTO group_features (group_id, feature_key)
SELECT id, 'tech-app'
FROM groups WHERE name = 'Technician';

INSERT INTO group_features (group_id, feature_key)
SELECT id, unnest(ARRAY['fw-map', 'rsa-warroom', 'tech-app', 'admin-panel', 'export-data', 'all-cities'])
FROM groups WHERE name = 'Admin';

-- Assign Nishanth + Pavan to RSA Ops
INSERT INTO user_groups (user_id, group_id)
SELECT u.id, g.id
FROM auth.users u, groups g
WHERE u.email IN ('nishanthshetty2024@gmail.com', 'pavanmahesh120@gmail.com')
AND g.name = 'RSA Ops';
