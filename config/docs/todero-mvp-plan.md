# Todero MVP Plan
**Updated:** 2026-04-09 | **Owner:** Michael Saenz, Nabit LLC
**Source:** Synthesized from master_plan.docx, mvp_tracker_v2.docx, MVP draft, and live DB audit

---

## Core Philosophy

Todero is an AI Orchestrator, NOT Jira. The only MVP metric that matters: **autonomous execution without infinite loops.**

- State-driven prompts: workflows exist solely as state-machine constraints
- Agents work 24/7/365 within token/cost limits — no mood drain on idle
- Sprints are a **human reporting cadence only** — agents pull continuously from the queue
- Human oversight only where necessary — the Inbox is the single friction point
- The Active Epic is the work focus — agents only pull issues belonging to currently Active Epics
- Similar Admin to Jira, completely enforced — agents can't derail regardless of file changes

---

## Two Repos — Single Source of Truth

| Repo | Path | Purpose |
|---|---|---|
| **KAOS Config** | `~/todero/config` | Agent brain — SOUL, AGENTS, memory, skills, scripts. No UI. |
| **Todero App** | `~/todero` | Next.js web app — UI, API, database, components. |

KAOS Config is the mind. Todero App is the body. KAOS reads config and acts on the world by calling the Todero API and writing code to the Todero codebase.

---

## Named Concepts

| Term | Definition |
|---|---|
| Hub | A workspace — one company or project. Each Hub runs independently. |
| Crew | The team tab inside a Hub — shows all agents with role, status, activity. |
| Consultant Agent | Temporary agent for a scoped task — requires human Inbox approval before activation. |
| KAOS (main) | The Admin/Orchestrator — dispatches work, manages dependency graph, reviews outputs. |
| Worker Agent | Scoped specialist — assigned specific issues within their capability domain. |
| God Mode | Human Owner — full override across all Hub operations. |
| Inbox | The friction point — all human-approval requests surface here. |
| Kill Switch | Play/Pause — Pause halts ALL API calls platform-wide immediately. |
| READY | Dependency gate status — issue cannot be picked up unless all blockers resolved. |
| Heartbeat | 30-min CRON wakeup for KAOS — runs 6 checks, enforces >=1 Epic always Active. |

---

## MVP Epics (in execution order)

### Epic 1: Global Shell & Navigation (TOD-526) — ACTIVE
The persistent application shell: top bar, sidebar, hub switcher, search, run/pause control.
- 4 features, 23 tasks
- Status: Active, Builder working

### Epic 2: MVP Safety & Autonomy (TOD-710) — DRAFT
Kill Switch, Inbox, Loop Breaker, Circuit Breaker, Heartbeat enforcement.
- 10 features (including Agent Retros TOD-729)
- Status: Backlog, pending TOD-526 completion

### Epic 3: Agent Best Practices (TOD-483) — DRAFT
Dual review, workspace context loading, persistent memory, verified config.
- Status: Draft, spec in progress

### Epic 4: Auth & Credentials (NEW — needs creation)
User sign-up/sign-in, multi-hub support, invite users, session management.
- **From MVP draft:** User can sign up, sign in, create hubs, have multiple hubs, invite humans
- Blocks alpha tester access

### Epic 5: Permissions & User Groups (NEW — needs creation)
Role-based access: God Mode (human owner), Admin (main agent), Worker (scoped agents).
- **From MVP draft:** User groups, non-editable platform defaults, agent permissions
- Unchangeable for MVP: workflows, essential agents, essential agent files, agent permissions

### Epic 6: Admin Configuration (NEW — needs creation)
Jira-like admin for: projects, issue types, workflows, issue fields, automations.
- **From MVP draft:** Similar to Jira admin, completely enforced
- MVP: read-only views of workflows and fields; editing is post-MVP

