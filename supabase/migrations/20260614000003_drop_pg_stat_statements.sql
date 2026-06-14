-- Session 13: Drop pg_stat_statements — frees ~10MB RAM
--
-- Used only for ad-hoc query profiling (already done this session).
-- No edge functions or frontend queries depend on this extension.
-- Re-add anytime: CREATE EXTENSION pg_stat_statements;

DROP EXTENSION IF EXISTS pg_stat_statements CASCADE;
