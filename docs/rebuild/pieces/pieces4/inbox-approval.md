# PIECE: The approval loop must be able to record a decision

id: inbox-approval
lane: Operator

## Why this piece matters
Approve returns 500. This is the single most important human-in-the-loop primitive in the product and it cannot record an outcome. Grok Bot frames the whole interaction model as "works end to end while you are away, and surfaces only when something needs your approval" — that is the right default for an owner who operates from a phone.

## Build instruction
Fix the write path so approve and reject persist and are visible afterwards. An approval must record who decided, when, and what happened as a result — a decision with no consequence is theatre. Then invert the default: the Inbox shows only what actually needs a human, with everything else reachable but not surfaced. Make it work on a 375px viewport; the owner approves from a phone.

## How you are graded
Your acceptance checks are written by the orchestrator in
scripts/acceptance/checks-anywhere.mjs . You did not write them and you must
not edit them. Run:

    node scripts/acceptance/run.mjs --piece inbox-approval

That is the gate. A frontier critic looks at your work only after it is green,
and judges what a script cannot: whether the result is honest, and whether it
beats the comparator. If you think a check is wrong, say so in knownGaps with
your reasoning — never edit your own grader.

## Reference
The full comparator analysis is at C:/Users/msaen/AppData/Local/Temp/claude/C--Development-Todero/9ddc17d7-6e60-4b28-bbea-9d05df164c88/scratchpad/comparator-diff.md —
read the sections relevant to your piece. It contains the concrete shapes to
copy from builderz-labs/mission-control and Hermes Agent, and a list of things
that could NOT be verified. Do not treat an unverified item as fact.
