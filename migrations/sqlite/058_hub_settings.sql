-- TOD-2415: per-hub settings, key/value. SQLite form of migrations/058.
-- See that file for why this is key/value rather than a column per setting.

CREATE TABLE IF NOT EXISTS hub_settings (
  business_id TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (business_id, key)
);

CREATE INDEX IF NOT EXISTS hub_settings_business_idx ON hub_settings (business_id);
