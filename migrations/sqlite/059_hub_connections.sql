-- connections-discord: per-hub connections. SQLite form of migrations/059.
--
-- See that file for the two decisions this twin has to preserve:
--   1. the credential is a row in hub_connection_secrets, NOT a column of
--      hub_connections, so that `select *` on the connections table is
--      structurally incapable of returning one;
--   2. `config` is TEXT holding JSON rather than a JSON column, so the same
--      validator behaves the same way on both adapters.
--
-- The only difference from the Postgres file is the timestamp default, which
-- SQLite spells with strftime — the same substitution migration 058 makes.
--
-- The foreign key is declared here as documentation of intent and for any
-- connection that has `PRAGMA foreign_keys=ON`. It is NOT relied on: the
-- DELETE path in app/api/connections/hub/route.ts removes the secret row
-- explicitly, so the cascade is a second line of defence rather than the
-- first, and behaves identically whether or not the pragma is set.

CREATE TABLE IF NOT EXISTS hub_connections (
  id                 TEXT NOT NULL PRIMARY KEY,
  business_id        TEXT NOT NULL,
  provider           TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  config             TEXT NOT NULL DEFAULT '{}',
  custody            TEXT NOT NULL DEFAULT 'env',
  credential_env_var TEXT,
  credential_hint    TEXT,
  credential_set_at  TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS hub_connections_hub_provider_idx
  ON hub_connections (business_id, provider);

CREATE INDEX IF NOT EXISTS hub_connections_business_idx
  ON hub_connections (business_id);

CREATE TABLE IF NOT EXISTS hub_connection_secrets (
  connection_id TEXT NOT NULL PRIMARY KEY
                     REFERENCES hub_connections (id) ON DELETE CASCADE,
  ciphertext    TEXT NOT NULL,
  algorithm     TEXT NOT NULL DEFAULT 'aes-256-gcm',
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
