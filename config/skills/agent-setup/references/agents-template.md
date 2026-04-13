# AGENTS.md Template & Reference

## Template

```markdown
# AGENTS.md — <Name> <Emoji>

## Identity
- Agent: <id>
- Emoji: <emoji>
- Model: <model>
- Workspace: workspace-<id>/

## APIs
- MC API: http://localhost:3000/api/issues (POST to create, PATCH to update)
- Supabase: https://twthgapiouiqhavrcnry.supabase.co
- Service key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q
- Discord bot token: MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GoiBGW.VS2nGK2X1LMjMjkOBL9NqrOVeUdZfbGo9HdAyo

## Discord Channels
- #agent-logs: 1485333334077735084
- #ux-reviews: 1487936825484902560
- #builder: 1487584945781084346
- #tester: 1487584949132460322
- #ops: 1487584925728112902

## Rules
- <Agent-specific rule 1>
- <Agent-specific rule 2>
- NEVER run openclaw gateway restart
```

## MC API Usage

### Create an issue
```bash
curl -s -X POST http://localhost:3000/api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "title": "...",
    "project": "Mission Control",
    "type": "task",
    "priority": "high",
    "assignee": "builder",
    "sprint": "2026-03-29",
    "description": "...",
    "acceptance_criteria": "..."
  }'
```

### Update an issue
```bash
curl -s -X PATCH http://localhost:3000/api/issues/<task_key> \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "test_status": "passed"}'
```

### Query Supabase directly (when MC API filtering isn't enough)
```bash
curl -s "https://twthgapiouiqhavrcnry.supabase.co/rest/v1/issues?select=*&status=eq.in_review&test_status=eq.passed" \
  -H "apikey: <service_key>" \
  -H "Authorization: Bearer <service_key>"
```

## Discord Notification
```bash
curl -s -X POST "https://discord.com/api/v10/channels/<channel_id>/messages" \
  -H "Authorization: Bot MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GoiBGW.VS2nGK2X1LMjMjkOBL9NqrOVeUdZfbGo9HdAyo" \
  -H "Content-Type: application/json" \
  -H "User-Agent: DiscordBot (https://openclaw.ai, 1.0)" \
  -d '{"content": "message here"}'
```

## Agent-Specific Rules Examples

### Builder
- `npm run build` must pass before every commit
- Commit format: `feat(<task_key>): description`
- NEVER git push — KAOS owns all pushes
- After S0/S1: PATCH severity, create Tester issue

### Tester
- Only act on S0/S1 tasks — skip S2/S3
- Set test_status=passed or test_status=failed — never leave open
- Create child bug issues for failures, don't just comment

### Designer
- Load design-system.md before every review
- Approval: PATCH test_status=ux_approved
- Rejection: create child issue type=bug, priority=high, assignee=builder
- NEVER mark issues done — only approve or reject
