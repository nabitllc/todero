-- pieces9/memory-attempted: widen token_ledger.status to hold the outcomes the
-- runtimes actually observe.
--
-- THE DEFECT THIS FIXES, measured on a scratch database built from this very
-- directory (see docs/rebuild/pieces/pieces9/memory-attempted.md §2):
--
--   UPDATE token_ledger SET status='max_iterations', input_tokens=111,
--     cost_usd=0.5, completed_at=…  ->  CHECK constraint failed
--   row left {status:'spawned', completed_at:null, input_tokens:null, cost_usd:null}
--
-- `lib/runtimes/openai-api.ts` passes `parsed.status` straight into
-- `finalizeRun()`, and `parseOpenAiTrace()` returns 'max_iterations' (the run
-- hit MAX_ITER), 'running' (the process died before writing a run_end line) and
-- 'unknown' (no trace lines at all) as real, distinct outcomes. The column
-- created by migrations/008_token_ledger.sql could hold none of them, so the
-- WHOLE update was rejected and the run's tokens, cost and completion were
-- lost — with only a console.warn. migrations/038_agent_budgets_and_ceilings.sql
-- documents that exact state as budget-corrupting: a ledger that reads zero
-- spend for runs that really spent.
--
-- `lib/runtimes/claude-code.ts` needs 'unknown' for the same reason on the
-- other side: `summarizeExit()` deliberately returns outcome 'unknown' for a
-- run whose own trace never attested completion, and filing that as 'completed'
-- (which is what the hardcoded status there used to do) is the fabricated
-- outcome that whole module exists to prevent.
--
-- 'spawned' stays the default and the pre-completion state; nothing about
-- existing rows changes.

-- The old constraint is dropped BY DISCOVERY, not by assuming its name.
-- migrations/008 declares it inline on the column, so Postgres named it
-- automatically; `token_ledger_status_check` is the name that convention
-- produces, but a database restored from a dump, or created by an older
-- hand-written DDL, can carry a different one. `DROP CONSTRAINT IF EXISTS`
-- with a guessed name would then silently leave the old CHECK in place
-- alongside the new one — and because CHECKs are ANDed, the widened
-- vocabulary would still be rejected while this migration reported success.
-- That is the failure mode this DO block exists to make impossible.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'token_ledger'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE token_ledger DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE token_ledger
  ADD CONSTRAINT token_ledger_status_check
  CHECK (status IN ('spawned', 'completed', 'failed', 'killed', 'max_iterations', 'running', 'unknown'));
