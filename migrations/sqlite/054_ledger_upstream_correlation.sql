-- evidence-based-verification (round 2): mirrors
-- migrations/054_ledger_upstream_correlation.sql for the sqlite adapter — see
-- that file for why. SQLite's ALTER TABLE has no IF NOT EXISTS on ADD COLUMN,
-- so this file is written to run once against a fresh baseline like every
-- other migration in this directory (000_baseline.sql already carries every
-- column landed before it existed; this one only needs to carry itself).
ALTER TABLE token_ledger ADD COLUMN provider_response_id TEXT;
ALTER TABLE token_ledger ADD COLUMN provider_model TEXT;
ALTER TABLE token_ledger ADD COLUMN upstream_started_at TEXT;
ALTER TABLE token_ledger ADD COLUMN upstream_finished_at TEXT;

CREATE INDEX IF NOT EXISTS token_ledger_provider_response_idx
  ON token_ledger (provider_response_id);
