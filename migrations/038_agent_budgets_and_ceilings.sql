-- TOD-2381 (agent-budget-stop): ceilings enforced by the supervisor, not the agent.
--
-- Playbooks/Loop_Engineering.md, 2026-08-24 incident: a loop told in its own
-- prompt to stop at 06:00 and launched with --max-budget-usd 50 ran 17 hours and
-- $688 unstopped, because both guards were instructions the loop was free to
-- reason past. "A guard written in the prompt is not a guard." Everything this
-- migration supports is read and enforced OUTSIDE the agent process: in the
-- dispatch path (POST /api/run-agent) and on every heartbeat of a run already
-- in flight (PATCH /api/heartbeat). See lib/agent-budget.ts.
--
-- 1. agent_budgets — one row per agent naming its ceilings. A missing row (or
--    a missing table, on a host that has not migrated) means "use the built-in
--    defaults", never "use no ceiling" — lib/agent-budget.ts degrades to the
--    same constants it ships with. limit_usd is nullable on purpose: on a
--    local-model host every run costs ~$0, so the dollar ceiling is dormant
--    until an operator sets one, exactly as the piece brief specifies. It must
--    never be the ONLY ceiling — concurrency, wall-clock and no-progress are
--    the ones enforced with or without a dollar limit set.
CREATE TABLE IF NOT EXISTS agent_budgets (
  agent_id                TEXT        PRIMARY KEY,
  period                  TEXT        NOT NULL DEFAULT 'daily'
                                       CHECK (period IN ('run', 'daily', 'monthly')),
  limit_usd                NUMERIC(10,2),
  max_concurrent_runs      INTEGER     NOT NULL DEFAULT 1,
  max_run_ms                BIGINT      NOT NULL DEFAULT 3600000,   -- 60 min wall clock
  no_progress_heartbeats    INTEGER     NOT NULL DEFAULT 3,
  max_runs_per_period       INTEGER     NOT NULL DEFAULT 20,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. agent_runs gets what the supervisor needs to stop an in-flight run rather
--    than merely notice it should have. `pid` lets the heartbeat-time ceiling
--    check send a real signal to a real process instead of only disowning the
--    row; `stall_count`/`last_progress_hash` are the no-progress halt's state
--    (Loop_Engineering element 3: the cheap signal that catches a dead end
--    before wall-clock or dollar ceilings would); `stopped_reason`/`stopped_at`
--    make a ceiling stop queryable after the fact instead of indistinguishable
--    from a normal completion.
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS pid                INTEGER,
  ADD COLUMN IF NOT EXISTS stall_count         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_progress_hash  TEXT,
  ADD COLUMN IF NOT EXISTS last_progress_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stopped_reason       TEXT,
  ADD COLUMN IF NOT EXISTS stopped_at           TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS agent_runs_status_agent_idx
  ON agent_runs (status, agent_id);

-- `stopped` is a new terminal status a ceiling puts a run into (distinct from
-- `completed` — the agent did not finish, the supervisor ended it). No
-- migration in this repo has ever declared agent_runs.status's allowed
-- values (grep migrations/*.sql for agent_runs_status_check: nothing), so a
-- database created purely from this directory has no constraint at all.
--
-- The hosted instance this was developed against has one anyway — undocumented
-- schema drift from outside migrations/ — and empirical probing (inserting
-- each candidate value directly against its REST API) found it accepts only
-- 'running', 'failed', 'done' and REJECTS 'completed' and 'error' — the two
-- values app/api/issues/route.ts and app/api/run-agent/route.ts have been
-- writing to close a run since before this piece existed. Concretely: the
-- "Close agent_runs on status change" write in app/api/issues/route.ts has
-- been silently failing on this database on every single call, which is the
-- other reason (alongside token_ledger's dead finalize function) agent_runs
-- accumulates rows that never leave 'running' — 67,592 of them at the time
-- of this migration. That code path is unchanged by this piece (it is not
-- this piece's file to fix), but the constraint blocking it is squarely a
-- "the ledger doesn't close" defect, so it is fixed here.
--
-- DROP IF EXISTS + (re)ADD makes this migration correct whether the database
-- was created purely from this directory (no prior constraint) or is this
-- drifted hosted instance (a private, narrower one) — either way it ends up
-- with the same permissive, documented set: every status value any code in
-- this repo actually writes, plus the two ('failed', 'done') the drifted
-- constraint was already permitting, so old rows already in either shape
-- keep validating.
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check
  CHECK (status IN ('running', 'completed', 'error', 'stopped', 'killed', 'failed', 'done'));

-- 3. Close the ledger, mark the orphans, move on. Before this round
--    recordCompletion() (now finalizeRun(), see lib/runtimes/token-ledger.ts)
--    was defined and never called, so every one of 66,879 rows sat at
--    status='spawned' forever with cost_usd always NULL — a budget reading
--    this table saw no spend, ever, on any agent. finalizeRun() is now wired
--    into the real run lifecycle (lib/runtimes/claude-code.ts's process-exit
--    watcher), so new rows close. Backfilling the 66,879 pre-existing stubs is
--    explicitly out of scope (piece brief: "mark them and move on") — this
--    view names them instead of silently folding their NULL cost into every
--    spend sum as an uncounted zero.
CREATE OR REPLACE VIEW token_ledger_orphans AS
SELECT *
FROM token_ledger
WHERE status = 'spawned'
  AND spawned_at < NOW() - INTERVAL '1 hour';

ALTER TABLE agent_budgets ENABLE ROW LEVEL SECURITY;
-- Service role only, like token_ledger — this is operator-facing governance
-- data, not something any workspace member should read or write directly.
