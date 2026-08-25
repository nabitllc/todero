# PIECE: Migrations run at boot, and the colliding prefixes are resolved

id: boot-migrations
lane: Runs-Anywhere

## Why this piece matters
The 40 files in migrations/ contain five colliding numeric prefixes (007, 011, 013, 021, 035 each appear twice) — proof no ordered runner has ever executed them. builderz has no migrate command at all: starting the app migrates it, from the first getDatabase() call. A stranger should not have to know a second command exists.

## Build instruction
Renumber the five colliding prefixes into a single unambiguous order, preserving intent — read each pair before deciding which runs first, do not sort blindly. Add a schema_migrations ledger table and a runner invoked from the first getDatabase() call, guarded against NEXT_PHASE === 'phase-production-build' so a build does not touch a database. Every migration must be idempotent. Also keep an explicit `npm run db:migrate` for operators who want to run it deliberately, but the app must not require it. Author the three tables that were never written — connections, deploy_history, workspace_members — matching the columns the querying code actually selects; read the routes, do not guess.

## How you are graded
Your acceptance checks are written by the orchestrator in
scripts/acceptance/checks-anywhere.mjs . You did not write them and you must
not edit them. Run:

    node scripts/acceptance/run.mjs --piece boot-migrations

That is the gate. A frontier critic looks at your work only after it is green,
and judges what a script cannot: whether the result is honest, and whether it
beats the comparator. If you think a check is wrong, say so in knownGaps with
your reasoning — never edit your own grader.

## Reference
The full comparator analysis is at C:/Users/msaen/AppData/Local/Temp/claude/C--Development-Todero/9ddc17d7-6e60-4b28-bbea-9d05df164c88/scratchpad/comparator-diff.md —
read the sections relevant to your piece. It contains the concrete shapes to
copy from builderz-labs/mission-control and Hermes Agent, and a list of things
that could NOT be verified. Do not treat an unverified item as fact.
