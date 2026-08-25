# PIECE: Replace hardcoded macOS paths with an OS-abstraction module

id: cross-platform-paths
baseline score: 1/10
effort: L

## Why this piece matters
The single most literal expression of 'one-Mac appliance'. Core API routes 500 on any machine that is not the author's — reconfirmed live: /api/agents 500s on C:/Users/msaen/kaos-config/AGENTS.md. Until this lands, the app is not portable in any meaningful sense regardless of what the LLM layer does.

## Build instruction (from the Wave 1 audit — follow it, but you own the judgement)
Add lib/paths.ts exporting TODERO_DIR, WORKSPACE_DIR, CONFIG_DIR and LOG_DIR, each resolved as `process.env.TODERO_* ?? path.join(os.homedir(), ...)` with LOG_DIR defaulting to os.tmpdir() — never the literal /tmp. Add a resolveBinary(name) helper that finds CLI binaries via PATH lookup (`where` on win32, `which` elsewhere) instead of assuming /opt/homebrew. Replace every literal in app/api/agents/route.ts:43, app/api/files/route.ts:7, app/api/issues/route.ts:46-48, app/api/run-agent/route.ts:37-39 and :598, app/api/status/route.ts:11, app/api/automations/route.ts:64, config/migrations/seed-agent-db.ts, and lib/runtimes/{claude-code.ts:20, codex.ts:21, cursor.ts:22}. Guard the macOS-only Library/Application Support and LaunchAgents reads behind a `process.platform === 'darwin'` check that returns an empty result rather than throwing on other platforms. Mission Control (builderz-labs) is the pattern here: no host assumptions, everything resolves from the process environment.

## ACCEPTANCE — a critic will verify these against the RUNNING app
Against the running app on Windows: (1) `grep -rnE '/Users/|/opt/homebrew|/bin/bash|/tmp/' --include='*.ts' --include='*.tsx' app/ lib/ | grep -v node_modules | wc -l` -> 0 (currently 24 hits in 12 files); (2) GET /api/agents -> 200; (3) GET /api/status -> 200 with no ENOENT in the body; (4) GET /api/files -> 200; (5) GET /api/automations -> 200 (empty list is acceptable, a 500 is not).
