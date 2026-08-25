# PIECE: Add npm run setup — a working clone-to-running path

id: first-run-bootstrap
baseline score: 0/10
effort: M

## Why this piece matters
This is the acceptance test for the entire goal. Right now a stranger's path dies five times: the env template never names an LLM base-URL variable, no migration creates role_permissions so the highest-privilege role 403s everywhere, no runtime reports available, the OpenAI adapter dials the cloud, and the spawn hits /bin/bash ENOENT. All the other wave-one pieces are only real if this script proves them from a clean checkout.

## Build instruction (from the Wave 1 audit — follow it, but you own the judgement)
Add `npm run setup` as a plain node script (not bash — there are currently zero .ps1 files and start.sh hardcodes a mac path at line 5). It should: (a) copy .env.local.template to .env.local, extending the template with LLM_BASE_URL=http://localhost:11434/v1, LLM_MODEL=qwen2.5-coder:7b and LLM_API_KEY= (currently the template names only ANTHROPIC_API_KEY at :17 and OPENROUTER_API_KEY at :51); (b) probe LLM_BASE_URL/models and print the models it found, or a clear instruction if nothing answers; (c) probe the Supabase env vars and print exactly which are missing; (d) run `npm run db:migrate` if that exists, else print the manual step. Add a `doctor` script that reports host platform, resolved paths from lib/paths.ts, resolved CLI binaries, and runtime availability. Rewrite README.md:17 to stop telling strangers production is started by a macOS LaunchAgent. Mission Control (builderz-labs) is the bar: Node + one dependency, no host assumptions.

## ACCEPTANCE — a critic will verify these against the RUNNING app
On a clean clone in a temp directory with no .env.local: `npm install && npm run setup && npm run dev` completes without manual editing, and then (1) GET /api/issues with the owner cookie -> 200; (2) GET /api/run-agent/runtimes -> availableCount >= 1; (3) GET /api/agents -> 200; (4) `npm run doctor` prints the three qwen2.5-coder models found at localhost:11434 and reports zero missing required env vars. A critic must be able to run this from a fresh checkout without reading any source file.
