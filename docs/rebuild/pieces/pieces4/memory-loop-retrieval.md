# PIECE: Retrieve past experience at spawn time, ranked and hard-budgeted

id: memory-loop-retrieval
lane: Learning

## Why this piece matters
The retrieval half was never built. spawn-context.sh injects memory in full — uncapped and unranked — which bloats context and buries the relevant record. Hermes solves this by capping always-in-context memory at roughly 1,300 tokens and making OVERFLOW RETURN AN ERROR rather than truncate, so consolidation is forced rather than optional; everything else is retrieved on demand by full-text search.

## Build instruction
Add FTS5 search over the run-record store. At spawn time, retrieve only records relevant to the task at hand, ranked, and inject under a hard token budget. Copy Hermes's discipline exactly: when the budget would overflow, RAISE AN ERROR rather than silently truncating — a silently truncated context is how an agent loses the one record that mattered. Replace the wholesale injection in spawn-context.sh. Make the budget configurable but small by default.

## How you are graded
Your acceptance checks are written by the orchestrator in
scripts/acceptance/checks-anywhere.mjs . You did not write them and you must
not edit them. Run:

    node scripts/acceptance/run.mjs --piece memory-loop-retrieval

That is the gate. A frontier critic looks at your work only after it is green,
and judges what a script cannot: whether the result is honest, and whether it
beats the comparator. If you think a check is wrong, say so in knownGaps with
your reasoning — never edit your own grader.

## Reference
The full comparator analysis is at C:/Users/msaen/AppData/Local/Temp/claude/C--Development-Todero/9ddc17d7-6e60-4b28-bbea-9d05df164c88/scratchpad/comparator-diff.md —
read the sections relevant to your piece. It contains the concrete shapes to
copy from builderz-labs/mission-control and Hermes Agent, and a list of things
that could NOT be verified. Do not treat an unverified item as fact.
