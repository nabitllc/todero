# PIECE: Stop displaying automations that cannot run

id: kill-fake-automations
lane: Truth

## Why this piece matters
The Automations and Calendar tabs render a header reading ALWAYS RUNNING with live countdown timers for jobs sourced from a static array. Those jobs are 19 macOS launchd plists that cannot fire on this machine. A countdown to an event that will never happen is worse than an empty state.

## Build instruction
Delete the hardcoded job array (lib/mc-constants.ts and anything reading it). /api/automations must return what it actually knows, with an explicit source/scheduler field naming where the knowledge came from, e.g. {source:'vercel-cron'|'none', jobs:[...]}, so a reader can tell a real job from an invented one. When nothing is known, both tabs render an honest empty state saying WHY there are no automations on this host and what would create them. No countdowns for jobs with no scheduler.

## How you are graded — READ THIS
Your acceptance checks are already written, by the orchestrator, in
scripts/acceptance/checks-truth.mjs . You did not write them and you must not
edit them. Run them:

    node scripts/acceptance/run.mjs --piece kill-fake-automations

That command is the gate. A model critic only looks at your work AFTER those
checks pass, and it judges what a script cannot: whether the result is honest,
and whether it is better than how the best mission controls handle this.

If you believe a check is wrong, say so in knownGaps with your reasoning — do
not edit the check to make it pass. Editing your own grader is the one thing
that invalidates the whole exercise.
