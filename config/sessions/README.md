# Agent Sessions (TOD-794)

This directory will hold long-lived per-agent session state once the persistent
sessions epic (TOD-794) ships. It is blocked on TOD-793 (runtime adapter),
which is now scaffolded (2026-04-10).

## Layout

```
sessions/
├── builder/
│   ├── session-state.md      # current task, last decision, next move
│   ├── working-buffer.md     # volatile breadcrumbs
│   ├── conversation.jsonl    # raw log
│   └── compact-summary.md    # auto-generated when >60% context
├── tester/
├── designer/
├── ops/
├── po/
├── scout/
├── auditor/
├── deployer/
└── main/
```

## Current Status

**Not active.** Agents run stateless via `claude --print` through the Claude
Code runtime adapter (`lib/runtimes/claude-code.ts`). Each spawn is a fresh
context with no memory of prior tasks or corrections.

## What Needs to Happen to Activate This

1. Add `supportsSessions: true` to an appropriate runtime adapter (Claude Code
   with `--session-id`, or a new adapter that keeps an interactive subprocess)
2. Implement `AgentRuntime.dispatch(opts)` alongside `spawn(opts)` — dispatch
   reuses an existing session, spawn creates one.
3. Add a session supervisor that:
   - Starts each agent's session on boot
   - Watches for crashes and restarts with state-preserved
   - Triggers memory-compaction when context crosses 60%
   - Persists `session-state.md` between turns
4. Migrate the post-task loop from "spawn then forget" to "dispatch then monitor"
5. Add crash-recovery + memory-compaction hooks

## Why This Matters

Statelessness is the #1 root cause of "agents forget to PATCH status", "agents
lose context on chaining", and "agents don't learn from corrections". Without
session continuity, the self-improving skills at `~/todero/config/skills/` cannot
write back to `corrections.md` or `session-state.md`.

See `~/todero/config/skills/proactivity/execution.md` and
`~/todero/config/skills/self-improving/memory.md` for the contract each session
needs to honor.
