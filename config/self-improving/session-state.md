# Session State
# Updated: 2026-04-09

## Current Objective
Build Todero. First sprint running. Workflow automations shipping.

## Repo Rename Status (2026-04-09)
- `~/.openclaw/workspace` → `~/kaos-config` — DONE
- `~/mission-control` → `~/todero` — DONE
- Business "Mission Control" renamed to "Todero" in Supabase
- "Todero" project record created under Todero business

## Current Status
- Migration: 100% complete
- All services running on Mac Mini
- Vespera: PAUSED
- Kemuni: PAUSED
- 9 MVP Safety issues created (TOD-711 through TOD-719, deduped)
- MVP plan doc written: ~/kaos-config/docs/todero-mvp-plan.md
- TOD-621 implemented: in_review and blocked statuses retired
- Sprint API routes built: POST /api/sprint-close, POST /api/sprint-start
- LaunchAgent com.nabit.sprint-cycle installed (runs 6:55am daily)
- Post-commit hook fixed (~/todero path)

## Active Sprint
- Todero sprint-3 (active): 2026-04-09 → 2026-04-10
- 34 issues assigned to sprint
- Focus: TOD-526 (Global Shell & Navigation)

## Today's Commits (2026-04-09)
- 840c748: feat(sprint-api): add sprint-close and sprint-start API routes
- abf71ea: feat(TOD-621): retire in_review and blocked statuses
- 6d03f3e: fix(sprint-api): add project field to sprint-start, fix post-commit hook

## TOD-526 Breakdown
4 features, 23 total tasks:
- TOD-535 (Top Bar): 14 tasks (existing)
- TOD-538 (Sidebar): 3 tasks (TOD-720, 721, 722)
- TOD-536 (Hub Switcher): 3 tasks (TOD-723, 724, 725)
- TOD-537 (Search): 3 tasks (TOD-726, 727, 728)

## Next Move
1. Run DB migration for TOD-621 (retire stale statuses in Supabase)
2. Move TOD-526 child features from backlog to defined/open
3. Begin Builder work on TOD-526 tasks (start with TOD-720: sidebar)
4. Process stale product_review/code_review issues

## Promised Follow-ups
| What | Due | Status |
|---|---|---|
| First Todero sprint | Now | DONE (sprint-3 active) |
| Sprint automation | Now | DONE (LaunchAgent installed) |
| Vespera PRs #20-22 | PAUSED | Paused |
