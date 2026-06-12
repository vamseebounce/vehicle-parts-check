-- Session 10: RLS read policies for permission tables
--
-- user_groups, group_features, and groups had RLS enabled (relrowsecurity=true)
-- but had NO read policies — causing authenticated users to get 0 rows from
-- loadUserPermissions(), returning null, which made fpCan('fw-map')=false,
-- which triggered signOut() for ALL DB-group users.
--
-- RSA_EMAILS users were unaffected because they bypass the DB check.
-- This was the root cause of vamsee@bounceshare.com being kicked from fw-map.

-- Each authenticated user can read their own group memberships
CREATE POLICY "authenticated_read_own" ON user_groups
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Feature keys are not sensitive — all authenticated users can read
CREATE POLICY "authenticated_read" ON group_features
  FOR SELECT TO authenticated
  USING (true);

-- Group names are not sensitive — all authenticated users can read
CREATE POLICY "authenticated_read" ON groups
  FOR SELECT TO authenticated
  USING (true);
