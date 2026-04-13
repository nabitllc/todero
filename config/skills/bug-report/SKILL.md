# Bug Report Skill

Report bugs to the Mission Control issue board. Use this BEFORE giving up on a task — report the blocker, then continue with other work.

## Endpoint

```
POST http://localhost:3000/api/issues
Content-Type: application/json
```

## Required Fields

| Field | Value |
|---|---|
| `title` | Short description of the bug |
| `project` | Project where bug occurred (e.g. `Mission Control`, `Infrastructure`, `Vespera`) |
| `type` | `bug` |
| `priority` | See severity guide below |
| `assignee` | `builder` |
| `sprint` | Today's date in `YYYY-MM-DD` format |
| `description` | What happened, what was expected, error message/stack trace |
| `acceptance_criteria` | What "fixed" looks like — specific, testable |
| `parent_id` | UUID of the parent feature issue (**required** — bugs must belong to a feature) |

> **Hierarchy rule:** Every bug must have a `parent_id` pointing to a feature issue (not a task, epic, or ops). If unsure which feature it belongs to, query `GET /api/issues` and find the closest feature in the same project, or create a catch-all bug-tracking feature first.

## Severity Guide

| Severity | Priority | Examples |
|---|---|---|
| Build breaks / app won't start | `critical` | TypeScript compile error, missing dependency, server crash on boot |
| API error / data issue | `high` | 500 response, wrong data returned, database query failure |
| UI glitch / wrong behavior | `medium` | Layout broken, button not working, wrong text displayed |
| Cosmetic / minor | `low` | Spacing off, typo, color mismatch |

## Example Payloads

### 1. Build Failure

```json
{
  "title": "MC Build failure — Cannot find module '@/components/Sidebar'",
  "project": "Mission Control",
  "type": "bug",
  "priority": "critical",
  "assignee": "builder",
  "sprint": "2026-03-29",
  "description": "npm run build fails with:\n\nTS2307: Cannot find module '@/components/Sidebar' or its corresponding type declarations.\n\nExpected: build completes with exit code 0.\n\nThis blocks all further development on Mission Control.",
  "acceptance_criteria": "npm run build exits 0 with no TypeScript errors"
}
```

### 2. API Error

```json
{
  "title": "Issues API returns 500 when filtering by sprint",
  "project": "Infrastructure",
  "type": "bug",
  "priority": "high",
  "assignee": "builder",
  "sprint": "2026-03-29",
  "description": "GET /api/issues?sprint=2026-03-29 returns HTTP 500.\n\nError: relation \"sprints\" does not exist\n\nExpected: returns filtered list of issues for the given sprint date.\n\nStack trace:\n  at /api/issues/route.ts:45\n  at processTicksAndRejections (node:internal/process/task_queues:95:5)",
  "acceptance_criteria": "GET /api/issues?sprint=YYYY-MM-DD returns 200 with correct filtered results"
}
```

### 3. Unexpected Behavior

```json
{
  "title": "Issue status not updating after PATCH — stays as 'open'",
  "project": "Mission Control",
  "type": "bug",
  "priority": "medium",
  "assignee": "builder",
  "sprint": "2026-03-29",
  "description": "PATCH /api/issues with {\"id\": \"abc-123\", \"status\": \"in_review\"} returns 200 but the issue status remains 'open' when fetched again.\n\nExpected: status should update to 'in_review'.\n\nReproduction: PATCH any issue, then GET it — status unchanged.",
  "acceptance_criteria": "PATCH /api/issues correctly persists status changes; subsequent GET reflects the new status"
}
```

## Usage

When you encounter a bug or blocker:

1. Determine severity using the guide above
2. Capture the error message and stack trace
3. Find the parent feature UUID (query `GET /api/issues?task_key=MC-XXX` or search by project+type=feature)
4. POST the bug using the payload format (include `parent_id`)
5. Log: `Bug [task_key] created — [title]`
6. Continue with remaining work if possible

### Shell script (preferred for agents)

```bash
# Usage
skills/bug-report/scripts/bug-report.sh \
  --title "Short description of the bug" \
  --project "Mission Control" \
  --priority "high" \
  --parent-id "uuid-of-parent-feature" \
  --description "What happened, expected vs actual, stack trace" \
  --ac "Bug is fixed — specific test that confirms it"

# Flags
#   --title        Required. Short bug description.
#   --project      Required. Project name.
#   --parent-id    Required. UUID of parent feature issue.
#   --priority     Optional. critical|high|medium|low (default: medium)
#   --assignee     Optional. Default: builder
#   --sprint       Optional. Default: today's date (YYYY-MM-DD)
#   --description  Optional. Full description (defaults to title if omitted)
#   --ac           Optional. Acceptance criteria (defaults to generic)
```
