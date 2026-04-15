# HEARTBEAT.md — Claude Code version
# Updated: 2026-04-08

## Purpose
Stay quiet unless something actually needs Michael's attention.
Heartbeats run via the builder-loop or on-demand. Prefer silence over noise.

## Check each heartbeat (in order, stop at first alert)

1. **Open queue health** — are there >10 issues in `open` status?
   ```bash
   curl -s "http://localhost:3000/api/issues" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for i in d if i.get('status')=='open'))"
   ```
   If >10: alert with count and recommend triage.

2. **Stale in_progress** — any issue stuck in `in_progress` for >2h with no update?
   Check `self-improving/session-state.md` for current work context.
   If stale found: alert with task_key and age.

3. **Pending decisions** — check `self-improving/session-state.md` Promised Follow-ups table.
   If any follow-up is past due and actionable: surface it with a recommendation.
   If a blocker has been waiting on Michael >2 days: gentle nudge.

4. **Build health** — did the last Builder session leave uncommitted changes?
   If `self-improving/working-buffer.md` has WIP content and no recent commit: flag it.

5. **Self-improving maintenance** — are any HOT tier files getting too large (>100 lines)?
   If yes: compact (merge duplicates, summarize clusters, never delete).

6. **Nothing found** → reply HEARTBEAT_OK

## What NOT to check
- Anything requiring OpenClaw gateway (removed)
- n8n workflows (removed)
- OpenRouter or external model status

## Alert format
One short paragraph. What's the issue, recommended action, consequence if ignored.

## Sprint Reporting (7am/7pm cadence)
- **7pm EDT**: mid-sprint progress — what shipped, what's in flight, blockers
- **7am EDT**: sprint close — full recap, velocity, what carries over
- Triggered by Michael's request or builder-loop completion
