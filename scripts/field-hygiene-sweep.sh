#!/usr/bin/env bash
# field-hygiene-sweep.sh
# Goal A: Scan all non-backlog, non-terminal issues for missing required fields.
# Reports violations to stdout and optionally posts to Discord.
# Run manually or schedule via cron.
#
# Required fields per live issue:
#   acceptance_criteria, severity, owner, reviewer, assignee
# Late-stage extra fields (code_review+):
#   For code_review issues: implementation_notes, regression_test
#   For product_review issues: implementation_notes
#   For approved issues: resolution_type, reviewer_notes
#
# Usage:
#   ./field-hygiene-sweep.sh            # report only
#   ./field-hygiene-sweep.sh --notify   # also post to Discord #agent-logs

set -euo pipefail

NOTIFY="${1:-}"
DISCORD_CHANNEL="1363614854124605479"  # #agent-logs
# TOD-2424: this was a second live copy of the bot token, in a shell script.
# Read it from the environment; the script now says so instead of carrying it.
DISCORD_TOKEN="${DISCORD_BOT_TOKEN:-}"
if [ -z "$DISCORD_TOKEN" ]; then
  echo "[field-hygiene] DISCORD_BOT_TOKEN is not set — not notifying." >&2
fi

python3 << 'PYEOF'
import subprocess, json, os, sys

def fetch_issues():
    r = subprocess.run(['curl', '-sf', 'http://localhost:3000/api/issues'], capture_output=True, timeout=30)
    if r.returncode != 0:
        raise RuntimeError(f'curl failed: {r.stderr.decode()}')
    return json.loads(r.stdout)

BASE = "http://localhost:3000/api/issues"
TERMINAL = {"backlog", "closed", "cancelled", "released", "done"}

# Required for all live issues
REQUIRED_BASE = ["acceptance_criteria", "severity", "owner", "reviewer", "assignee"]

# Extra required by late stage
LATE_STAGE_FIELDS = {
    "code_review": ["implementation_notes", "regression_test"],
    "product_review": ["implementation_notes"],
    "approved": ["resolution_type", "reviewer_notes"],
    "completed": ["resolution_type"],
}

try:
    issues = fetch_issues()
except Exception as e:
    print(f"ERROR fetching issues: {e}", file=sys.stderr)
    sys.exit(1)

violations = []
for issue in issues:
    status = issue.get("status", "")
    if status in TERMINAL:
        continue

    key = issue.get("task_key", "?")
    issue_type = issue.get("type", "?")
    missing = []

    # Check base required fields
    for f in REQUIRED_BASE:
        if not issue.get(f):
            missing.append(f)

    # Check late-stage extras
    extra = LATE_STAGE_FIELDS.get(status, [])
    for f in extra:
        if not issue.get(f):
            missing.append(f"{f} (required at {status})")

    if missing:
        violations.append({
            "key": key,
            "status": status,
            "type": issue_type,
            "title": issue.get("title", "")[:60],
            "missing": missing,
        })

if not violations:
    print("✅ field-hygiene-sweep: all live issues clean")
    sys.exit(0)

print(f"⚠️  field-hygiene-sweep: {len(violations)} issues with missing required fields\n")
for v in violations:
    print(f"  {v['key']} [{v['status']}] {v['type']}: {v['title']}")
    for m in v['missing']:
        print(f"    ✗ {m}")
    print()

# Write summary to /tmp for Discord post
summary_lines = [f"⚠️ **Field Hygiene Sweep** — {len(violations)} live issues with missing fields\n"]
for v in violations:
    summary_lines.append(f"• `{v['key']}` [{v['status']}]: missing {', '.join(v['missing'])}")
with open("/tmp/hygiene-sweep-result.txt", "w") as f:
    f.write("\n".join(summary_lines))

sys.exit(1)  # non-zero so cron/CI can detect
PYEOF

EXIT_CODE=$?

# Discord notification if requested and there are violations
if [[ "$NOTIFY" == "--notify" && -f /tmp/hygiene-sweep-result.txt ]]; then
    CONTENT=$(cat /tmp/hygiene-sweep-result.txt | head -c 1900)
    curl -s -X POST "https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages" \
        -H "Authorization: Bot ${DISCORD_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"content\": $(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$CONTENT")}" \
        > /dev/null
fi

exit $EXIT_CODE
