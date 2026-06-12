-- Session 10: Default Users group + auto-assignment trigger
--
-- New users automatically get the "Default Users" group on sign-up.
-- Default group has all features EXCEPT fw-map and rsa-warroom.
-- FW Map and RSA Warroom require explicit assignment by an admin.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--   DROP FUNCTION IF EXISTS public.assign_default_group();
--   DELETE FROM group_features WHERE group_id = (SELECT id FROM groups WHERE name='Default Users');
--   DELETE FROM groups WHERE name = 'Default Users';

-- Default Users group (UUID generated at runtime in DO block)
DO $$
DECLARE
  gid uuid := gen_random_uuid();
BEGIN
  INSERT INTO groups (id, name, description)
  VALUES (gid, 'Default Users',
    'Auto-assigned to all new users. Access to all fleet tools except FW Map and RSA Warroom.');

  INSERT INTO group_features (group_id, feature_key) VALUES
    (gid, 'tech-app'),
    (gid, 'admin-panel'),
    (gid, 'export-data'),
    (gid, 'all-cities');
END;
$$;

-- Trigger function: looks up group by name — no UUID hardcoding
CREATE OR REPLACE FUNCTION public.assign_default_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  default_gid uuid;
BEGIN
  SELECT id INTO default_gid FROM groups WHERE name = 'Default Users' LIMIT 1;
  IF default_gid IS NOT NULL THEN
    INSERT INTO user_groups (user_id, group_id)
    VALUES (NEW.id, default_gid)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach to auth.users (fires on every new sign-up)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION assign_default_group();
