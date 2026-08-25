# PIECE: A failed roster fetch must not invent agents

id: agent-roster-truth
lane: Truth

## Why this piece matters
When /api/agents fails, three call sites in app/page.tsx fall back to a hardcoded four-agent array (KAOS/Builder/Tester/Scout) that contradicts live data — declaring agents idle and never-active while those same agents are running tasks.

## Build instruction
Delete the ALL_AGENTS fallback and every read of it. A failed roster fetch renders an explicit error naming the endpoint and status. An empty roster renders "no agents configured" with the path that was searched. The Crew/Team tab and the Office roster must both consume the real roster only. Do not paper over a failure with plausible-looking data anywhere in this change.

## How you are graded — READ THIS
Your acceptance checks are already written, by the orchestrator, in
scripts/acceptance/checks-truth.mjs . You did not write them and you must not
edit them. Run them:

    node scripts/acceptance/run.mjs --piece agent-roster-truth

That command is the gate. A model critic only looks at your work AFTER those
checks pass, and it judges what a script cannot: whether the result is honest,
and whether it is better than how the best mission controls handle this.

If you believe a check is wrong, say so in knownGaps with your reasoning — do
not edit the check to make it pass. Editing your own grader is the one thing
that invalidates the whole exercise.
