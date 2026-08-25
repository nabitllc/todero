# PIECE: Repair the post-task learning loop so it runs on any OS

id: memory-loop-write
lane: Learning

## Why this piece matters
Todero already built the write half of this under TOD-489 — post-task-memory.sh harvests rejection reasons into corrections.md and promote-hot-patterns.sh promotes anything repeating three or more times to a HOT tier. Both are dead on non-macOS hosts because they hardcode /Users/kemuniagent. This is repair, not invention.

## Build instruction
Port both scripts to portable Node using lib/paths.ts, and move the store from loose Markdown into the database so it can be queried. After every agent run, write a structured record: what was attempted, what succeeded, what failed, and the rejection reason if any. Keep the existing 3-repeat promotion threshold — it is already tuned. Then add the proposal path from docs/brain2-integration.md: when a pattern clears the HOT threshold, draft a skill proposal into Mich-Brain2/_pending/skill-updates/ for the owner to approve by hand. That is the ONLY vault path Todero may write, and it must never write anywhere else in the vault, nor approve its own proposal.

## How you are graded
Your acceptance checks are written by the orchestrator in
scripts/acceptance/checks-anywhere.mjs . You did not write them and you must
not edit them. Run:

    node scripts/acceptance/run.mjs --piece memory-loop-write

That is the gate. A frontier critic looks at your work only after it is green,
and judges what a script cannot: whether the result is honest, and whether it
beats the comparator. If you think a check is wrong, say so in knownGaps with
your reasoning — never edit your own grader.

## Reference
The full comparator analysis is at C:/Users/msaen/AppData/Local/Temp/claude/C--Development-Todero/9ddc17d7-6e60-4b28-bbea-9d05df164c88/scratchpad/comparator-diff.md —
read the sections relevant to your piece. It contains the concrete shapes to
copy from builderz-labs/mission-control and Hermes Agent, and a list of things
that could NOT be verified. Do not treat an unverified item as fact.
