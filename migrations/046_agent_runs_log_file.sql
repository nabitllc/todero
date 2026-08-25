-- run-agent-locally piece: a drillable trace, not a log line.
--
-- Every dispatch already writes a per-run log file (lib/paths.ts's LOG_DIR)
-- and, for the openai-api runtime, structured `[trace] {...}` JSON lines
-- inside it (lib/runtimes/openai-api.ts's parseOpenAiTrace). Nothing
-- persisted the PATH to that file anywhere queryable, so the only way to
-- find a given run's trace was to already know its temp-file name. This
-- column is written best-effort by POST /api/run-agent right after a spawn
-- succeeds (mirrors the existing pid-persist pattern in the same route), and
-- read by GET /api/run-agent/trace to locate the file to parse.
--
-- Additive only — a row from before this migration simply has log_file NULL,
-- which the trace endpoint reports as "no trace recorded for this run"
-- rather than fabricating one.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS log_file text;
