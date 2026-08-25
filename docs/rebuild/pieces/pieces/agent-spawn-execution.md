# PIECE: Replace /bin/bash shell-string spawns with a portable detached spawn

id: agent-spawn-execution
baseline score: 0/10
effort: M

## Why this piece matters
Guaranteed ENOENT on any non-POSIX host — verified: spawnSync('/bin/bash', ...) fails on this machine. Even with a working runtime and correct paths, dispatching an agent cannot succeed. This plus the base-URL seam are the two halves of 'run an agent anywhere'.

## Build instruction (from the Wave 1 audit — follow it, but you own the judgement)
Create lib/runtimes/detached-spawn.ts exporting one function that takes (bin, argv[], logFile) and calls `child_process.spawn(bin, argv, {detached:true, stdio:['ignore', fs.openSync(logFile,'a'), fs.openSync(logFile,'a')], windowsHide:true})` followed by `.unref()` — no shell, argv array instead of a quoted string, so nohup/disown//dev/null disappear entirely. Replace the spawn call sites at lib/runtimes/openai-api.ts:362-367, lib/runtimes/claude-code.ts:156, lib/runtimes/codex.ts:79-80 and lib/runtimes/cursor.ts:74-75 with it, and source the log path from lib/paths.ts LOG_DIR (os.tmpdir()) instead of the literal at app/api/run-agent/route.ts:598. Return the child pid and the log path from the runtime so the caller can report status.

## ACCEPTANCE — a critic will verify these against the RUNNING app
Against the running app on Windows, with RBAC fixed and LLM_BASE_URL set to Ollama: (1) `curl -X POST -b 'mc-auth=kaos2026; mc-role=owner' 'http://localhost:3000/api/run-agent?agent=builder'` -> 200 (not 403, not a 500 mentioning ENOENT or /bin/bash); (2) the response names a log file path that exists on disk under the OS temp dir and grows; (3) `grep -rn "'/bin/bash'" lib/runtimes/` -> 0 matches.
