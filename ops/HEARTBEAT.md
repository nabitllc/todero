# HEARTBEAT.md - Ingo

## Purpose
Infrastructure health check. Run every 6 hours. Stay cheap, stay quiet.

## Check order (stop at first critical alert)

1. **MC server** — is it responding? (`curl -sf http://localhost:3000 > /dev/null`)
   - Alert if: not responding (connection refused or timeout)
   - Severity: critical

2. **OpenClaw gateway** — is it running? (`openclaw gateway status`)
   - Alert if: not running or unreachable
   - Severity: critical

3. **n8n health** — is n8n LaunchAgent loaded and last workflow run successful?
   - Alert if: service down or last "Daily Billing Review" run failed
   - Severity: high

4. **Builder loop** — is the process running? (`pgrep -f builder-loop`)
   - Alert if: process not found
   - Severity: medium

5. **Disk usage** — is usage above threshold? (`df -h / | awk 'NR==2{print $5}'`)
   - Alert if: usage >90%
   - Severity: high

6. **Agent errors** — any agent_runs with status=error in last 1h?
   - Query: `GET /rest/v1/agent_runs?status=eq.error&created_at=gte.{1h_ago}&select=id,agent,error`
   - Alert if: any rows returned
   - Severity: medium

7. **Cron jobs** — any cron missed >2 consecutive scheduled runs?
   - Alert if: missed runs detected
   - Severity: medium

8. **Supabase projects** — are Kemuni Agent Brain and Vespera DB active (not paused)?
   - Alert if: either project shows as paused
   - Severity: high

9. **Nothing critical** → HEARTBEAT_OK

## Anomaly → Bug Issue Creation

When any check above fails, create a bug issue via MC API.

### Procedure

1. **Deduplication first**: Before creating a bug, check if one already exists:
   ```
   GET http://localhost:3000/api/issues?type=eq.bug&status=eq.open&title=like.*Ingo:*{anomaly_keyword}*
   ```
   If a matching open bug exists, skip creation and log: `Duplicate bug exists — skipping`

2. **Create bug issue**:
   ```
   POST http://localhost:3000/api/issues
   Content-Type: application/json

   {
     "title": "Ingo: {anomaly description} detected at {timestamp}",
     "type": "bug",
     "priority": "{severity from check}",
     "assignee": "ops",
     "project": "Infrastructure",
     "sprint": "{today YYYY-MM-DD}",
     "description": "Detected: {what was found}\nCheck: {which check failed}\nSuggested fix: {remediation step}",
     "acceptance_criteria": "{what fixed looks like}"
   }
   ```

### Anomaly → Bug Mapping

| Anomaly | Priority | Title Pattern | Suggested Fix | Acceptance Criteria |
|---|---|---|---|---|
| MC server not responding | critical | `Ingo: MC server down at {ts}` | Restart: `cd /Users/kemuniagent/mission-control && npm run dev` | `curl localhost:3000` returns 200 |
| Builder loop not running | medium | `Ingo: Builder loop stopped at {ts}` | Restart: `bash /Users/kemuniagent/scripts/builder-loop.sh &` | `pgrep -f builder-loop` finds process |
| Disk usage >90% | high | `Ingo: Disk usage {pct}% at {ts}` | Clear logs: `/tmp/*.log`, `~/.n8n/n8nEventLog*.log` | `df -h /` shows <85% |
| n8n not running | high | `Ingo: n8n service down at {ts}` | Restart: `launchctl load ~/Library/LaunchAgents/com.n8n.plist` | n8n responds on port 5678 |
| Agent run errors | medium | `Ingo: {count} agent errors in last hour at {ts}` | Review agent_runs table, check logs | No error-status agent_runs in 1h |
| OpenClaw gateway down | critical | `Ingo: OpenClaw gateway unreachable at {ts}` | Restart: `openclaw gateway start` | `openclaw gateway status` shows running |

## Billing check (daily, separate cron — not every heartbeat)
- Pull Anthropic + OpenRouter usage for past 24h
- Post 1-line summary to Telegram Kemuni Daily channel
- Alert if spend > $2/day

## Alert format
One paragraph. What broke, how to fix it, what happens if ignored.
