# PROJECT.md — Todero Dossier

## What It Is

Todero is the AI-run company operating system. A Next.js 14 + Supabase app that orchestrates a pipeline of AI agents (PO, Builder, Tester, Designer, Ops, Auditor, Deployer, KAOS, SMEs) through a workflow: `backlog → draft → defined → open → in_progress → code_review → approved → released → closed`.

**Production:** `https://kaos.nabit.work` (Cloudflare tunnel → localhost:3000)
**Repo:** `~/todero`
**Companion config:** `~/todero/config` (SOUL, AGENTS, memory, skills, LaunchAgents)

## Target Users

### Primary: Michael Kyu (current)
Solo founder running multiple products (Kemuni, Vespera). Needs a pipeline that ships real work while he focuses on product vision. Uses Todero as his single source of truth for issue state and agent activity.

### Secondary: Small teams / solo founders (future)
Anyone who wants AI-run engineering but cares about outcomes over prompt-engineering. Todero gives them:
- Multi-agent pipeline with clear handoffs
- Structured workflow with validators
- Observability (agent_runs, token ledger, activity feed)
- LLM-agnostic runtime adapter (Claude, Codex, Cursor, OpenAI API)

## What Makes Todero Different

- **Not a copilot.** Agents own their lane and finish work autonomously.
- **Workflow-first.** Every state transition has validators. No agent can skip steps.
- **Pipeline, not chat.** Queue runners claim issues based on status + DoR fields. No human babysitting.
- **Dual review.** Tester + Designer both must pass before `code_review → approved`.
- **Self-healing.** `start.sh` checks node_modules, BUILD_ID, typescript. Stale claims get auto-recovered.
- **Hub-scoped SMEs.** Each product domain (Todero itself, Kemuni, Vespera, Infrastructure) has a dedicated SME that owns Tier-1 decomposition.

## Key Architectural Decisions

| Decision | Why |
|---|---|
| Next.js 14 App Router + Supabase | Michael knows the stack, no auth tax for internal tool |
| Runtime adapter layer (`lib/runtimes/`) | LLM agnosticism — swap Claude Code for Codex/Cursor per agent |
| Worktree-per-spawn | Isolates concurrent agents so branches don't collide |
| Dual-review gate | Catches both logic bugs (tester) and UX bugs (designer) before merge |
| 3-strike loop breaker | Stops agents from burning cycles on the same defective code |
| Rejection-aware spawn prompt | Injects previous-attempt notes so Builder doesn't re-generate same bug |
| PR window enforcement | One batched review surface per day instead of N per-issue PRs |
| Hub-scoped SMEs as Tier-1 decomposers | Product expertise stays local; Todero epics don't get decomposed by Kemuni SME |

## Current Scope (as of 2026-04-11)

**Foundational epics in flight:**
- **TOD-794** Persistent Agent Sessions (draft) — THE critical-path epic. Every stateless `--print` spawn is a bug waiting to happen.
- **TOD-792** Inbox + Human-Approval System (backlog, migration live, needs UI + agent integration)
- **TOD-793** Runtime Adapter (backlog, scaffold exists, needs Codex/Cursor adapters)

**Active product epics:**
- TOD-710 MVP Safety & Autonomy — 8 children in flight
- TOD-483 Agent Best Practices — 36/41 done
- TOD-482 Infrastructure Platform Hardening — 19/26 done
- TOD-531 Office & Board, TOD-530 Pipeline, TOD-527 Overview, TOD-526 Global Shell

## Non-Goals

- Not a general-purpose task manager. Todero exists to run AI pipelines.
- Not multi-tenant SaaS yet. Single operator.
- Not a replacement for product vision. Agents decompose, implement, review — they don't decide what to build.

## Where to Look First (Todero SME reading order)

1. `~/todero/config/SOUL.md` — who you are
2. `~/todero/config/AGENTS.md` — the 3-tier decomposition model, lifecycle, dual-review, WIP enforcement
3. `~/todero/config/CLAUDE.md` — system paths, LaunchAgents, scripts
4. `~/todero/CLAUDE.md` — Todero Next.js app layout, MC API rules
5. `~/todero/config/memory/2026-04-10.md` + `memory/2026-04-11.md` — recent session logs
6. `~/todero/lib/agent-queue.ts` — current queue configs
7. `~/todero/lib/runtimes/` — runtime adapter layer
8. `~/todero/app/api/run-agent/route.ts` — the spawn endpoint (source of truth on how agents are invoked)
9. `~/todero/app/api/issues/route.ts` — MC API, validators, workflow gates
