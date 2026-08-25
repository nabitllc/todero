-- TOD-489 repair (memory-loop-write piece): structured post-task memory.
--
-- post-task-memory.sh / promote-hot-patterns.sh (TOD-489) used to append to
-- loose Markdown files under a hardcoded /Users/kemuniagent path — dead on
-- any non-macOS host, and not queryable even where it worked (grep over
-- prose). This table replaces the write target: one structured row per
-- agent run, with a fixed shape (what was attempted, whether it succeeded,
-- the rejection reason if any) instead of a free-text corrections.md entry.
--
-- promote-hot-patterns groups rows by keyword frequency in rejection_reason
-- / reviewer_notes; a pattern appearing >= 3 times (the already-tuned
-- threshold from TOD-489) gets promoted to the self_improving HOT tier in
-- agent_memory_files, and drafted as a skill proposal into
-- Mich-Brain2/_pending/skill-updates/ for human approval — never written
-- anywhere else in the vault, never auto-approved.

CREATE TABLE IF NOT EXISTS agent_run_records (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          text        NOT NULL,
  task_key          text        NOT NULL,
  task_title        text,
  status            text,
  attempted         text,
  succeeded         boolean     NOT NULL DEFAULT false,
  failed            boolean     NOT NULL DEFAULT false,
  rejection_count   integer     NOT NULL DEFAULT 0,
  rejection_reason  text,
  reviewer_notes    text,
  exit_status       integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- promote-hot-patterns reads "every rejected/failed row for this agent,
-- newest first" and the memory browser reads "every row for this agent".
CREATE INDEX IF NOT EXISTS agent_run_records_agent_created_idx
  ON agent_run_records (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_run_records_task_key_idx
  ON agent_run_records (task_key);
