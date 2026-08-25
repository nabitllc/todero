# PIECE: Dispatch one real task to the local model, end to end, from the UI

id: run-agent-locally
lane: Operator

## Why this piece matters
This is the headline proof of the entire program. Today there are zero UI call sites for /api/run-agent, and dispatch is deliberately blocked by lib/dispatch-guard.ts. Everything else in this wave is plumbing until a task goes in and work comes out.

## Build instruction
Add a launch control to the agent surface. It must respect lib/dispatch-guard.ts: when dispatch is disabled the control renders as visibly disabled and explains why and which env var enables it — it must never appear armed and then 503 on click, and you must NOT remove or weaken the guard. Route the run through the LLM_BASE_URL seam to Ollama using the tier and fallback_local from the agent registry. Record the run: start, heartbeat, completion, token counts, cost, and the post-task record from memory-loop-write. Then verify it for real by setting TODERO_DISPATCH_ENABLED=1 for ONE run of ONE task, confirming the Ollama server log shows the request, and reporting the run id. Turn it back off when you are done.

## Added after the comparator review — two hard requirements

1. **agent-budget-stop must be in force.** Do not dispatch anything until a
   per-agent budget can refuse a run. The vault records a 17-hour, $688 overnight
   incident caused by exactly this gap. Coordinate: that piece is in your lane.

2. **The run must produce a trace, not a log line.** Paperclip ships "full
   tool-call tracing and audit log" per ticket; Todero scored 0 on per-run
   tracing because no trace object exists at all. The run you dispatch must
   record a drillable structure — the run, its steps, each tool call, tokens and
   cost per step — such that the owner can open the run and see what the agent
   actually did. A flat list of sentence fragments is what Todero has today and
   is not acceptable as the output of this piece.

## How you are graded
Your acceptance checks are written by the orchestrator in
scripts/acceptance/checks-anywhere.mjs . You did not write them and you must
not edit them. Run:

    node scripts/acceptance/run.mjs --piece run-agent-locally

That is the gate. A frontier critic looks at your work only after it is green,
and judges what a script cannot: whether the result is honest, and whether it
beats the comparator. If you think a check is wrong, say so in knownGaps with
your reasoning — never edit your own grader.

## Reference
The full comparator analysis is at C:/Users/msaen/AppData/Local/Temp/claude/C--Development-Todero/9ddc17d7-6e60-4b28-bbea-9d05df164c88/scratchpad/comparator-diff.md —
read the sections relevant to your piece. It contains the concrete shapes to
copy from builderz-labs/mission-control and Hermes Agent, and a list of things
that could NOT be verified. Do not treat an unverified item as fact.
