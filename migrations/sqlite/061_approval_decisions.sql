-- 061 (2026-08-25): approval_decisions — SQLite form of migrations/061.
-- See that file for the full justification of why the decision record is a
-- separate append-only table and not more columns on `inbox`. Short version:
-- the inbox row is current state, it is overwritable, and a REFUSED decision
-- (fail-closed) writes nothing to it at all.
--
-- Same id-generation expression the rest of migrations/sqlite/ uses, since
-- SQLite has no gen_random_uuid().

CREATE TABLE IF NOT EXISTS approval_decisions (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  -- No FK to inbox: the audit row must outlive the request it describes.
  inbox_id      TEXT NOT NULL,
  request_type  TEXT,
  request_agent TEXT,
  decision      TEXT NOT NULL,
  outcome       TEXT NOT NULL,
  effect        TEXT,
  detail        TEXT NOT NULL,
  human_reason  TEXT,
  project       TEXT,
  decided_by    TEXT NOT NULL,
  decided_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  CHECK (decision IN ('approved', 'denied', 'explained', 'timeout')),
  CHECK (outcome IN ('applied', 'no_effect', 'failed', 'refused'))
);

CREATE INDEX IF NOT EXISTS approval_decisions_decided_at_idx
  ON approval_decisions (decided_at DESC);
CREATE INDEX IF NOT EXISTS approval_decisions_inbox_idx
  ON approval_decisions (inbox_id, decided_at DESC);
