# PIECE: A real agents table with registration and heartbeat

id: agents-table-heartbeat
lane: Fleet

## Why this piece matters
Todero has no agent registration protocol at all — its roster is parsed out of a Markdown file, so the product cannot answer "which agents exist and which are alive" from data. builderz solves this with a documented two-layer protocol.

## Build instruction
Create an agents table (id, name, runtime, status, last_seen_at, registered_at, capabilities json) and the endpoints around it. Follow the builderz shape: POST /api/connect returns a connection_id AND the URLs the client should use next (heartbeat_url, task_report_url) so clients hardcode exactly one path. POST /api/agents/{id}/heartbeat every 30s, marking an agent offline after 10 minutes of silence; a GET on the same URL returns pending work so a firewalled agent can poll instead of holding a stream open. Derive liveness from last_seen_at — never from a hardcoded array. The Crew tab and the Office roster both read this.

## How you are graded
Your acceptance checks are written by the orchestrator in
scripts/acceptance/checks-anywhere.mjs . You did not write them and you must
not edit them. Run:

    node scripts/acceptance/run.mjs --piece agents-table-heartbeat

That is the gate. A frontier critic looks at your work only after it is green,
and judges what a script cannot: whether the result is honest, and whether it
beats the comparator. If you think a check is wrong, say so in knownGaps with
your reasoning — never edit your own grader.

## Reference
The full comparator analysis is at C:/Users/msaen/AppData/Local/Temp/claude/C--Development-Todero/9ddc17d7-6e60-4b28-bbea-9d05df164c88/scratchpad/comparator-diff.md —
read the sections relevant to your piece. It contains the concrete shapes to
copy from builderz-labs/mission-control and Hermes Agent, and a list of things
that could NOT be verified. Do not treat an unverified item as fact.
