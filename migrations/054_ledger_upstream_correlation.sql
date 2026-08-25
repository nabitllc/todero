-- evidence-based-verification (round 2): upstream correlation columns.
--
-- Round 1's verifier declared a live Ollama dispatch PASS from mere
-- co-occurrence in a time window: any agent_runs row + any token_ledger row +
-- a trace file grabbed by a readdir() fallback + any Ollama POST that
-- happened to fall in the same window, no matter which run actually caused
-- it. A claude-code row (which never touches Ollama) could be "corroborated"
-- by an unrelated Ollama request from a different process entirely.
--
-- These four columns give a single token_ledger row a fact only the process
-- that made the HTTP call to the LLM endpoint could have written: the
-- upstream's own response id, the model it reports, and the wall-clock
-- window the fetch to `${LLM_BASE_URL}/chat/completions` actually spanned.
-- scripts/evidence/verify.mjs now requires an Ollama GIN log line whose
-- timestamp falls inside [upstream_started_at, upstream_finished_at] AND
-- whose own duration matches that window within 1s — a coincidence in the
-- same 15-minute window is no longer sufacient.
--
-- Populated only by lib/runtimes/openai-api.ts (the only adapter that talks
-- to an OpenAI-compatible endpoint / Ollama). claude-code, codex and cursor
-- rows never set these columns, which is itself part of the fix: a row with
-- runtime != 'openai-api' can never be corroborated by an Ollama line, and
-- verifyLiveDispatch() now checks the runtime column before it looks at
-- Ollama's log at all.

ALTER TABLE token_ledger
  ADD COLUMN IF NOT EXISTS provider_response_id  TEXT,
  ADD COLUMN IF NOT EXISTS provider_model         TEXT,
  ADD COLUMN IF NOT EXISTS upstream_started_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS upstream_finished_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS token_ledger_provider_response_idx
  ON token_ledger (provider_response_id)
  WHERE provider_response_id IS NOT NULL;
