-- TOD-2415: per-hub settings, key/value.
--
-- First consumer is bolt_start_hour (default 5 — bolts open and close at 5am
-- local). Deliberately key/value rather than a column per setting: the Discord
-- per-hub connection (FEEDBACK.md item 9) needs the same shape, and a table
-- that grows a column per preference grows a migration per preference.
--
-- Value is TEXT. Callers parse and, more importantly, VALIDATE — a settings
-- table that stores "25" for an hour is a settings table that renders a bolt
-- starting at 25:00.

CREATE TABLE IF NOT EXISTS hub_settings (
  business_id TEXT        NOT NULL,
  key         TEXT        NOT NULL,
  value       TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, key)
);

CREATE INDEX IF NOT EXISTS hub_settings_business_idx ON hub_settings (business_id);
