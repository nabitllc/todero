-- 063: customer conversations — the store behind "draft, approve, send".
--
-- WHY THIS TABLE PAIR EXISTS
-- --------------------------
-- scripts/board/channels.json scores "Customer Conversations" 0/9 and says why:
-- "Nothing exists: no conversation store, no draft-approve-send path, no channel
-- integration beyond outbound Discord/Telegram alerts." The owner's goal for the
-- channel is one sentence, and every column below exists to serve a clause of it:
--
--   "Slack — a reply THREADS instead of drowning the channel."
--        -> `conversations`, one row per (project, channel, contact), UNIQUE.
--   "Grok Bot — DRAFTS while you are away, surfaces only what needs approval."
--        -> `conversation_messages.state = 'draft'`, the state an agent writes.
--   "You APPROVE; Todero SENDS."
--        -> the two CHECK constraints at the bottom of this file, which make a
--           row that was sent without being approved IMPOSSIBLE TO STORE.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT BACK
-- -----------------------------------------
-- There is no transport. No WhatsApp Business API, no web widget, no outbound
-- HTTP to a customer anywhere in the piece that owns this migration. `sent` is
-- therefore a state that a transport REPORTS BACK into once one exists; nothing
-- in Todero can put a row there on its own today. That is a smaller lie than a
-- Send button that quietly does nothing, and it is why `sent_via` is NOT NULL-
-- enforced for a sent row: a send that cannot name what carried it is a claim,
-- not a record.
--
-- WHERE VALIDATION LIVES, AND WHY IT IS SPLIT
-- -------------------------------------------
-- Two kinds of rule, two homes, on purpose:
--
--   * LIFECYCLE rules are CHECK constraints here. They are load-bearing — they
--     have to hold against a writer that never goes through the API at all (a
--     psql session, a future importer, a bug). "An outbound message cannot be
--     sent unless it was approved" is exactly that kind of rule.
--
--   * VOCABULARIES (which channels exist, which statuses a thread may hold) are
--     validated in `lib/conversations.ts` and refused at the API seam, the same
--     stance app/api/hub-settings/route.ts takes for its keys ("an unknown key
--     is a typo or an injection, never a feature"). They are NOT CHECKs here,
--     because a table that CHECKs its vocabulary grows a migration per channel —
--     the same reason migration 058 chose key/value over a column per setting.
--     The trade is stated rather than glossed: a direct-SQL writer can insert
--     channel 'carrier-pigeon' and the database will accept it. It cannot,
--     however, insert a sent-but-unapproved message.
--
-- COLUMN NOTES
-- ------------
--   conversations.project      the scope. Same `text` project name `issues.project`
--                              carries ('Limiglow'), so the boundary the rest of
--                              the app enforces is the boundary here.
--   conversations.contact      the EXTERNAL identifier — an E.164 phone number for
--                              whatsapp, a site session id for web. Never a Todero
--                              user; this table is about people outside.
--   conversations.last_message_at
--                              NULLABLE, and never defaulted to created_at. A
--                              thread that has received nothing renders "no
--                              messages yet"; a timestamp copied from row
--                              creation would claim a customer wrote at a moment
--                              they did not. Same nullability rule as
--                              run_steps.tokens in migration 060.
--   conversation_messages.author
--                              who wrote an outbound message (the drafting agent,
--                              or the human who typed it). NULL for inbound — the
--                              author of an inbound message is the thread's own
--                              contact, and copying it here would be a second
--                              place for it to drift.
--   conversation_messages.sent_via
--                              what actually carried a sent message. NULL until a
--                              transport says otherwise.

CREATE TABLE IF NOT EXISTS conversations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project         text        NOT NULL,
  channel         text        NOT NULL,
  contact         text        NOT NULL,
  contact_name    text,
  status          text        NOT NULL DEFAULT 'open',
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- "a reply threads instead of drowning the channel": a second message from
  -- the same contact on the same channel joins THIS row. It does not open a
  -- second thread, and the API's inbound path relies on this constraint rather
  -- than on a read-then-write race.
  CONSTRAINT conversations_thread_unique UNIQUE (project, channel, contact)
);

-- The only list this table has: "every thread in THIS project, newest first".
CREATE INDEX IF NOT EXISTS conversations_project_idx
  ON conversations (project, last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  direction       text        NOT NULL,
  state           text        NOT NULL,
  body            text        NOT NULL,
  author          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  approved_at     timestamptz,
  approved_by     text,
  sent_at         timestamptz,
  sent_via        text,

  -- A direction and a state that disagree are not a state this product has.
  -- An inbound message is `received` and nothing else; the draft/approved/sent
  -- lifecycle belongs to outbound messages only.
  CONSTRAINT conversation_messages_direction_state CHECK (
    (direction = 'inbound'  AND state = 'received') OR
    (direction = 'outbound' AND state IN ('draft', 'approved', 'sent'))
  ),

  -- "You approve" — an approved row must carry the moment it was approved.
  CONSTRAINT conversation_messages_approved_stamp CHECK (
    state <> 'approved' OR approved_at IS NOT NULL
  ),

  -- "…; Todero sends" — and only after that. A sent row must carry the approval
  -- that authorised it, the moment it left, and what carried it. This is the
  -- rule of the whole surface expressed where no application bug can skip it.
  CONSTRAINT conversation_messages_sent_needs_approval CHECK (
    state <> 'sent' OR (approved_at IS NOT NULL AND sent_at IS NOT NULL AND sent_via IS NOT NULL)
  )
);

-- "every message of THIS thread, in order" — the thread read.
CREATE INDEX IF NOT EXISTS conversation_messages_thread_idx
  ON conversation_messages (conversation_id, created_at);

-- "what still needs approval" — the one number the card puts on screen.
CREATE INDEX IF NOT EXISTS conversation_messages_state_idx
  ON conversation_messages (state, conversation_id);
