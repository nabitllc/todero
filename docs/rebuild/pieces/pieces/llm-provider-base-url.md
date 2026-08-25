# PIECE: Give the OpenAI-compatible runtime a real base-URL seam

id: llm-provider-base-url
baseline score: 1/10
effort: M

## Why this piece matters
This IS the stated goal. Ollama is running on this machine with three tool-capable qwen2.5-coder models and the app reports availableCount 0, because the only OpenAI-compatible adapter is welded to api.openai.com over the https module and gates availability on an OpenAI key it will never have. Without this seam there is no 'any LLM'.

## Build instruction (from the Wave 1 audit — follow it, but you own the judgement)
Rewrite lib/runtimes/openai-api.ts around a configurable base: `const BASE = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1'`, parsed with `new URL()` so the protocol selects http vs https (replacing the hardcoded hostname at :183 and :257 and the unconditional https import). Replace the OPENAI_API_KEY gate in isAvailable() at :307 with a real reachability probe — GET `${BASE}/models` with a 2s timeout — that treats a missing key as valid whenever BASE is not api.openai.com. Delete the gpt-4o/o3/gpt-4o-mini alias map at :24-31 and take the model id verbatim from process.env.LLM_MODEL, falling back to the first id returned by the /models probe. Send the key as a bearer header only when LLM_API_KEY is set. This is the Helicone/Portkey pattern: the provider is a base URL, not a code branch.

## ACCEPTANCE — a critic will verify these against the RUNNING app
Against the running app, started with `LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5-coder:7b` and no OPENAI_API_KEY: (1) `curl -s http://localhost:3000/api/run-agent/runtimes` shows the openai-api runtime with available:true and availableCount >= 1 (currently 0); (2) the same command with LLM_BASE_URL pointed at an unreachable port shows available:false — proving the probe is real and not hardcoded true; (3) a request routed through the runtime appears in the Ollama server log.
