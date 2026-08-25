# PIECE: One command turns migrations into a schema, and health says when it has not

id: schema-migrations
lane: Core

## Why this piece matters
Three tables the app queries have never existed (connections, deploy_history, workspace_members) and three routes 500 as a result. A stranger has no command that creates the schema. /api/health returns green without ever checking the schema it depends on.

## Build instruction
Write the missing migrations for connections, deploy_history and workspace_members, matching the columns the querying code actually selects — read the routes, do not guess. Add npm run db:migrate as a plain node script with a schema_migrations ledger table so it is idempotent. Add a REQUIRED_TABLES preflight and make /api/health return 503 with {ok:false, missing:[...], fix:'npm run db:migrate'} when any are absent. Routes hitting a missing table return a named error naming the table and the fix — never a raw PostgREST 'schema cache' string, which leaks internals and means nothing to an operator.

## How you are graded — READ THIS
Your acceptance checks are already written, by the orchestrator, in
scripts/acceptance/checks-truth.mjs . You did not write them and you must not
edit them. Run them:

    node scripts/acceptance/run.mjs --piece schema-migrations

That command is the gate. A model critic only looks at your work AFTER those
checks pass, and it judges what a script cannot: whether the result is honest,
and whether it is better than how the best mission controls handle this.

If you believe a check is wrong, say so in knownGaps with your reasoning — do
not edit the check to make it pass. Editing your own grader is the one thing
that invalidates the whole exercise.
