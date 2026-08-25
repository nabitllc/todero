#!/bin/bash
# Builder Loop — runs every 10 min, spawns Builder if idle + open issues exist
# Logs to /tmp/builder-loop.log

LOG="/tmp/builder-loop.log"
LOCK="/tmp/builder-loop.lock"

# Single instance guard — only block if another loop is running (not Builder)
LOOP_LOCK="/tmp/builder-loop-instance.lock"
if [ -f "$LOOP_LOCK" ] && kill -0 "$(cat $LOOP_LOCK)" 2>/dev/null; then
  echo "Loop already running (PID $(cat $LOOP_LOCK)) — exiting" >> "$LOG"
  exit 0
fi
echo $$ > "$LOOP_LOCK"
trap "rm -f $LOOP_LOCK" EXIT
SK="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is not set - see .env.local.template}"
SUPA="${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is not set - see .env.local.template}"
MC_DIR="/Users/kemuniagent/mission-control"
VES_DIR="/var/folders/r0/hww7pxv12txb9sfmlmmw76xw0000gn/T/tmp.8qWeSvST6Z"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

while true; do
  log "--- Builder loop tick ---"

  # Check if Builder is already running (claude subprocess, not this loop)
  if pgrep -f "claude.*bypassPermissions" > /dev/null; then
    log "Builder session active — skipping tick"
    sleep 600
    continue
  fi

  # Get active sprint date
  ACTIVE_SPRINT=$(curl -s "${SUPA}/rest/v1/sprints?status=eq.active&select=start_date&limit=1" \
    -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['start_date'] if rows else '')" 2>/dev/null)

  if [ -z "$ACTIVE_SPRINT" ]; then
    log "No active sprint found — skipping"
    sleep 600
    continue
  fi

  log "Active sprint: $ACTIVE_SPRINT"

  # Check for paused projects — skip any project with a PAUSED flag issue
  PAUSED_PROJECTS=$(curl -s "${SUPA}/rest/v1/issues?title=like.*PROJECT+PAUSED*&status=not.in.(completed,closed)&select=project" \
    -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(','.join(r['project'] for r in rows))" 2>/dev/null)
  log "Paused projects: ${PAUSED_PROJECTS:-none}"

  # Build project exclusion filter
  if [ -n "$PAUSED_PROJECTS" ]; then
    # Convert comma list to NOT IN filter
    PROJ_FILTER="project=not.in.($(echo $PAUSED_PROJECTS | tr ',' ','))"
  else
    PROJ_FILTER="project=not.is.null"
  fi

  # Check for ALL open issues assigned to builder in active sprint (excluding paused projects)
  ALL_ISSUES=$(curl -s "${SUPA}/rest/v1/issues?assignee=eq.builder&status=eq.open&sprint=eq.${ACTIVE_SPRINT}&acceptance_criteria=not.is.null&${PROJ_FILTER}&order=priority.asc&limit=10&select=task_key,title,priority,project,id" \
    -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}")
  ALL_COUNT=$(echo "$ALL_ISSUES" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)

  log "Open builder issues (all projects): $ALL_COUNT"

  if [ "$ALL_COUNT" -gt 0 ]; then
    ISSUE_KEYS=$(echo "$ALL_ISSUES" | python3 -c "import json,sys; items=json.load(sys.stdin); print(', '.join([i.get('task_key','?')+': '+i['title'][:40] for i in items[:5]]))" 2>/dev/null)
    log "Issues: $ISSUE_KEYS"

    cd "$MC_DIR" && claude --permission-mode bypassPermissions --print "
You are Builder. Work across these repos:
- Mission Control + Infrastructure issues: $MC_DIR
- Vespera issues: $VES_DIR

⚠️ NEVER git push. Commit locally only. KAOS pushes at 7am/7pm sprint windows.

Supabase: $SUPA
Service key: $SK
MC API: http://localhost:3000/api/issues

Step 1: Fetch your open issues:
GET ${SUPA}/rest/v1/issues?assignee=eq.builder&status=eq.open&acceptance_criteria=not.is.null&sprint=not.is.null&order=priority.asc&limit=10&select=*
Headers: apikey: \$SK, Authorization: Bearer \$SK

Step 2: For each issue in order:
- Read title + description + acceptance_criteria carefully
- CHECK FOR REJECTION: If reviewer_notes is set on the issue, this task was previously reviewed and rejected. Read reviewer_notes carefully before starting — they describe what to fix.
- IMMEDIATELY set status=in_progress via MC API: PATCH http://localhost:3000/api/issues with {\"id\":\"<uuid>\",\"status\":\"in_progress\"} (Content-Type: application/json)
- If project is 'Vespera': work in $VES_DIR
- If project is 'Mission Control' or 'Infrastructure': work in $MC_DIR
- Implement the change (if rejected, address all reviewer_notes before submitting again)
- Run npm run build (fix all TypeScript errors before committing)
- git add -A && git commit -m 'feat(TASK_KEY): description [skip ci]'
- Prepare a regression_test string — the exact command or manual steps to verify no regression (e.g. \"npm run build && npm test\" or \"manual: verify X on mobile\"). This is REQUIRED.
- Move to code_review via MC API by PATCHing the ORIGINAL issue (NOT done, NEVER create new tester issues):
  PATCH http://localhost:3000/api/issues with:
  {
    \"id\": \"<uuid of the ORIGINAL issue>\",
    \"status\": \"code_review\",
    \"implementation_notes\": \"<what you built, what you tested, any edge cases>\",
    \"commit_sha\": \"<git rev-parse HEAD output>\",
    \"regression_test\": \"<command or manual steps to verify no regression>\"
  }
  The API will auto-assign the correct reviewer based on severity (S0=designer, S1=tester, S2=po, S3=main).
  If regression_test is empty, the API will reject the request — you MUST provide it.
- ⚠️ NEVER create new tester/reviewer child issues. NEVER POST a new issue for review.
  Just PATCH the original issue to status=code_review. The API handles reviewer routing.
- DO NOT mark status=completed/closed — reviewers and deploy flow handle downstream transitions

⚠️ PARTIAL WORK RULE: If you run out of time or cannot complete a task, you MUST either:
(a) Commit what you have with [WIP] prefix: git add -A && git commit -m '[WIP] partial: description'
(b) OR delete any new files you created that are incomplete: git checkout -- . && git clean -fd
NEVER leave uncommitted partial .tsx/.ts files in the working tree — they poison the TypeScript compiler.

Step 3: After all issues done:
openclaw system event --text 'Builder loop: batch complete — issues done' --mode now
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

      # Capture last 50 lines to temp file, truncate to 2000 chars
      ERRFILE="/tmp/builder-build-error.txt"
      echo "$BUILD_OUTPUT" | tail -50 | head -c 2000 > "$ERRFILE"
      TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
      TODAY=$(date '+%Y-%m-%d')

      # Create bug issue via MC API using python3 for safe JSON encoding
      BUG_RESPONSE=$(python3 -c "
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
req = urllib.request.Request('http://localhost:3000/api/issues', data=payload, headers={'Content-Type': 'application/json'}, method='POST')
resp = urllib.request.urlopen(req)
print(resp.read().decode())
" 2>/dev/null)

      BUG_KEY=$(echo "$BUG_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('task_key','unknown'))" 2>/dev/null || echo "unknown")
      log "Build failed — bug $BUG_KEY created"
      rm -f "$ERRFILE"

      # Skip code_review PATCH (can't submit broken code for review)
      log "Skipping code_review — broken build"

      # Post-task memory: record build failure corrections (TOD-489)
      if [ -f "$MC_DIR/scripts/post-task-memory.sh" ]; then
        echo "$ALL_ISSUES" | python3 -c "import json,sys; [print(i.get('task_key',''),i.get('title','')[:60]) for i in json.load(sys.stdin)]" 2>/dev/null | while read -r TK TT; do
          [ -n "$TK" ] && bash "$MC_DIR/scripts/post-task-memory.sh" builder "$TK" "$TT" "$BUILD_EXIT" 2>>"$LOG" || true
        done
      fi

      # Clean up partial files
      cd "$MC_DIR" && git clean -fd >> "$LOG" 2>&1
      log "git clean -fd complete"
    else
      log "Build verified OK"

      # Post-task memory: record successful session patterns (TOD-489)
      if [ -f "$MC_DIR/scripts/post-task-memory.sh" ]; then
        echo "$ALL_ISSUES" | python3 -c "import json,sys; [print(i.get('task_key',''),i.get('title','')[:60]) for i in json.load(sys.stdin)]" 2>/dev/null | while read -r TK TT; do
          [ -n "$TK" ] && bash "$MC_DIR/scripts/post-task-memory.sh" builder "$TK" "$TT" "0" 2>>"$LOG" || true
        done
      fi
    fi
  else
    log "No open issues for builder — idle"
  fi

  sleep 600
done
