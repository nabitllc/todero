# AGENTS.md — Workspace Reference

Full system config lives in `todero/config/AGENTS.md`. This file is the workspace-local copy.

## Key Rules

- **Issue lifecycle:** Do the work → PATCH issue to next status → let API handle routing
- **Issue creation:** MC API only: `POST http://localhost:3000/api/issues`
- **Status updates:** MC API only: `PATCH http://localhost:3000/api/issues`
- **Git:** Commit locally with `[skip ci]` — never push, never `gh pr create`
- **Backlog-first:** Only move to open when ≤10 issues currently open

## Required PATCH fields (moving to code_review)
- `implementation_notes` — what you did
- `commit_sha` — git commit hash
- `regression_test` — how to verify
- `transitioned_by` — your agent id

## MC API Endpoints
```
POST  http://localhost:3000/api/issues  — create
PATCH http://localhost:3000/api/issues  — update/transition
GET   http://localhost:3000/api/issues  — list
```

## Issue Types
- `epic` → `feature` → `task` / `bug` / `ops` / research `task`
- Decomposition: epic→features (SME), features→tasks (PO)
- Assignees: builder, tester, designer, ops, po, scout, kemuni-sme, vespera-sme, auditor
