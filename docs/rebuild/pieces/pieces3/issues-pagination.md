# PIECE: Report a true issue total instead of a silent 1000-row truncation

id: issues-pagination
lane: Core

## Why this piece matters
Two thirds of the 3,070-issue backlog is invisible and every aggregate count in the product is computed from a truncated slice. Features says 0 over 517. Nothing downstream of a count can be trusted until this is true.

## Build instruction
PostgREST caps at 1000 rows. GET /api/issues must return {data, total, page, limit, has_more} where total comes from a separate count:'exact' head query, not data.length. Support ?limit and ?offset (or ?page) with a sane default and a documented max. Prefer updating callers over preserving the bare-array shape. Then fix the consumers that compute counts from a truncated array: FeaturesTab, ProjectsTab, OverviewTab, EpicMapTab.

## How you are graded — READ THIS
Your acceptance checks are already written, by the orchestrator, in
scripts/acceptance/checks-truth.mjs . You did not write them and you must not
edit them. Run them:

    node scripts/acceptance/run.mjs --piece issues-pagination

That command is the gate. A model critic only looks at your work AFTER those
checks pass, and it judges what a script cannot: whether the result is honest,
and whether it is better than how the best mission controls handle this.

If you believe a check is wrong, say so in knownGaps with your reasoning — do
not edit the check to make it pass. Editing your own grader is the one thing
that invalidates the whole exercise.
