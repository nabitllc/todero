-- 070 (sqlite): customer conversations — a finer thread grain, and an
-- idempotent inbound door.
--
-- This is the SQLite dialect of migrations/070_conversations_threads_and_idempotency.sql.
-- Read that file for what each column means and the two reasoning sections
-- (why the unique index is partial, why the outbound-only rule for
-- reply_to_message_id is enforced in lib/conversations.ts and not here).
--
-- DIALECT NOTES:
--   * ADD COLUMN IF NOT EXISTS -> plain ADD COLUMN. SQLite has no
--     `IF NOT EXISTS` for ADD COLUMN (rejected at 'near "EXISTS"' — same note
--     migrations/sqlite/057 and migrations/sqlite/066 record) and the runner's
--     schema_migrations ledger is what makes a bare ADD COLUMN run exactly
--     once, so the guard the Postgres file gets from IF NOT EXISTS is not
--     needed here.
--   * uuid FK -> TEXT REFERENCES, same idiom every twin in this directory
--     uses for the id columns migrations/sqlite/000_baseline.sql establishes.
--   * Partial UNIQUE index -> identical. SQLite supports
--     `CREATE UNIQUE INDEX ... WHERE ...` (partial indexes) natively, so this
--     is the same idempotency guarantee word-for-word — the host a fresh
--     clone with no credentials runs on gets the exact same "one row per
--     provider event" rule Postgres gets.

ALTER TABLE conversation_messages ADD COLUMN external_id TEXT;
ALTER TABLE conversation_messages ADD COLUMN reply_to_message_id TEXT REFERENCES conversation_messages (id);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_external_id_unique
  ON conversation_messages (external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_messages_reply_to_idx
  ON conversation_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;
