-- Session 13: Drop leftover pre-partition tables
--
-- rsa_ticket_locations_old (2.0 MB, 7,701 rows) and
-- rsa_team_locations_old (1.7 MB, 4,860 rows) were renamed
-- during the partition migration in session 9 (task 2.6/2.7).
-- Data was exported to Supabase Storage before the rename.
-- These tables are no longer referenced by any view, function,
-- edge function, or HTML file.
--
-- Dropping them frees ~3.7 MB from PostgreSQL's buffer cache.
--
-- Rollback: not possible — restore from the Storage export if needed.

DROP TABLE IF EXISTS public.rsa_ticket_locations_old;
DROP TABLE IF EXISTS public.rsa_team_locations_old;
