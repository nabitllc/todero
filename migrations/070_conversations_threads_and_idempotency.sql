-- 070: customer conversations — a finer thread grain, and an idempotent inbound door.
--
-- OWNED BY THE customer-conversations piece (pieces7). See migrations/063's
-- header for the store this extends, and lib/conversations.ts's "Outbound
-- adapter seam" / "Inbound webhook authentication" blocks for the code these
-- two columns exist to serve.
--
-- WHY TWO COLUMNS, AND WHY BOTH ARE NULLABLE
-- -------------------------------------------
-- Migration 063 already answers "Slack — a reply threads instead of drowning
-- the channel" at the CONTACT grain: `conversations` is one row per
-- (project, channel, contact), so a second message from the same customer
-- joins the existing thread instead of opening a new one. What it does NOT
-- answer is the grain INSIDE one thread: a customer who asks two things in a
-- row, answered by two separate drafts, has no way to say which draft answers
-- which question — the thread itself would "drown" in exactly the way the
-- owner's sentence is about, just one level down.
--
--   conversation_messages.reply_to_message_id
--     The message THIS one answers. Self-referencing, nullable, and OUTBOUND
--     ONLY — lib/conversations.ts's validateMessage() refuses it on an
--     inbound message with a 422, because a customer's own message is never
--     "a reply to" anything Todero tracks. Nullable because most threads
--     never need it: a single back-and-forth has nothing to disambiguate.
--
--   conversation_messages.external_id
--     The PROVIDER's own id for an inbound event — a WhatsApp `wamid`, a
--     Twilio `MessageSid`, whatever the future adapter's provider calls it.
--     Real inbound webhooks retry: at-least-once delivery is the norm, not the
--     exception, and without this column a retried delivery would read as a
--     second customer message. The partial UNIQUE index below makes the
--     SECOND insert of the same external_id fail at the database, which is
--     what lets the route treat "already recorded" as a 200 replay instead of
--     either a duplicate row or a 500 it has to invent a reason for.
--     Nullable because most inbound arrivals today have no provider at all —
--     a human typing a test message through the UI has no id to give.
--
-- WHY THE UNIQUE INDEX IS PARTIAL, NOT A PLAIN COLUMN CONSTRAINT
-- -----------------------------------------------------------------
-- `UNIQUE (external_id)` outright would forbid every row after the first with
-- `external_id IS NULL` — and NULL rows are the common case (every message
-- typed by a human, and every outbound draft). Both dialects treat multiple
-- NULLs in a UNIQUE column as non-colliding by default, but the constraint is
-- written as an explicit `WHERE external_id IS NOT NULL` partial index anyway
-- rather than relying on that default silently: the rule this migration
-- exists to state is "two rows may not share a provider id", not merely "a
-- column happens to allow nulls to repeat."
--
-- WHY reply_to_message_id IS NOT A DIRECTION CHECK
-- ---------------------------------------------------
-- "Only an outbound message may carry reply_to_message_id" is enforced in
-- lib/conversations.ts, not here, and that is a stated trade rather than an
-- oversight: a CHECK constraint that reads a SECOND column's value on the
-- SAME row is expressible in both dialects, but a self-referencing FK cannot
-- also assert something about the ROW BEING INSERTED without a second lookup
-- the CHECK clause cannot perform portably. Migration 063 made an identical
-- trade for the channel vocabulary; this one is narrower still, since a
-- direct-SQL writer inserting an inbound row with a reply_to_message_id
-- produces a row the application will simply never construct or render as
-- meaningful, rather than one that lets a sent-without-approval message
-- through — the load-bearing rule from 063 is untouched by this file.
--
-- IDEMPOTENCE: every statement is IF NOT EXISTS / a guarded ALTER. A second
-- run collides with nothing, and this migration creates no table 063 has not
-- already created.

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES conversation_messages (id);

-- "the same provider event is recorded once" — a retried webhook delivery
-- collides here instead of creating a second customer message.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_external_id_unique
  ON conversation_messages (external_id)
  WHERE external_id IS NOT NULL;

-- "which question this draft answers" — the read a thread view needs to stop
-- rendering as one flat, ambiguous list once more than one reply is pending.
CREATE INDEX IF NOT EXISTS conversation_messages_reply_to_idx
  ON conversation_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;
