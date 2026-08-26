-- 062: give `agent_memory` the key/value shape all fourteen of its call sites
--      already write. Postgres dialect; the SQLite copy is migrations/sqlite/062.
--
-- THE DECISION, AND WHY
--   Two options were on the table: reshape `agent_memory` into a key/value
--   store, or leave it as a daily-notes table and move the key/value writers
--   somewhere new. The tiebreak was mechanical — count which option makes the
--   fewest call sites lie:
--
--     Reshape to key/value ......... 14 call sites become true, 0 become false.
--     Move the writers elsewhere ... 14 files edited, and `agent_memory` would
--                                    survive as an exact duplicate of
--                                    `agent_memory_files` that nothing reads.
--
--   Every reader and writer of `agent_memory` in this repo uses `key`/`value`:
--   app/api/settings/cost-history, app/api/agent-pause, app/api/hub-pause,
--   app/api/inbox, app/api/circuit-breaker, app/api/agents, app/api/theme,
--   lib/agent-budget, lib/agent-heartbeats, lib/agent-registrations,
--   lib/loop-breaker, lib/agent-memory, lib/theme, lib/hub-pause.
--   NOT ONE of them reads it as daily notes. The daily-notes role is served in
--   full by `agent_memory_files` (app/api/agent-memory, app/api/memory,
--   lib/memory-budget, lib/memory-loop, MemoryTab, MemoryBudgetCard,
--   config/migrations/seed-agent-db) — which, on SQLite, is a column-for-column
--   duplicate of the `agent_memory` that 016 created.
--
--   app/api/run-agent/route.ts:146 already states the intended split in prose:
--   "agent_memory -> agent_memory_files (agent_memory is the key-value store)".
--   This migration catches the schema up to a decision the code made long ago.
--
-- WHAT 016 GOT WRONG, AND WHAT THIS FILE PROMISES NOT TO REPEAT
--   migrations/016_agent_documents.sql CREATEs `agent_memory` with the
--   daily-notes shape and then, eleven lines further down, says in a comment
--   that the real table is "key/value jsonb" — a shape nothing in migrations/
--   ever created. The comment was right; the DDL was wrong; and
--   migrations/sqlite/000_baseline.sql was translated from the DDL, so the
--   error was copied onto every SQLite host.
--
--   This file therefore describes ONLY the shape it actually creates below.
--   The columns are not guessed: `key`, `value` and the UNIQUE (agent_id, key)
--   conflict target are read off the call sites, every one of which passes
--   `{ onConflict: 'agent_id,key' }`. lib/db/pg-sql.ts conflictSql() compiles
--   that straight into `ON CONFLICT (agent_id, key)`, which Postgres rejects
--   without a matching unique index — so the constraint is load-bearing, not
--   decoration.
--
--   `value` is jsonb because most callers expect a real object back
--   (lib/loop-breaker.ts readMemoryValue<T>() returns it as T with no parse).
--   lib/agent-heartbeats.ts and lib/agent-registrations.ts store
--   JSON.stringify(obj), which is valid JSON and casts to jsonb cleanly.
--
-- IDEMPOTENCE, AND THE TWO SHAPES THIS CAN MEET
--   A fresh database arrives here with the daily-notes shape 016 just created.
--   A long-lived hosted database arrives already key/value (the shape 016's own
--   comment describes). Both are handled: the branch below keys off whether a
--   `key` column exists, so re-running is a no-op and neither host is damaged.
--   Any daily-notes rows found are copied into `agent_memory_files` — the table
--   that actually serves that data — BEFORE the reshape, so nothing is lost.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'key'
  ) THEN
    -- Already the key/value store. Nothing to reshape.
    NULL;
  ELSE
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'agent_memory'
    ) THEN
      -- Preserve whatever the daily-notes shape was holding. agent_memory_files
      -- has the identical column set, and is where every daily-notes reader in
      -- the app already looks. ON CONFLICT DO NOTHING because a row may already
      -- have been seeded there under the same (agent_id, memory_type, date_key).
      INSERT INTO agent_memory_files (agent_id, memory_type, date_key, content, updated_at)
        SELECT agent_id, memory_type, date_key, content, updated_at FROM agent_memory
        ON CONFLICT (agent_id, memory_type, date_key) DO NOTHING;

      DROP TABLE agent_memory;
    END IF;

    CREATE TABLE agent_memory (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id   text NOT NULL,
      key        text NOT NULL,
      value      jsonb,
      updated_at timestamptz DEFAULT now(),
      UNIQUE (agent_id, key)
    );
  END IF;
END $$;

-- Belt and braces for a hosted table that was created by hand (016's note says
-- one was) and may carry the columns without the constraint every writer's
-- onConflict target depends on.
CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_agent_id_key_idx
  ON agent_memory (agent_id, key);

-- Every read filters on `key`, usually across all agents
-- (lib/agent-heartbeats.ts selects .eq('key','heartbeat') with no agent_id).
CREATE INDEX IF NOT EXISTS agent_memory_key_idx ON agent_memory (key);
