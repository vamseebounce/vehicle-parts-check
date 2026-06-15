-- Session 13: list_auth_users() — bypass GoTrue admin API
--
-- GoTrue's /auth/v1/admin/users endpoint returns "Database error finding users"
-- on this project. This SECURITY DEFINER function reads auth.users directly
-- so admin-permissions edge function can list users without the GoTrue API.
--
-- Rollback:
--   REVOKE EXECUTE ON FUNCTION public.list_auth_users() FROM service_role;
--   DROP FUNCTION IF EXISTS public.list_auth_users();

CREATE OR REPLACE FUNCTION public.list_auth_users()
RETURNS TABLE (id uuid, email text, raw_app_meta_data jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT id, email, raw_app_meta_data FROM auth.users ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_auth_users() TO service_role;
