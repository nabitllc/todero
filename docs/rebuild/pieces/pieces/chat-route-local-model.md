# PIECE: Make the Chat tab's local model actually go to the local model

id: chat-route-local-model
baseline score: 0/10
effort: S

## Why this piece matters
The single most direct violation of 'no pretending', and the fastest end-to-end proof of the goal for the owner: a UI option labelled 'Private, free, offline' currently ships the user's prompt to openrouter.ai. Fixing it turns the local-LLM work from plumbing into something visible and usable in the product on day one.

## Build instruction (from the Wave 1 audit — follow it, but you own the judgement)
Rewrite app/api/chat/route.ts so provider selection comes from the model id rather than the hardcoded OPENROUTER_BASE at :9. Route any id prefixed 'ollama/' (or, better, any id whose provider prefix resolves to a configured base URL) through the same openai-api runtime built in llm-provider-base-url, so it reaches LLM_BASE_URL. Delete the silent fallback to anthropic/claude-sonnet-4-5 at :24 — an unknown model id must return a 400 naming the unknown id, never quietly substitute a different vendor's model. Update the model list in components/tabs/ChatTab.tsx:134 to be populated from a GET of the configured endpoint's /models rather than hardcoded, so the label matches what is actually reachable.

## ACCEPTANCE — a critic will verify these against the RUNNING app
Against the running app with LLM_BASE_URL=http://localhost:11434/v1 and no OPENROUTER_API_KEY: (1) selecting the local model in the Chat tab at http://localhost:3000/chat and sending a message returns a real streamed completion, and the Ollama server log shows the request; (2) `curl -X POST http://localhost:3000/api/chat -d '{"modelOverride":"ollama/qwen2.5-coder:7b",...}'` no longer returns 'OpenRouter error: 401'; (3) posting an unknown model id returns 400 naming that id rather than silently answering from Claude; (4) the Chat tab model dropdown lists the qwen2.5-coder models actually present on the host.


---

## OWNER OVERRIDE 2026-08-24 — LOCAL ONLY. NO OPENROUTER.
The owner has ruled out openrouter.ai entirely. Do not route to it, do not fall
back to it, do not keep it as a selectable option in the model picker.

Required behaviour:
- The ONLY provider wired up for chat right now is the local OpenAI-compatible
  endpoint at LLM_BASE_URL (http://localhost:11434/v1 on this machine).
- DELETE the OpenRouter base URL, the OPENROUTER_API_KEY read, and the
  `anthropic/claude-sonnet-4-5` silent fallback from app/api/chat/route.ts.
- The model dropdown in components/tabs/ChatTab.tsx must be populated from a live
  GET of ${LLM_BASE_URL}/models. If that endpoint does not answer, render an
  explicit error naming the URL that failed — never a hardcoded vendor list, and
  never a cloud model the user cannot reach.
- An unknown/unreachable model id returns 400 naming the id. No silent substitution.
- Keep the provider seam itself generic (it is a base URL, not a vendor branch) so
  a cloud provider can be added later by configuration — but ship ZERO cloud
  providers configured today.

Additional acceptance conditions (all must hold):
7. `grep -rni "openrouter" app/ lib/ components/ | wc -l` -> 0
8. The Chat model dropdown lists exactly the models Ollama reports on this host
   (qwen2.5-coder 7b / 14b / 32b) and nothing else.
9. With Ollama stopped, the Chat tab shows an explicit error naming
   http://localhost:11434/v1 — not an empty state and not a cloud fallback.