### Epic 7: Settings & Connections (TOD-533 area)
API keys (LLMs, payment methods, tools), costs tracking, backups, user management.
- **From MVP draft:** LLM keys, payment methods, costs per tool/membership, backups
- Connect to local Ollama for local LLM

### Epic 8: Activity Feed & Audit (existing features)
Permission changes, issue transitions, agent file updates, API changes, PR events, sprint events, daily summary.
- **From MVP draft:** 14 event categories, color-coded, 1-line with click-to-detail, All/Highlights filter
- Highlights: epic/feature creation or closure, first revenue, etc.

### Epic 9: Inbox & Human Interaction (TOD-715 + related)
Approve/Deny/Explain for: API keys, budget increases, new hires, new epics/features, PR approval.
- **From MVP draft:** Auto-approve timer (1h or 24h option), 3 actions per request
- Post-deny: Option C (park, re-queue, escalate after 3 cycles)

### Epic 10: Contact Support (NEW — needs creation)
Tier 1: chatbot. Tier 2: severity-based routing (S0-1 notify human, S2-3 create bug issue).
- **From MVP draft:** Duplicate detection before creation, watcher system, resolution notification
- Feature requests auto-create issues with watcher

### Epic 11: Onboarding (TOD-560 area)
5-step wizard: Vision & Identity, API Keys, Knowledge Dump, First Objective, Ignition.
- **From MVP draft:** Standardized start (how to read goal, what agents/skills first, non-editable elements)

### Epic 12: Chat & Agent Communication (TOD-534 area)
Agent selector, LLM selector, file upload, chat history.
- **From MVP draft:** Choose agent + LLM per chat, view history, upload files

### Epic 13: Agent Management & Marketplace (NEW — needs creation)
Agent MGMT view, Agent/Skills Marketplace.
- **From MVP draft:** Marketplace for discovering/adding agents and skills
- MVP: view-only marketplace; custom agents post-MVP

---

## Issue Type Hierarchy

| Level | Type | Rules |
|---|---|---|
| Epic | Large multi-sprint theme | No code changes. Statuses: backlog, draft, active, completed, closed. |
| Feature | Shippable capability with AC | No code changes. Child of Epic. Groups tasks. |
| Task | Single implementable unit (1-2 days) | Code changes happen here. Child of Feature. Assigned to builder. |
| Bug | Something broken | Code changes happen here. References affected Feature. Assigned to builder. |
| Ingo | Config/infra/setup | Code/config changes. Standalone OK. Assigned to ops. |
| Research | Research/evaluate | No code. Standalone OK. Assigned to scout. |

**Key rule:** Code changes only at Task/Bug/Ops level. Features and Epics are organizational containers.

---

## Status Categories (4 categories)

| Category | Statuses | Meaning |
|---|---|---|
| **Planned** | backlog, defined, open | Work not yet started |
| **Ongoing** | in_progress, code_review, product_review, approved | Active work |
| **SignOff** | released, completed | Work done, awaiting final sign-off |
| **Done** | closed | Terminal |

**Epic-specific statuses:** backlog, draft, active, completed, closed

**Retired statuses:** in_review (use code_review), blocked (use is_blocked flag), cancelled (resolution_type only)

---

## Issue Pipeline (Execution Workflow)

### Task/Bug/Ops Workflow
```
backlog -> defined -> open -> in_progress -> code_review -> approved -> released -> completed -> closed
```

### Feature Workflow
```
backlog -> defined -> open -> in_progress -> product_review -> approved -> released -> closed
```

### Epic Workflow
```
backlog -> draft -> active -> completed -> closed
```

**Key workflow rules:**
- `code_review` triggers dual review: Tester + Designer both must pass
- Both pass -> auto-advance to `approved`; either fails -> revert to `open`
- 3+ failures -> `is_blocked=true`, assigned to KAOS for escalation
- `approved` -> auto-assigns to deployer
- `released` -> auto-assigns to auditor
- `closed` -> assignee cleared
- Features should not advance to review until all child tasks are done

---

