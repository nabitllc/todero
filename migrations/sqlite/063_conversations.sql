-- 063 (sqlite): customer conversations — the store behind "draft, approve, send".
--
-- This is the SQLite dialect of migrations/063_conversations.sql. Read that file
-- for what a row means, for why the lifecycle rules are CHECK constraints while
-- the vocabularies (channel, status) are validated in lib/conversations.ts
-- instead, and for the statement that this piece integrates NO customer channel:
-- `sent` is a state a transport reports back into, and nothing in Todero can put
-- a row there on its own today.
--
-- DIALECT NOTES — the same conversions every twin in this directory makes:
--   * uuid            -> the TEXT uuid idiom from migrations/sqlite/000_baseline.sql.
--   * timestamptz     -> ISO-8601 TEXT (strftime('%Y-%m-%dT%H:%M:%fZ','now')).
--   * CHECK           -> identical. SQLite enforces CHECK constraints natively,
--                        so the three lifecycle rules below are word-for-word
--                        the Postgres ones. That matters more here than
--                        anywhere else in this file: the sqlite host is what a
--                        fresh clone with no credentials runs on, so it is the
--                        host on which "a sent message was always approved" has
--                        to be true first.
--   * REFERENCES      -> kept. lib/db/sqlite-adapter.ts is the only writer and it
--                        does not enable `PRAGMA foreign_keys`, so this clause is
--                        documentation on this host rather than enforcement, and
--                        it is written down as such instead of being relied on:
--                        app/api/conversations/[id]/messages/route.ts answers 404
--                        for a conversation_id with no row, which is the check
--                        that actually holds here.
--
-- IDEMPOTENCE: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only.
-- There is no ALTER, no DROP and no data carryover — 063 introduces two tables
-- that no earlier migration has ever created, so a re-run is a no-op even
-- outside the `schema_migrations` ledger that already makes it run once.

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  project         TEXT NOT NULL,
  channel         TEXT NOT NULL,
  contact         TEXT NOT NULL,
  contact_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  last_message_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- "a reply threads instead of drowning the channel" — see the Postgres copy.
  UNIQUE (project, channel, contact)
);

CREATE INDEX IF NOT EXISTS conversations_project_idx
  ON conversations (project, last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  direction       TEXT NOT NULL,
  state           TEXT NOT NULL,
  body            TEXT NOT NULL,
  author          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_at     TEXT,
  approved_by     TEXT,
  sent_at         TEXT,
  sent_via        TEXT,

  -- An inbound message is `received` and nothing else; draft/approved/sent is
  -- the outbound lifecycle.
  CONSTRAINT conversation_messages_direction_state CHECK (
    (direction = 'inbound'  AND state = 'received') OR
    (direction = 'outbound' AND state IN ('draft', 'approved', 'sent'))
  ),

  -- "You approve" — an approved row carries the moment it was approved.
  CONSTRAINT conversation_messages_approved_stamp CHECK (
    state <> 'approved' OR approved_at IS NOT NULL
  ),

  -- "…; Todero sends" — and only after that. A sent row must carry the approval
  -- that authorised it, the moment it left, and what carried it.
  CONSTRAINT conversation_messages_sent_needs_approval CHECK (
    state <> 'sent' OR (approved_at IS NOT NULL AND sent_at IS NOT NULL AND sent_via IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS conversation_messages_thread_idx
  ON conversation_messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS conversation_messages_state_idx
  ON conversation_messages (state, conversation_id);
