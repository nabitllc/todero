# PIECE: No surface may render an empty state over a failed request

id: ui-error-surfacing-complete
lane: Surface

## Why this piece matters
One shared fetch anti-pattern makes multiple tabs lie. Memory renders "0 entries / No memory files yet" over a live 403. While any surface does this, no audit of any surface can be trusted, and neither you nor the owner can tell a fixed feature from a dead one.

## Build instruction
Create one shared hook (hooks/useApiData.ts) returning {data, error, status, loading} that checks res.ok BEFORE parsing and never substitutes an empty array for a failure. Convert every tab that fetches: Issues, Features, EpicMap, ProductBoard, Projects, Memory, Overview, Activity, Inbox, Crew. Each renders a visible error banner carrying the status code, the endpoint, and the server's message. Also give BoardTab's optimistic drag an else branch: on a non-ok PATCH, revert the card to its original column and surface a toast — today it moves regardless of what the server said.

## How you are graded — READ THIS
Your acceptance checks are already written, by the orchestrator, in
scripts/acceptance/checks-truth.mjs . You did not write them and you must not
edit them. Run them:

    node scripts/acceptance/run.mjs --piece ui-error-surfacing-complete

That command is the gate. A model critic only looks at your work AFTER those
checks pass, and it judges what a script cannot: whether the result is honest,
and whether it is better than how the best mission controls handle this.

If you believe a check is wrong, say so in knownGaps with your reasoning — do
not edit the check to make it pass. Editing your own grader is the one thing
that invalidates the whole exercise.
