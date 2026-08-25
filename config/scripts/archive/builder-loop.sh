#!/bin/bash
# Builder Loop — runs every 10 min, spawns Builder if idle + open issues exist
# Logs to /tmp/builder-loop.log
# Claude Code version — no OpenClaw dependency

LOG="/tmp/builder-loop.log"

# Single instance guard
LOOP_LOCK="/tmp/builder-loop-instance.lock"
if [ -f "$LOOP_LOCK" ] && kill -0 "$(cat $LOOP_LOCK)" 2>/dev/null; then
  echo "Loop already running (PID $(cat $LOOP_LOCK)) — exiting" >> "$LOG"
  exit 0
fi
echo $$ > "$LOOP_LOCK"
trap "rm -f $LOOP_LOCK" EXIT

SK="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is not set - see .env.local.template}"
SUPA="${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is not set - see .env.local.template}"
MC_DIR="/Users/kemuniagent/todero"
WORKSPACE="/Users/kemuniagent/todero/config"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

while true; do
  log "--- Builder loop tick ---"

  # Check if Builder (claude) is already running
  if pgrep -f "claude.*bypassPermissions" > /dev/null; then
    log "Builder session active — skipping tick"
    sleep 600
    continue
  fi

  # Get active sprint date
  ACTIVE_SPRINT=$(curl -s "${SUPA}/rest/v1/sprints?status=eq.active&select=start_date&limit=1" \
    -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" | \
    python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['start_date'] if rows else '')" 2>/dev/null)

  if [ -z "$ACTIVE_SPRINT" ]; then
    log "No active sprint found — skipping"
    sleep 600
    continue
  fi

  log "Active sprint: $ACTIVE_SPRINT"

  # Check for paused projects
  PAUSED_PROJECTS=$(curl -s "${SUPA}/rest/v1/issues?title=like.*PROJECT+PAUSED*&status=neq.done&select=project" \
    -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" | \
    python3 -c "import json,sys; rows=json.load(sys.stdin); print(','.join(r['project'] for r in rows))" 2>/dev/null)
  log "Paused projects: ${PAUSED_PROJECTS:-none}"

  # Build project exclusion filter
  if [ -n "$PAUSED_PROJECTS" ]; then
    PROJ_FILTER="project=not.in.($(echo $PAUSED_PROJECTS | tr ',' ','))"
  else
    PROJ_FILTER="project=not.is.null"
  fi

  # Fetch open issues assigned to builder
  ALL_ISSUES=$(curl -s "${SUPA}/rest/v1/issues?assignee=eq.builder&status=eq.open&sprint=eq.${ACTIVE_SPRINT}&acceptance_criteria=not.is.null&${PROJ_FILTER}&order=priority.asc&limit=10&select=task_key,title,priority,project,id" \
    -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}")
  ALL_COUNT=$(echo "$ALL_ISSUES" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)

  log "Open builder issues: $ALL_COUNT"

  if [ "$ALL_COUNT" -gt 0 ]; then
    ISSUE_KEYS=$(echo "$ALL_ISSUES" | python3 -c "
import json,sys
items=json.load(sys.stdin)
print(', '.join([i.get('task_key','?')+': '+i['title'][:40] for i in items[:5]]))
" 2>/dev/null)
    log "Issues: $ISSUE_KEYS"

    # Load workspace context for Builder
    CONTEXT=$(cat "${WORKSPACE}/SOUL.md" "${WORKSPACE}/AGENTS.md" "${WORKSPACE}/self-improving/memory.md" 2>/dev/null)

    cd "$MC_DIR" && claude --permission-mode bypassPermissions --print "
<workspace-context>
${CONTEXT}
</workspace-context>

You are Builder. Your job is to implement open issues assigned to you.

Workspace: $MC_DIR
Supabase: $SUPA
Service key: $SK
MC API: http://localhost:3000/api/issues

Step 1: Fetch your open issues:
GET ${SUPA}/rest/v1/issues?assignee=eq.builder&status=eq.open&acceptance_criteria=not.is.null&sprint=not.is.null&order=priority.asc&limit=10&select=*
Headers: apikey: \$SK, Authorization: Bearer \$SK

Step 2: For each issue in priority order:
- Read title + description + acceptance_criteria carefully
- CHECK FOR REJECTION: If reviewer_notes is set, read it — it describes what to fix
- Set status=in_progress via MC API: PATCH http://localhost:3000/api/issues {\"id\":\"<uuid>\",\"status\":\"in_progress\"}
- Implement the change
- Run npm run build (fix all TypeScript errors before committing)
- git add -A && git commit -m 'feat(TASK_KEY): description [skip ci]'
- PATCH issue to in_review via MC API:
  {
    \"id\": \"<uuid>\",
    \"status\": \"in_review\",
    \"implementation_notes\": \"<what you built and tested>\",
    \"commit_sha\": \"<git rev-parse HEAD>\",
    \"regression_test\": \"<command or manual steps to verify>\"
  }
- NEVER git push (KAOS pushes at 7am/7pm only)
- NEVER create new tester/reviewer issues — PATCH the original issue only
- NEVER mark status=done — the reviewer does that

⚠️ PARTIAL WORK RULE: If you cannot complete a task, either:
(a) Commit with [WIP] prefix: git commit -m '[WIP] partial: description'
(b) OR clean up: git checkout -- . && git clean -fd
NEVER leave uncommitted partial files — they break the TypeScript compiler.

Step 3: After all issues done, write a brief summary to /tmp/builder-session-done.txt
" >> "$LOG" 2>&1 &

    BUILDER_PID=$!
    log "Builder spawned (PID $BUILDER_PID)"

    # Wait for Builder to finish, then verify build
    wait $BUILDER_PID
    log "Builder finished — verifying build..."

    BUILD_OUTPUT=$(cd "$MC_DIR" && npm run build 2>&1)
    BUILD_EXIT=$?

    if [ $BUILD_EXIT -ne 0 ]; then
      log "BUILD FAILED (exit $BUILD_EXIT) — creating bug issue"

      ERRFILE="/tmp/builder-build-error.txt"
      echo "$BUILD_OUTPUT" | tail -50 | head -c 2000 > "$ERRFILE"
      TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
      TODAY=$(date '+%Y-%m-%d')

      python3 -c "
import json, urllib.request, sys
with open('$ERRFILE') as f:
    error_text = f.read()
payload = json.dumps({
    'title': 'MC Build failure — $TIMESTAMP',
    'type': 'bug',
    'priority': 'critical',
    'assignee': 'builder',
    'project': 'Mission Control',
    'sprint': '$TODAY',
    'description': error_text,
    'acceptance_criteria': 'npm run build exits 0 with no TypeScript errors'
}).encode()
req = urllib.request.Request('http://localhost:3000/api/issues', data=payload,
    headers={'Content-Type': 'application/json'}, method='POST')
resp = urllib.request.urlopen(req)
print(resp.read().decode())
" 2>/dev/null

      rm -f "$ERRFILE"
      cd "$MC_DIR" && git clean -fd >> "$LOG" 2>&1
      log "git clean -fd complete"
    else
      log "Build verified OK"
    fi
  else
    log "No open issues for builder — idle"
  fi

  sleep 600
done
