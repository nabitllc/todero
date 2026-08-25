# PIECE: The office must not fabricate meetings it never observed

id: kill-office-fiction
lane: Surface

## Why this piece matters
The Office canvas infers a meeting from two agents being active within 5 seconds of each other, then renders canned MEETING_SUMMARIES as if they were minutes of a real conversation. Four sidebar panels advertise a completed-task waterfall, a leaderboard and an incident log that are structurally incapable of having data.

## Build instruction
Remove the co-activity meeting inference and the canned summaries entirely. The office may render only what it actually observes from agent runs. For each dead sidebar panel, either back it with real data or remove the panel — a panel advertising a capability it cannot have is the same defect as a fake green light. Keep the canvas itself: its agent-position binding is real and is the best thing in the product. Do not regress it.

## How you are graded — READ THIS
Your acceptance checks are already written, by the orchestrator, in
scripts/acceptance/checks-truth.mjs . You did not write them and you must not
edit them. Run them:

    node scripts/acceptance/run.mjs --piece kill-office-fiction

That command is the gate. A model critic only looks at your work AFTER those
checks pass, and it judges what a script cannot: whether the result is honest,
and whether it is better than how the best mission controls handle this.

If you believe a check is wrong, say so in knownGaps with your reasoning — do
not edit the check to make it pass. Editing your own grader is the one thing
that invalidates the whole exercise.
