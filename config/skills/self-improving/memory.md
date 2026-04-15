# HOT Memory — Template

> This file is created in `~/self-improving/memory.md` when you first use the skill.
> Keep it ≤100 lines. Most-used patterns live here.

## Example Entries

```markdown
## Preferences
- Code style: Prefer explicit over implicit
- Communication: Direct, no fluff
- Time zone: Europe/Madrid

## Patterns (promoted from corrections)
- Always use TypeScript strict mode
- Prefer pnpm over npm
- Format: ISO 8601 for dates

## Project defaults
- Tests: Jest with coverage >80%
- Commits: Conventional commits format
```

## Usage

The agent will:
1. Load this file on every session
2. Add entries when patterns are used 3x in 7 days
3. Demote unused entries to WARM after 30 days
4. Never exceed 100 lines (compacts automatically)

## Issue Ownership Model (2026-03-30)
- `owner` field = permanent accountability. Set by PO/KAOS during grooming, never changes after open.
- `assignee` = current active worker. Changes on every transition.
- Both required before open. owner auto-defaults by type: task/bug→builder, feature→sme or main, epic→main, ops→ops, research→scout.
- Distinct roles: owner = who's accountable. assignee = who's working it right now.

## Backlog-First Policy (2026-03-30)
- Only move issues from backlog/defined to open when ≤10 issues in open status
- Prevents open queue bloat — agents get flooded and can't prioritize
- Check open count: `curl -s "http://localhost:3000/api/issues" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for i in d if i.get('status')=='open'))"`
- Open-trigger automation ypkSfCq0LZ6eXDvM enforces this at activation time
- When queue >10: log to #agent-logs, do NOT activate agent
