#!/bin/bash
# Agent Heartbeat — runs every 30 minutes via LaunchAgent
# Dynamically fetches configured agents from the API, then activates each.
# Each agent works 1 issue at a time, self-chains to the next when done.

set -euo pipefail
API="http://localhost:3000/api/run-agent"
DISCORD_CHANNEL="1485333335868834063"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
STATE_FILE="$HOME/todero/config/scripts/state-heartbeat.json"
RUN_START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() { echo "${LOG_PREFIX} $1"; }

write_state_start() {
  python3 -c "import json; open('$STATE_FILE','w').write(json.dumps({'last_heartbeat_started_at':'$RUN_START_ISO','last_heartbeat_result':'IN_PROGRESS','last_heartbeat_source':'agent-heartbeat.sh'}, indent=2))"
}

write_state_done() {
  local result="$1"
  local activated="$2"
  local skipped="$3"
  local idle="$4"
  local finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 -c "import json; open('$STATE_FILE','w').write(json.dumps({'last_heartbeat_started_at':'$RUN_START_ISO','last_heartbeat_finished_at':'$finished','last_heartbeat_result':'$result','last_heartbeat_source':'agent-heartbeat.sh','last_activated_count':$activated,'last_skipped_count':$skipped,'last_idle_lanes':$idle}, indent=2))"
}

write_state_start

discord_alert() {
  local msg="$1"
  local token="${DISCORD_BOT_TOKEN:-}"
  if [ -z "$token" ]; then
    log "[discord] no DISCORD_BOT_TOKEN; skipping alert"
    return
  fi
  curl -s -X POST "https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages" \
    -H "Authorization: Bot ${token}" \
    -H "Content-Type: application/json" \
    -H "User-Agent: DiscordBot (https://kaos.nabit.work, 1.0)" \
    -d "{\"content\": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$msg")}" \
    >/dev/null 2>&1 || true
}

log "Agent heartbeat starting..."
ACTIVATED_COUNT=0
SKIPPED_COUNT=0

