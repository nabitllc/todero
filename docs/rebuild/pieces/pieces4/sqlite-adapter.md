# PIECE: A SQLite adapter behind the existing db seam, so Todero runs with zero external services

id: sqlite-adapter
lane: Runs-Anywhere

## Why this piece matters
This IS the stated goal. Todero hard-requires cloud Supabase; builderz-labs/mission-control — the closest comparator — runs on SQLite with one start command and no Redis, Postgres or Docker. lib/db/adapters.ts already registers only Supabase, and the root db.sqlite is a 0-byte file nothing references, so the capability is currently implied but absent.

## Build instruction
Implement lib/db/sqlite-adapter.ts against the adapter interface already defined by the db seam. Copy the proven configuration from builderz: better-sqlite3, a module-level singleton, data directory at .data/ overridable by TODERO_DATA_DIR, and PRAGMAs WAL + synchronous=NORMAL + foreign_keys=ON + busy_timeout=5000 — the busy_timeout matters because Next.js runs concurrent route handlers against the same file. Select the adapter from TODERO_DB_PROVIDER (sqlite|supabase), defaulting to sqlite when no Supabase env vars are present, so a stranger with no cloud account gets a working app rather than a stack trace. Do not migrate any data; both adapters must satisfy the same interface.

## How you are graded
Your acceptance checks are written by the orchestrator in
scripts/acceptance/checks-anywhere.mjs . You did not write them and you must
not edit them. Run:

    node scripts/acceptance/run.mjs --piece sqlite-adapter

That is the gate. A frontier critic looks at your work only after it is green,
and judges what a script cannot: whether the result is honest, and whether it
beats the comparator. If you think a check is wrong, say so in knownGaps with
your reasoning — never edit your own grader.

## Reference
The full comparator analysis is at C:/Users/msaen/AppData/Local/Temp/claude/C--Development-Todero/9ddc17d7-6e60-4b28-bbea-9d05df164c88/scratchpad/comparator-diff.md —
read the sections relevant to your piece. It contains the concrete shapes to
copy from builderz-labs/mission-control and Hermes Agent, and a list of things
that could NOT be verified. Do not treat an unverified item as fact.
