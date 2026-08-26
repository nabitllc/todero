-- 061 (2026-08-25): approval_decisions — the append-only record of what a
-- human decided, and what that decision actually did.
--
-- WHY A TABLE AND NOT JUST THE INBOX ROW (the justification this piece owes)
-- -------------------------------------------------------------------------
-- Everything about a decision used to live on the `inbox` row itself:
-- `status`, `resolved_by`, `resolved_at`, `response_data`, all set by an
-- UPDATE in PATCH /api/inbox. That is a current-state column set, not an
-- audit trail, and it fails in three specific ways this piece had to close:
--
--   1. It is overwritable. A second PATCH on the same id replaced the first
--      decision, its author and its timestamp with no trace that a different
--      answer had ever been given. (This is now also refused at the API —
--      preflightDecision()'s ALREADY_RESOLVED — but a guard in one route is
--      not a durable record; the table is.)
--
--   2. A REFUSAL wrote nothing at all. The fail-closed paths added in this
--      piece — target issue gone, no registered effect, already decided —
--      deliberately leave the inbox row `pending`. With only the inbox row,
--      "the operator tried to approve this and the system refused" would be
--      invisible: the request would just sit there looking untouched. Those
--      attempts are exactly the ones worth keeping.
--
--   3. `response_data` is one JSON blob with no shape the database enforces
--      and nothing to query by. "Show me every approval that FAILED to
--      apply last week" is not answerable from it. `outcome` here is a
--      constrained column with an index.
--
-- APPEND-ONLY is the contract. No route in this repo issues an UPDATE or a
-- DELETE against this table — the only writer is the INSERT in
-- PATCH /api/inbox, and the only reader is GET /api/inbox/decisions. There
-- is no updated_at column on purpose: a row here describes a moment, and a
-- moment does not change.
--
-- `outcome` vs `decision`: `decision` is what the human asked for.
-- `outcome` is what the system actually did about it, which is not the same
-- thing and is the whole reason both columns exist:
--   applied   — the effect ran and reported success
--   no_effect — recorded, nothing was dispatched (a denial, an acknowledgement)
--   failed    — the effect ran and reported failure; the human's approval did
--               NOT take effect, and this row is the proof it did not
--   refused   — the decision was rejected before anything was written; the
--               inbox row is still pending

CREATE TABLE IF NOT EXISTS approval_decisions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No FK to inbox on purpose: the audit row must outlive the request it
  -- describes. An ON DELETE CASCADE here would let deleting an inbox row
  -- erase the record of what was decided about it, which is the failure mode
  -- this table exists to prevent.
  inbox_id      TEXT        NOT NULL,
  request_type  TEXT,
  request_agent TEXT,
  decision      TEXT        NOT NULL,
  outcome       TEXT        NOT NULL,
  -- The effect handler that ran (e.g. 'agent_unpause'), or the refusal code
  -- (e.g. 'TARGET_MISSING') when outcome = 'refused'.
  effect        TEXT,
  -- What actually happened, in words, including the failure message when the
  -- effect threw. Never the human's typed reason alone — that is human_reason.
  detail        TEXT        NOT NULL,
  human_reason  TEXT,
  -- Resolved at decision time (context.project, or the project of the issue
  -- the request points at). NULL means the request could not be placed —
  -- recorded as NULL rather than guessed into a project.
  project       TEXT,
  decided_by    TEXT        NOT NULL,
  decided_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT approval_decisions_decision_check
    CHECK (decision IN ('approved', 'denied', 'explained', 'timeout')),
  CONSTRAINT approval_decisions_outcome_check
    CHECK (outcome IN ('applied', 'no_effect', 'failed', 'refused'))
);

-- The two reads the surface actually makes: newest-first overall, and
-- newest-first for one request.
CREATE INDEX IF NOT EXISTS approval_decisions_decided_at_idx
  ON approval_decisions (decided_at DESC);
CREATE INDEX IF NOT EXISTS approval_decisions_inbox_idx
  ON approval_decisions (inbox_id, decided_at DESC);
