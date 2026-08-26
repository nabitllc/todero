-- runs-traces: one row per STEP of an agent run.
--
-- WHY THIS TABLE EXISTS
-- ---------------------
-- components/nav/RunsView.tsx shipped refusing to draw design/Run.dc.html's
-- per-step trace, and the refusal named the reason exactly: agent_runs carries
-- tokens_used and cost_usd at the RUN level only. There is no row per step, so
-- a per-step token column, a per-step duration, or a cost-by-step breakdown
-- could only ever have been invented. That refusal was correct behaviour. The
-- fix is the missing data, which is this file — not a nicer-looking empty.
--
-- WHAT A ROW MEANS
-- ----------------
-- One tool call the supervisor observed and recorded. Every column is written
-- by the recorder (POST /api/run-steps), never derived at read time:
--
--   step_no      1-based ordinal within the run. UNIQUE with run_id, so
--                appending "step 3" twice is a constraint violation rather
--                than two step 3s that make the trace read wrong.
--   tool         the tool that ran — 'read', 'grep', 'edit', 'bash', 'memory'.
--                This is also the grouping key the cost-by-step panel sums on,
--                which is why it is NOT NULL: a bucket with no name is a
--                bucket the UI would have to invent a label for.
--   what         one line describing what the step did.
--   detail       optional second line (a command's exit status, a match
--                count). NULL means the recorder had nothing more to say, and
--                the UI renders no detail line at all — not an empty one.
--   tokens       tokens the step consumed. NULLABLE ON PURPOSE: a step whose
--                token count was never measured must render '—', never '0'.
--                A 0 here means a real measured zero.
--   duration_ms  wall time for the step. Same nullability rule as tokens.
--   ok           false for a step that failed. The trace tones a failed step
--                differently, and a run can succeed with failed steps in it
--                (a failing `tsc` followed by the edit that fixed it — that is
--                the whole point of keeping the failure in the trace).
--   cost_usd     NULLABLE, and the nullability is load-bearing. Todero targets
--                a local model on this host: a run costs GPU time and wall
--                clock, not money, and the recorder writes NULL for it.
--                design/Run.dc.html states the rule this column implements —
--                "the dollar column appears only when a run touches a paid
--                provider" — and the UI's condition is literally "some step
--                has a non-null cost_usd". Writing 0 here for a local step
--                would turn that condition into a lie, so don't.
--   provider     which provider served the step, when the recorder knows.
--                NULL means unrecorded; the UI never renders the word "local"
--                unless a row actually says so.
--
-- NOT stored here: anything design/Run.dc.html's "What it learned" panel
-- shows. The promotion counter ("2 of 3 to skill") is a threshold inside
-- scripts/promote-hot-patterns, not a per-run column, and inventing a column
-- to back a mockup nobody writes to would recreate the defect this table
-- exists to remove.

CREATE TABLE IF NOT EXISTS run_steps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      text        NOT NULL,
  step_no     integer     NOT NULL,
  tool        text        NOT NULL,
  what        text        NOT NULL,
  detail      text,
  tokens      integer,
  duration_ms integer,
  ok          boolean     NOT NULL DEFAULT true,
  cost_usd    numeric(12,6),
  provider    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_steps_run_step_unique UNIQUE (run_id, step_no)
);

-- The only read this table has: "every step of THIS run, in order".
CREATE INDEX IF NOT EXISTS run_steps_run_id_step_no_idx ON run_steps (run_id, step_no);
