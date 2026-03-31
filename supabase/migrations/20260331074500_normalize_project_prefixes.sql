-- TASK-505: normalize project names before deriving issue prefixes.
-- Ensures Todero child issues always get TOD-* even when callers send
-- whitespace/casing/legacy alias variants such as " todERO " or "tod".
-- Leaves existing rows unchanged; only affects new inserts.

BEGIN;

CREATE OR REPLACE FUNCTION public.mc_issue_prefix(project_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(coalesce(project_name, '')))
    WHEN 'mission control' THEN 'MC'
    WHEN 'missioncontrol' THEN 'MC'
    WHEN 'mc' THEN 'MC'
    WHEN 'vespera' THEN 'VES'
    WHEN 'ves' THEN 'VES'
    WHEN 'infrastructure' THEN 'INF'
    WHEN 'inf' THEN 'INF'
    WHEN 'kemuni' THEN 'KEM'
    WHEN 'kem' THEN 'KEM'
    WHEN 'todero' THEN 'TOD'
    WHEN 'tod' THEN 'TOD'
    WHEN '' THEN 'TOD'
    ELSE 'TOD'
  END;
$$;

COMMIT;
