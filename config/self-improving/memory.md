# Self-Improving Memory (HOT Tier — ≤100 lines)

## Issue Lifecycle Rule (confirmed 2026-03-30, updated 2026-04-09)
Every agent must: (1) do the work, (2) PATCH issue to next status via Todero API with all required fields + transitioned_by, (3) let post-functions handle next assignee. Never consider a task done without updating the issue status. Include this in ALL subagent spawn instructions.

## Confirmed Preferences
- Communication: direct, no filler, no "Great question!" — just help (confirmed 2026-03-21)
- KAOS default model: claude-sonnet-4-6 (Claude Max plan). No OpenRouter. No GPT fallback unless Claude is fully unavailable (429/529). Always notify Michael when switching away and back. (updated 2026-04-09)
- When work is actively in progress, send Michael a short status update every 5 minutes. If idle, send nothing. (confirmed 2026-03-31)
- Always provide ≥1 alternative + clear recommendation when asking questions (confirmed 2026-03-22)
- Privacy: no data on Chinese servers — no Minimax etc (confirmed 2026-03-26)
- Response length: 1-2 paragraphs max unless detail requested (confirmed 2026-03-21)
- No narration on tool calls — just do it, return results (confirmed 2026-03-22)
- trash > rm for destructive operations (confirmed 2026-03-21)
- Model preference: use Claude by default as configured; only fall back to ChatGPT/Codex if Claude hits an API/availability limit, and explicitly tell Michael when switching away from Claude and when switching back (confirmed 2026-03-30)

## Sub-Agent Model Routing (3-tier, 2026-03-30)
| Agent | Default | Fallback | Escalate |
|---|---|---|---|
| main/kemuni-sme/vespera-sme/scout/builder | anthropic/claude-sonnet-4-6 | openai-codex/gpt-5.4 | anthropic/claude-opus-4-6 |
| ops/heartbeat/tester | anthropic/claude-haiku-4-5 | ollama/gemma3:4b (ops/hb) or claude-sonnet-4-6 (tester) | anthropic/claude-sonnet-4-6 |

Fallback → when Claude returns 429/529 or is unavailable.
Escalate → >3 interdependent systems, prior failure, "think harder" request, or context >60k tokens.
Always notify Michael when switching away from default and when switching back.

## Active Patterns
- Sub-agents for heavy work, only return result to main session (used 10x+)
- Deploy policy: ask Michael every time, max 1/day, webhook only (used 5x+)
- Heartbeat: claude-haiku-4-5, cheap model for cron/monitoring (used daily)
- Session resets every 3-5 days to prevent context bloat (used 2x)

## Workflow Rules (confirmed 2026-03-28)
- task-first: always create Supabase task before any code change — no exceptions
- test_tier: Builder sets P0-P3 before closing; Tester only acts on P0/P1, skips P2/P3
- PR windows: Builder pushes branches only; KAOS opens PRs at 8am/5pm only
- Commit format: `feat(MC-42): description` — always include task_key
- Unified issues table planned: epic→feature→task/bug, self-ref parent_id (migration 2026-03-30)
- n8n Discord nodes: use Code node with fetch(), NOT HTTP Request jsonBody — expressions don't evaluate in string mode

## Architecture Lessons (2026-03-28)
- Two separate tables (tasks + features — now renamed to issues) doesn't scale — migrate to one issues table with type + parent_id
- Discord bot needs keypair body params OR fetch() in Code node — jsonBody string is literal
- MC page.tsx is 4800+ lines — anti-monolith rule added: 200-line component limit, extract tabs to components/tabs/
- Supabase task insert fails with unknown type values — check constraint on type column; use existing values (feature/bug/ops/task)

## Site URL (confirmed 2026-04-10)
- Michael's live site is **https://kaos.nabit.work** (Cloudflare tunnel → localhost:3000). Always use this when referencing the UI.

## Recent (2026-04-09)
- All repos renamed: kaos-config (was ~/.openclaw/workspace), todero (was ~/mission-control)
- All LaunchAgents updated and reloaded
- OpenRouter deprecated — Claude Code + Claude Desktop is the stack
- 9 MVP Safety issues created in Todero DB under epic 599d3065
- Inbox escalation decision locked: Option C (park → re-queue → escalate after 3 cycles)
- Sprints = human reporting cadence only. Agents pull continuously from queue, never wait for sprint boundary.
- MVP plan doc: ~/kaos-config/docs/todero-mvp-plan.md (create with touch if missing)

## Issue Creation — Always via Todero API (enforced 2026-03-28, renamed 2026-04-09)
NEVER create issues via direct Supabase REST calls. Always use:
  curl -s -X POST http://localhost:3000/api/issues \
    -H "Content-Type: application/json" \
    -d '{"title":"...","project":"...","type":"ops","priority":"medium","assignee":"main","acceptance_criteria":"..."}'
The MC API enforces: title + project + acceptance_criteria required. DB also has CHECK constraint.
Direct Supabase inserts bypass enforcement — not allowed.
