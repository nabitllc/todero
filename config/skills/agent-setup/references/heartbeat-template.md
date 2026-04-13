# HEARTBEAT.md Template & Examples

## Template

```markdown
# HEARTBEAT.md — <Name> <Emoji>

Heartbeat: every <interval>

## Checks

1. **<Primary check name>** — <what to query/check>
   - <Action if found>
   - <Action if nothing found>

2. **<Secondary check>** — <what to look for>
   - <Action>

3. Nothing found → HEARTBEAT_OK

## Alert Format
One short paragraph: what's the issue, recommended action, consequence if ignored.
```

## Interval Guidelines
- Critical monitoring (ops, deploy): every `30m` or `1h`
- Active pipeline review (tester, designer): every `4h`  
- Periodic intelligence (scout, growth, po): every `4h` to `12h`
- Slow burn awareness (kemuni-sme, vespera-sme): every `4h`

## Examples

### Ops ⚙️
```markdown
# HEARTBEAT.md — Ops ⚙️

Heartbeat: every 1h

## Checks

1. **System health** — check disk, memory, CPU
   - df -h / free -h / top snapshot
   - Alert if disk >85% or memory >90%

2. **Service status** — verify critical services running
   - mc-api (port 3000), supabase, n8n
   - Alert if any service unreachable

3. **Recent errors** — scan /var/log for ERROR/FATAL in last 1h
   - If >10 errors: summarize and alert

4. Nothing found → HEARTBEAT_OK
```

### Designer 🎨
```markdown
# HEARTBEAT.md — Designer 🎨

Heartbeat: every 4h

## Checks

1. **Review queue** — GET Supabase issues WHERE test_status=passed AND project IN (Mission Control, Vespera) AND status=in_review ORDER BY updated_at DESC LIMIT 5
   - For each: load design-system.md, run 10-point checklist, approve or create fix task
   - Post summary to #ux-reviews

2. **Spot audit** — Pick 1 recently shipped issue (status=done in last 24h, UI-related)
   - Check against design system
   - If finding: create child task with specific fix

3. **Component spec requests** — GET issues WHERE type=feature AND status=open AND assignee=designer
   - Write component spec as comment
   - Update assignee back to builder

4. Nothing found → HEARTBEAT_OK
```

### Growth 📊
```markdown
# HEARTBEAT.md — Growth 📊

Heartbeat: every 4h

## Checks

1. **Activation funnel** — query Supabase for signups, onboarding_complete, first_action in last 24h
   - If drop >20% from yesterday: alert with segment breakdown

2. **Active users** — DAU/WAU/MAU trend
   - If DAU drops >15%: alert with cohort analysis

3. **Feature adoption** — check usage of latest shipped features
   - If <5% adoption after 48h: flag for review

4. Nothing found → HEARTBEAT_OK
```

## Supabase Query Pattern for Heartbeat
```python
import json, subprocess

query = """
SELECT id, title, status, test_status, updated_at
FROM issues
WHERE test_status = 'passed'
  AND project IN ('Mission Control', 'Vespera')
  AND status = 'in_review'
ORDER BY updated_at DESC
LIMIT 5
"""

result = subprocess.run([
    'curl', '-s',
    'https://twthgapiouiqhavrcnry.supabase.co/rest/v1/rpc/exec_sql',
    '-H', 'apikey: <service_key>',
    '-H', 'Authorization: Bearer <service_key>',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps({"query": query})
], capture_output=True, text=True)

issues = json.loads(result.stdout)
```

## Key Rules
- Always end with `HEARTBEAT_OK` if nothing actionable found — don't post to Discord
- Silent hours: 23:00–08:00 Eastern — skip non-critical alerts
- Don't duplicate alerts — check if alert was already posted in last N hours
- Keep heartbeat under 60s total runtime — use LIMIT on queries