# TOD-769: Enforce >=1 active Epic rule
check_active_epics() {
  local issues_json
  issues_json=$(curl -s "http://localhost:3000/api/issues" 2>/dev/null || echo '[]')

  local active_count
  active_count=$(echo "$issues_json" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    active = [i for i in data if i.get('type') == 'epic' and i.get('status') == 'active']
    print(len(active))
except: print(0)
" 2>/dev/null || echo "0")

  log "Active epics: ${active_count}"

  if [ "$active_count" -eq 0 ]; then
    log "WARNING: No active epics. Activating highest-priority backlog epic..."

    # Find highest-priority backlog epic
    local top_epic
    top_epic=$(echo "$issues_json" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    backlog = [i for i in data if i.get('type') == 'epic' and i.get('status') == 'backlog']
    priority_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
    backlog.sort(key=lambda e: priority_order.get(e.get('priority', 'low'), 99))
    if backlog:
        e = backlog[0]
        print(f\"{e['id']}|{e.get('priority','unknown')}|{e.get('title','')[:60]}\")
except: pass
" 2>/dev/null || echo "")

    if [ -z "$top_epic" ]; then
      log "  No backlog epics found — nothing to activate"
      return
    fi

    local epic_id="${top_epic%%|*}"
    local epic_rest="${top_epic#*|}"
    local epic_priority="${epic_rest%%|*}"
    local epic_title="${epic_rest#*|}"

    log "  Activating: [${epic_priority}] ${epic_title}"

    local patch_result
    patch_result=$(curl -s -X PATCH "http://localhost:3000/api/issues" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"${epic_id}\",\"status\":\"active\",\"transitioned_by\":\"heartbeat\"}" \
      2>/dev/null || echo '{"error":"API unreachable"}')

    local patch_status
    patch_status=$(echo "$patch_result" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    # Check for error or success
    if 'error' in d:
        print('ERROR: ' + str(d['error']))
    else:
        print('OK')
except: print('PARSE_ERROR')
" 2>/dev/null || echo "PARSE_ERROR")

    if [ "$patch_status" = "OK" ]; then
      log "  Epic activated: ${epic_title}"
      discord_alert ":white_check_mark: **Epic Auto-Activated** — No active epics found. Activated: **${epic_title}** (${epic_priority} priority)"
    else
      log "  Epic activation failed: ${patch_status}"
      discord_alert ":x: **Epic Auto-Activation Failed** — Tried to activate: ${epic_title} — Error: ${patch_status}"
    fi
  fi
}

check_active_epics

# Fetch lane data once — used for idle detection and agent list
LANES_JSON=$(curl -s "${API}" -H "Content-Type: application/json" 2>/dev/null || echo '{}')

# Detect idle lanes: wip=0 but eligible>0 (work exists but no agent active)
IDLE_LANES=$(echo "$LANES_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    lanes = data.get('lanes', [])
    idle = [l for l in lanes if l.get('wip', 0) == 0 and l.get('eligible', 0) > 0]
    for l in idle:
        print(f\"{l['agent']}:{l['eligible']}\")
except: pass
" 2>/dev/null)

if [ -n "$IDLE_LANES" ]; then
  log "IDLE LANES DETECTED — activating and alerting..."
  alert_lines=""
  for entry in $IDLE_LANES; do
    agent="${entry%%:*}"
    eligible="${entry##*:}"
    log "  IDLE: ${agent} has 0 in_progress but ${eligible} eligible issue(s)"
    alert_lines="${alert_lines}\n• **${agent}**: 0 active, ${eligible} eligible issue(s) waiting"
    # Auto-activate the idle lane
    activate_result=$(curl -s -X POST "${API}?agent=${agent}" \
      -H "Content-Type: application/json" 2>/dev/null || echo '{"error":"API unreachable"}')
    activate_ok=$(echo "$activate_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('ok',''))" 2>/dev/null || echo "")
    activate_task=$(echo "$activate_result" | python3 -c "import json,sys; d=json.load(sys.stdin); t=d.get('task',{}); print(f\"{t.get('taskKey','')}: {t.get('title','')[:40]}\")" 2>/dev/null || echo "")
    if [ "$activate_ok" = "True" ]; then
      log "  ${agent}: AUTO-ACTIVATED — ${activate_task}"
      alert_lines="${alert_lines} → activated: ${activate_task}"
    else
      activate_msg=$(echo "$activate_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message',d.get('error','')))" 2>/dev/null || echo "unknown")
      log "  ${agent}: activation failed — ${activate_msg}"
      alert_lines="${alert_lines} → activation failed: ${activate_msg}"
    fi
  done
  discord_alert "$(printf ':warning: **Idle Lane Alert** — lanes with work but no active agent:\n%b' "$alert_lines")"
fi

# Extract agent list for remaining activation pass
AGENTS=$(echo "$LANES_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    lanes = data.get('lanes', [])
    for l in lanes:
        print(l.get('agent', ''))
except: pass
" 2>/dev/null)

if [ -z "$AGENTS" ]; then
  log "WARNING: Could not fetch agent list from API. Using fallback."
  AGENTS="po builder ops scout tester designer auditor deployer"
fi

# Build set of already-activated idle agents to skip re-activation
IDLE_AGENTS=""
for entry in $IDLE_LANES; do
  IDLE_AGENTS="${IDLE_AGENTS} ${entry%%:*}"
done

for agent in $AGENTS; do
  [ -z "$agent" ] && continue
  # Skip agents already activated via idle-lane logic above
  if echo "$IDLE_AGENTS" | grep -qw "$agent"; then
    log "  ${agent}: already activated (idle lane)"
    continue
  fi

  result=$(curl -s -X POST "${API}?agent=${agent}" \
    -H "Content-Type: application/json" 2>/dev/null || echo '{"error":"API unreachable"}')

  ok=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('ok',''))" 2>/dev/null || echo "")
  msg=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message',d.get('error','')))" 2>/dev/null || echo "parse error")
  task=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); t=d.get('task',{}); print(f\"{t.get('taskKey','')}: {t.get('title','')[:40]}\")" 2>/dev/null || echo "")

  if [ "$ok" = "True" ]; then
    log "  ${agent}: ACTIVATED — ${task}"
    ACTIVATED_COUNT=$((ACTIVATED_COUNT + 1))
  else
    log "  ${agent}: skip — ${msg}"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
  fi
done

# Count idle lanes for state file
IDLE_COUNT=0
if [ -n "${IDLE_LANES:-}" ]; then
  IDLE_COUNT=$(echo "$IDLE_LANES" | wc -l | tr -d ' ')
fi

write_state_done "HEARTBEAT_OK" "$ACTIVATED_COUNT" "$SKIPPED_COUNT" "$IDLE_COUNT"
log "Agent heartbeat complete. activated=$ACTIVATED_COUNT skipped=$SKIPPED_COUNT idle=$IDLE_COUNT"
