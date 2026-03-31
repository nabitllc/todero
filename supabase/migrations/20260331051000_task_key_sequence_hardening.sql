-- MC-486: harden issue identity generation so task numbers/keys are atomic.
-- Fixes the live regression where concurrent inserts can still reuse the same
-- task_key when the API falls back to MAX(task_number)+1.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.mc_task_seq;

SELECT setval(
  'public.mc_task_seq',
  COALESCE((SELECT MAX(task_number) FROM public.issues), 0),
  true
);

CREATE OR REPLACE FUNCTION public.mc_issue_prefix(project_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE project_name
    WHEN 'Mission Control' THEN 'MC'
    WHEN 'Vespera' THEN 'VES'
    WHEN 'Infrastructure' THEN 'INF'
    WHEN 'Kemuni' THEN 'KEM'
    WHEN 'Todero' THEN 'TOD'
    ELSE 'TOD'
  END;
$$;

CREATE OR REPLACE FUNCTION public.next_task_number()
RETURNS integer
LANGUAGE sql
AS $$
  SELECT nextval('public.mc_task_seq')::integer;
$$;

CREATE OR REPLACE FUNCTION public.mc_assign_issue_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.task_number IS NULL THEN
    NEW.task_number := nextval('public.mc_task_seq')::integer;
  END IF;

  IF NEW.task_key IS NULL OR NEW.task_key = '' THEN
    NEW.task_key := public.mc_issue_prefix(NEW.project) || '-' || NEW.task_number::text;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mc_assign_issue_identity ON public.issues;
CREATE TRIGGER trg_mc_assign_issue_identity
BEFORE INSERT ON public.issues
FOR EACH ROW
EXECUTE FUNCTION public.mc_assign_issue_identity();

COMMIT;
