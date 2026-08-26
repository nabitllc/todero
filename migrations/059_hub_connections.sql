-- connections-discord: per-hub outbound connections, and their credentials.
--
-- FEEDBACK.md item 9 — "Discord should be there so something can be added per
-- project ... so the user can add Discord from scratch to a hub." Today the
-- only Discord credential the app has is a literal in app/api/issues/route.ts,
-- which means a stranger's clone posts as this repo's author's bot. This is
-- where the credential goes instead.
--
-- WHY NOT THE EXISTING `connections` TABLE (migration 045)
--   It is keyed by `workspace_id`, not `business_id`, so it cannot answer "the
--   Discord connection for THIS hub"; its `type` CHECK constraint has no
--   'discord' member, so widening it is an ALTER on a live constraint; and it
--   has no SQLite twin, so it does not exist at all on the adapter a fresh
--   clone resolves to. Extending it would have been three migrations pretending
--   to be one.
--
-- WHY THE CREDENTIAL IS IN A SECOND TABLE
--   This is the load-bearing decision, so it is written down here rather than
--   in a commit message.
--
--   If the ciphertext were a column of `hub_connections`, then every
--   `select('*')` on that table — including one added a year from now by
--   someone who has never read this file — would return a credential, and the
--   only thing standing between it and an HTTP response would be each call
--   site's discipline about column lists. That is precisely the arrangement
--   that put a bot token in a client-visible payload in the first place.
--
--   Splitting it means the leak requires a DELIBERATE second query against a
--   table named `hub_connection_secrets`. `hub_connections` can be selected
--   whole, dumped, logged, or handed to a UI, and it still cannot produce a
--   credential. Fail-closed by construction rather than by review.
--
--   What DOES live on `hub_connections` is credential METADATA, which is not
--   the credential: `credential_hint` (the last 6 characters, so the operator
--   can tell which token is installed without being shown it),
--   `credential_set_at`, and `custody`.
--
-- CUSTODY HAS TWO MODES, and the row says which
--   'env'    — the credential is NOT stored. `credential_env_var` names an
--              environment variable the server process reads at send time.
--              Nothing sensitive is at rest; the tradeoff is that the value is
--              only as per-hub as the process is.
--   'stored' — the credential is AES-256-GCM ciphertext in
--              `hub_connection_secrets`, encrypted by lib/encryption.ts under
--              CONNECTIONS_ENCRYPTION_KEY. If that key is absent the write is
--              REFUSED. There is deliberately no plaintext fallback: a column
--              that sometimes holds ciphertext and sometimes holds a token is
--              a column nobody can reason about.
--
-- WHY `config` IS TEXT AND NOT JSONB
--   The same schema has to hold on Postgres and on SQLite (see the sqlite/
--   twin). A JSONB column comes back from one adapter as an object and from
--   the other as a string, so a validator written against it would behave
--   differently per adapter — exactly the vendor drift lib/db.ts exists to
--   prevent. TEXT holding JSON parses identically on both, and the validation
--   that matters (which keys, which value shapes) happens on WRITE in
--   lib/connections.ts, never at the read site.

CREATE TABLE IF NOT EXISTS hub_connections (
  id                 TEXT        NOT NULL PRIMARY KEY,
  business_id        TEXT        NOT NULL,
  provider           TEXT        NOT NULL,
  display_name       TEXT        NOT NULL,
  -- JSON object of provider-declared keys only. Unknown keys are refused by
  -- the API before they get here; this column is not a free-form bag.
  config             TEXT        NOT NULL DEFAULT '{}',
  -- 'env' | 'stored'. Enforced in lib/connections.ts, which is also what the
  -- SQLite twin can enforce; a CHECK here and no CHECK there would be a
  -- constraint that exists on one operator's machine and not another's.
  custody            TEXT        NOT NULL DEFAULT 'env',
  -- custody='env': the variable name. NULL for custody='stored'.
  credential_env_var TEXT,
  -- Last 6 characters of the credential, for display. Never the credential.
  credential_hint    TEXT,
  credential_set_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One connection per hub per provider. Two Discord connections on one hub
-- would make "which token does this hub post with" unanswerable, and the
-- cutover in app/api/issues/route.ts needs a deterministic answer.
CREATE UNIQUE INDEX IF NOT EXISTS hub_connections_hub_provider_idx
  ON hub_connections (business_id, provider);

CREATE INDEX IF NOT EXISTS hub_connections_business_idx
  ON hub_connections (business_id);

-- The credential, and nothing else. See the note above for why this is not a
-- column of hub_connections.
CREATE TABLE IF NOT EXISTS hub_connection_secrets (
  connection_id TEXT        NOT NULL PRIMARY KEY
                            REFERENCES hub_connections (id) ON DELETE CASCADE,
  -- lib/encryption.ts format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>".
  ciphertext    TEXT        NOT NULL,
  -- Recorded so a future key rotation can tell rows apart instead of guessing.
  algorithm     TEXT        NOT NULL DEFAULT 'aes-256-gcm',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
