-- Canonical derived issue status categories: Planned, Ongoing, SignOff, Done

CREATE OR REPLACE FUNCTION public.issue_status_category(issue_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE issue_status
    WHEN 'backlog' THEN 'Planned'
    WHEN 'defined' THEN 'Planned'
    WHEN 'refined' THEN 'Planned'
    WHEN 'open' THEN 'Planned'
    WHEN 'code_review' THEN 'Ongoing'
    WHEN 'product_review' THEN 'Ongoing'
    WHEN 'approved' THEN 'Ongoing'
    WHEN 'released' THEN 'SignOff'
    WHEN 'completed' THEN 'SignOff'
    WHEN 'closed' THEN 'Done'
    ELSE NULL
  END
$$;

DO $$
DECLARE
  status_category_exists boolean;
  status_category_generated text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'issues'
      AND column_name = 'status_category'
  ), (
    SELECT is_generated
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'issues'
      AND column_name = 'status_category'
  )
  INTO status_category_exists, status_category_generated;

  IF NOT status_category_exists THEN
    EXECUTE 'ALTER TABLE public.issues ADD COLUMN status_category text';
  END IF;

  IF COALESCE(status_category_generated, 'NEVER') = 'NEVER' THEN
    EXECUTE $sql$
      UPDATE public.issues
      SET status_category = public.issue_status_category(status)
      WHERE status_category IS DISTINCT FROM public.issue_status_category(status)
    $sql$;
  ELSE
    RAISE NOTICE 'issues.status_category is generated; leaving storage untouched and preserving canonical mapping via its existing expression';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.sync_issue_status_category()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.status_category := public.issue_status_category(NEW.status);
  RETURN NEW;
END
$$;

DO $$
DECLARE
  status_category_generated text;
BEGIN
  SELECT is_generated
  INTO status_category_generated
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'issues'
    AND column_name = 'status_category';

  IF COALESCE(status_category_generated, 'NEVER') = 'NEVER' THEN
    DROP TRIGGER IF EXISTS issues_sync_status_category ON public.issues;
    CREATE TRIGGER issues_sync_status_category
    BEFORE INSERT OR UPDATE OF status ON public.issues
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_issue_status_category();
  ELSE
    RAISE NOTICE 'issues.status_category is generated; skipping sync trigger';
  END IF;
END
$$;
