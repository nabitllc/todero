# n8n queue activation split — 2026-04-04

## Goal
Split queue activation cadence by workflow stage and use the current issue assignee as the activation source of truth.

## Live workflows targeted
- `ypkSfCq0LZ6eXDvM` — `▶️ Auto-Activate Agent on open status`
- `tgwln7Ra04hKhbeC` — currently `🔍 Auto-Trigger Assigned Agent on in_review`

## Desired live behavior

### 1) Open queue sweep
- Workflow: `ypkSfCq0LZ6eXDvM`
- Schedule: every **1 hour**
- Query statuses: `open`
- Activation target: `issue.assignee`
- Dedupe key: `issue.id + assignee + status`
- Dedupe TTL: ~55 minutes

### 2) Active/signoff sweep
- Workflow: `tgwln7Ra04hKhbeC`
- Rename to: `🔄 Auto-Activate Assigned Agent on active/signoff queue — every 5 min`
- Schedule: every **5 minutes**
- Query statuses: `in_progress`, `code_review`, `product_review`, `released`, `completed`
- Activation target: `issue.assignee`
- Special case: for `code_review`, also activate `designer` in parallel as a fallback nudge even if assignee is the primary reviewer
- Dedupe key: `issue.id + assignee + status`
- Dedupe TTL: ~4 minutes

## Notes
- `done` and `in_review` remain retired for this execution-family automation.
- Repo/API still does immediate activation on PATCH transitions; these n8n workflows are the scheduled sweep/fallback layer.
- Discord transition notifications should keep hooking in at the API transition layer (`app/api/issues/route.ts` / workflow post-functions), not in these sweep workflows.
