# PIECE: A green light must mean something was measured

id: kill-fake-infra-greens
lane: Truth

## Why this piece matters
Six of ten service indicators on the Infra tab are green because the string 'ok' appears in the source. One reads 'Tunnel active' regardless of whether any tunnel exists. This costs the operator their trust in every other indicator on the page, including the honest ones.

## Build instruction
Remove every hardcoded status literal from app/api/status and components/tabs/InfraTab.tsx. Each indicator resolves to one of: ok (measured just now), degraded, down, or unknown (never checked, or uncheckable on this host) — and carries a checkedAt timestamp. Render unknown visually distinct from ok: grey, not green. The Infra tab should also read /api/health, which is the one honest probe in the cluster and which currently no screen consumes.

## How you are graded — READ THIS
Your acceptance checks are already written, by the orchestrator, in
scripts/acceptance/checks-truth.mjs . You did not write them and you must not
edit them. Run them:

    node scripts/acceptance/run.mjs --piece kill-fake-infra-greens

That command is the gate. A model critic only looks at your work AFTER those
checks pass, and it judges what a script cannot: whether the result is honest,
and whether it is better than how the best mission controls handle this.

If you believe a check is wrong, say so in knownGaps with your reasoning — do
not edit the check to make it pass. Editing your own grader is the one thing
that invalidates the whole exercise.