## Infrastructure Status (as of 2026-04-09)

| Service | Status | Notes |
|---|---|---|
| Todero App | Running | Mac mini, Apple Silicon, Node 22 |
| Supabase | Connected | Kemuni HQ + Vespera + Agent Brain |
| Cloudflare Tunnel | Active | kaos.nabit.work live |
| Vercel | Deployed | Front-end live |
| GitHub | Connected | nabitllc/todero |
| n8n | OFFLINE | Replace with native automations |
| Telegram | Disconnected | Reconnect for agent alerts |

**Built today (2026-04-09):**
- Sprint close/start API routes (POST /api/sprint-close, /api/sprint-start)
- Sprint automation LaunchAgent (com.nabit.sprint-cycle, 6:55am daily)
- PR window updated for single-PR strategy + todero repo
- Board UI redesigned (6 columns, compact cards, no epics/features)
- Active Agents card rewritten (Supabase-based, live countdown)
- TOD-621 implemented (retired in_review and blocked statuses)
- Task_key dedup completed, sequence hardened

---

## Sprint Model

- **Duration:** 24 hours (7am to 7am EDT)
- **Sprints are per Hub** (business_id), not per project
- **Sprint close:** 6:55am daily via LaunchAgent, posts retro to Discord, auto-starts next sprint
- **Sprint start:** Creates new sprint, assigns carried-over issues
- **PR window:** 7am and 7pm EDT, creates 1 release PR per repo per window
- **Agents work continuously** — sprints are human reporting cadence only

---

## Heartbeat — 6 Checks (every 30 minutes)

1. Is any Epic marked Active? If not -> activate highest-priority Epic immediately
2. Are there unblocked backlog issues with no assignee? -> assign and move to Open
3. Are any lanes idle while eligible work exists? -> alert and re-assign
4. Is Claude budget below threshold? -> create Inbox warning
5. Are any agents stale in_progress (>2h no activity)? -> move back to open
6. Is automation stack healthy? -> alert if offline

**Rule:** >=1 Epic must ALWAYS be Active. Non-negotiable.

---

## Universal System Prompt Wrapper (injected into all agents)

- **Loop Breaker:** Halt and log after 3 identical consecutive failures
- **Mock & Move On:** If missing data/keys, mock response, log to Inbox, keep building
- **Commit Hook:** Force git commit every 50 lines of code
- **Scope Lock:** Cannot modify files outside assigned issue scope
- **Agent Split Trigger:** If context window exceeds 60% capacity, request Admin to spawn new specialized agent

---

## Agent Proactivity (from MVP draft open questions)

- **When to divide an agent:** When context exceeds 60% capacity or agent handles >3 unrelated domains
- **How to be proactive:** Heartbeat checks + continuous queue pulling from active epics
- **Commit frequency:** Every 50 lines of code or every logical unit of work
- **STG vs Production:** Agents can merge to staging branches; never push to main directly. KAOS pushes at PR windows only.
- **Onboarding always includes:** Goal reading, initial agent creation, skill creation, non-editable platform defaults
- **File conversion:** All text files (Word, PDF) converted to .md on ingestion to reduce token costs

---

## Open Decisions — Resolved

| Decision | Resolution |
|---|---|
| Inbox auto-deny escalation | Option C. Park -> re-queue -> escalate after 3 cycles. |
| Sprint vs agent work boundary | Sprints = human reporting only. Agents pull continuously. |
| OpenRouter | Deprecated. Claude Code + Claude Desktop is the stack. |
| n8n | Replace with native LaunchAgents + Todero API routes. |
| Cancelled status | Not a status. Resolution_type only. |

---

## Naming — Locked

| Old | New |
|---|---|
| Mission Control | Todero (the app) |
| ~/.openclaw/workspace | ~/todero/config (the agent brain) |
| ~/mission-control | ~/todero (the app) |
| MC API | Todero API |
| kaos-mission-control (GitHub) | todero (GitHub) |
