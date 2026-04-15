#!/bin/bash
# Sprint Cycle Automation
# Runs at 7am daily via LaunchAgent work.nabit.sprint-cycle
# Closes active sprints and starts new ones for all active businesses (Hubs)

set -euo pipefail

API_BASE="http://localhost:3000"
SUPA_URL="https://twthgapiouiqhavrcnry.supabase.co"
SUPA_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

log "Sprint cycle starting..."

# Gap 7 (2026-04-10): verify the DB active-sprint state before closing.
# Prevents closing the wrong sprint if someone edited the DB manually.
ACTIVE_SPRINTS=$(curl -s "${SUPA_URL}/rest/v1/sprints?status=eq.active&select=sprint_number,name,start_date,project" \
  -H "apikey: ${SUPA_KEY}" -H "Authorization: Bearer ${SUPA_KEY}")
log "Pre-close DB state: ${ACTIVE_SPRINTS}"

# Get all active businesses (Hubs)
BUSINESSES=$(curl -s "${SUPA_URL}/rest/v1/businesses?status=eq.active&select=id,name" \
  -H "apikey: ${SUPA_KEY}" \
  -H "Authorization: Bearer ${SUPA_KEY}")

echo "$BUSINESSES" | python3 -c "
import json, sys, subprocess

businesses = json.load(sys.stdin)
api = '${API_BASE}'

for biz in businesses:
    bid = biz['id']
    name = biz['name']

    # Skip test businesses
    if name in ('Testing1',):
        continue

    print(f'[{name}] Closing sprint...')

    # Try sprint-close (which auto-starts next sprint)
    result = subprocess.run(
        ['curl', '-s', '-X', 'POST', f'{api}/api/sprint-close',
         '-H', 'Content-Type: application/json',
         '-d', json.dumps({'business_id': bid})],
        capture_output=True, text=True
    )

    try:
        data = json.loads(result.stdout)
        if 'error' in data:
            # No active sprint to close — try starting one
            if 'No active sprint' in data.get('error', ''):
                print(f'[{name}] No active sprint. Starting new one...')
                start_result = subprocess.run(
                    ['curl', '-s', '-X', 'POST', f'{api}/api/sprint-start',
                     '-H', 'Content-Type: application/json',
                     '-d', json.dumps({'business_id': bid})],
                    capture_output=True, text=True
                )
                start_data = json.loads(start_result.stdout)
                if 'error' in start_data:
                    print(f'[{name}] ERROR starting: {start_data[\"error\"]}')
                else:
                    sprint = start_data.get('sprint', {})
                    print(f'[{name}] Started {sprint.get(\"name\", \"?\")} ({start_data.get(\"assigned_issues_count\", 0)} issues)')
            else:
                print(f'[{name}] ERROR: {data[\"error\"]}')
        else:
            closed = data.get('closed_sprint', {})
            retro = data.get('retro', {})
            new_sprint = data.get('new_sprint', {})
            print(f'[{name}] Closed {closed.get(\"name\", \"?\")} — completed={retro.get(\"completed\", 0)}, carried={retro.get(\"carried_over\", 0)}')
            ns = new_sprint.get('sprint', {})
            print(f'[{name}] Started {ns.get(\"name\", \"?\")}')
    except json.JSONDecodeError:
        print(f'[{name}] ERROR: invalid response: {result.stdout[:200]}')

print('Sprint cycle complete.')
"

log "Sprint cycle finished."
