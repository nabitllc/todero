# Corrections Log

## 2026-03-27
- [12:22] MC chat should route through OpenClaw gateway, not OpenRouter
  Type: technical
  Context: Mission Control chat architecture
  Confirmed: yes (explicit instruction)

- [12:22] Use Claude Max plan instead of API keys / OpenRouter
  Type: technical
  Context: Cost/billing preference
  Confirmed: yes (explicit instruction)

## 2026-03-28
- [21:10] n8n HTTP Request jsonBody doesn't evaluate expressions — literal string sent
  Type: technical
  Context: Discord workflow automation via n8n
  Confirmed: yes (tested, fixed with fetch() in Code node)

- [21:10] Tasks + Features in separate tables doesn't scale — need unified issues table
  Type: architecture
  Context: Task management system design
  Confirmed: yes (Michael agreed, migration planned 2026-03-30)

- [21:10] Tester should NOT review all shipped tasks — only P0/P1 risk tier
  Type: process
  Context: QA workflow design
  Confirmed: yes (risk-tiered testing agreed by Michael)

## 2026-03-30
- [01:34] After compact/model switch, I should reconstruct from SOUL.md, USER.md, memory, and session files first instead of asking Michael to restate context
  Type: communication
  Context: Telegram handoff after OpenClaw compact + switch from Claude to ChatGPT
  Confirmed: yes (explicit correction)

- [09:37] Use Claude by default; only switch to ChatGPT/Codex on Claude API/availability limits, and explicitly notify Michael when switching away and when switching back
  Type: communication
  Context: Model routing preference for direct chats
  Confirmed: yes (explicit correction)

- [19:19] Builder subagents must create the task issue via MC API FIRST, confirm task_key, then start implementation. Never code first and create issue retroactively. Spawn prompts must enforce this order explicitly.
  Type: process
  Context: INF-125–282 batch — task creation order not enforced in spawn instructions
  Confirmed: yes (explicit correction)

- [2026-03-31 02:59 EDT] Pipeline ownership corrections:
  - Approved → Deployer responsible
  - Released → Auditor responsible for release verification, field completeness, and final checks
  - Closed → always clear assignee
  - Backlog should be owned by PO or SME, not KAOS unless strictly necessary (if KAOS had to own it, consider for retro)
  - Open should usually belong to the working agent (often Builder, sometimes Ops/other agent by issue type), not KAOS
  - Failed code review should return to open, not in_progress
  Type: workflow
  Context: pipeline ownership and TOD-488 follow-up
  Confirmed: yes

## Format
Each entry:
- [HH:MM] What was wrong → What's correct
  Type: format | technical | communication | project-specific
  Context: Where/when
  Confirmed: pending (N/3) | yes (reason)

## 2026-04-15
- [14:45] Do not create PRs for every code change during active development/migration sessions
  Type: workflow
  Context: Machine migration session — was creating PRs for docs changes and small fixes
  Rule: PRs are only needed when a Vercel deployment is required (i.e. the change needs to go live on Vercel and only Michael's merge can trigger that). For everything else — docs, config, scripts, non-Vercel changes — push directly to main with [skip ci]. Michael will say explicitly when a PR is needed.
  Confirmed: yes (explicit instruction 2026-04-15)
