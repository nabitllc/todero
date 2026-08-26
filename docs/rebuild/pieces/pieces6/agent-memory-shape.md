# `agent_memory` has the wrong shape

`/api/health` reports green while two shipped features are broken against this
table. This piece fixes the shape, and fixes the guard that let it hide.

## 1. The schema that is actually running

Read from the running store (`./db.sqlite`), not from a migration:

```
$ node -e "...SELECT sql FROM sqlite_master WHERE name='agent_memory'..."

CREATE TABLE agent_memory (
  id          TEXT PRIMARY KEY DEFAULT (…uuid…),
  agent_id    TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  date_key    TEXT,
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (agent_id, memory_type, date_key),
  CHECK (memory_type IN ('daily','long_term','self_improving','corrections','session_state'))
)
```

There is no `key` column and no `value` column.

Two further facts, also read rather than assumed:

- `agent_memory` holds **0 rows**. `agent_memory_files` holds **0 rows**.
  Nothing is lost by reshaping.
- `agent_memory_files` has the **identical** column set (same six columns, same
  `UNIQUE (agent_id, memory_type, date_key)`), minus the CHECK. On SQLite the
  two tables are duplicates of each other.

`migrations/016_agent_documents.sql` is where the duplicate came from. It
creates `agent_memory` with the daily-notes shape, and then eleven lines later
states in a comment that the real table is "key/value jsonb". The comment was
right and the DDL was wrong; `migrations/sqlite/000_baseline.sql` was translated
from the DDL, so it copied the error onto every SQLite host.

## 2. What the call sites actually store

The brief named seven. There are **fourteen**, in fourteen files. Every one of
them reads or writes `key` / `value`. **Not one** reads `agent_memory` as
daily notes.

| # | Call site | Uses | Stored under `value` |
|---|---|---|---|
| 1 | `app/api/settings/cost-history/route.ts:19` | `select('value, updated_at').eq('key','daily_cost_snapshot')` | object |
| 2 | `app/api/agent-pause/route.ts:18,93,122` | `is_paused`, `loop_breaker` | object |
| 3 | `app/api/hub-pause/route.ts:32,86,123` | `hub_pause` | object |
| 4 | `app/api/inbox/route.ts:106,113,178` | `is_paused`, `loop_breaker`, `ceiling_stop` | object |
| 5 | `app/api/circuit-breaker/route.ts:30,43` | `state` | object |
| 6 | `app/api/agents/route.ts:820,843,859` | `capability_registry` | object |
| 7 | `app/api/theme/route.ts` → `lib/theme.ts:31,44` | `mc_theme` | **bare string** |
| 8 | `lib/agent-budget.ts:135,684` | `heartbeat`, `ceiling_stop` | object |
| 9 | `lib/agent-heartbeats.ts:179,223,290` | `heartbeat` | `JSON.stringify(obj)` |
| 10 | `lib/agent-registrations.ts:~175` | `registration` | `JSON.stringify(obj)` |
| 11 | `lib/loop-breaker.ts:23,48` | `is_paused`, `loop_breaker`, `loop_breaker_history` | object / array |
| 12 | `lib/agent-memory.ts:19,44,58` | arbitrary (`rememberFact`) | arbitrary |
| 13 | `lib/hub-pause.ts:18` | `hub_pause` | object |
| 14 | `app/api/db/[...path]/route.ts:33` | passthrough allow-list | n/a |

Daily-notes call sites — `app/api/agent-memory/route.ts`, `app/api/memory/route.ts`,
`lib/memory-budget.ts`, `lib/memory-loop.ts`, `components/tabs/MemoryTab.tsx`,
`components/tabs/MemoryBudgetCard.tsx`, `config/migrations/seed-agent-db.ts` —
**all** target `agent_memory_files`. None target `agent_memory`.

Every writer declares `{ onConflict: 'agent_id,key' }`, so the table needs
`UNIQUE (agent_id, key)` or `lib/db/pg-sql.ts`'s `conflictSql()` compiles an
`ON CONFLICT (agent_id, key)` with no matching index and the write fails.

## 3. The decision

**Give `agent_memory` the key/value columns.** Do not move the writers.

Counting which option makes the fewest call sites lie, which is the test the
brief set:

- **Reshape `agent_memory` to key/value** — 14 call sites become true, 0 become
  false, 0 files edited outside the migration. The daily-notes role is already
  fully served by `agent_memory_files`, which owns all seven of its call sites.
- **Move the KV writers to a new table** — 14 files edited (11 of them owned by
  other agents working right now), and `agent_memory` would survive as an exact
  duplicate of `agent_memory_files` that nothing on earth reads.

The second option also contradicts the codebase's own recorded understanding:
`app/api/run-agent/route.ts:146` says plainly that `agent_memory` *is* the
key-value store and `agent_memory_files` is the notes table. The migration is
catching the schema up to a decision the code made long ago.

## 4. Observed failures, before the fix

```
$ curl -s -w '%{http_code}' localhost:3000/api/settings/cost-history
502  {"error":"query failed: no such column: \"value\" …"}

$ curl -s -X PATCH localhost:3000/api/agent-pause -d '{"agent":"…","paused":false}'
500  {"error":"table agent_memory has no column named key"}

$ curl -s localhost:3000/api/health
{"ok":true, … "schema":{"missingTables":[]} …}
```

The third line is the reason the first two survived for months.

## 5. The guard that hid it

`lib/required-tables.ts:47` probes every table with `.select('id').limit(1)`.
`id` is present on all of them, including a table with entirely the wrong
shape. The check proves existence and reports it as health.

Fix: probe a **shape column** — a column that only the correct shape has — for
the tables where shape has actually drifted, falling back to `id` elsewhere.

## ACCEPTANCE

1. The live `agent_memory` table has columns `agent_id`, `key`, `value`,
   `updated_at`, and a UNIQUE constraint on `(agent_id, key)`, read back from
   `sqlite_master` / `pragma_table_info` — not from the migration file.
2. `migrations/062_agent_memory_kv.sql` and `migrations/sqlite/062_agent_memory_kv.sql`
   exist, apply cleanly, and are idempotent; the Postgres file branches on the
   shape it finds so it is correct against both a fresh database (where 016 made
   the daily-notes shape) and a hosted one (already key/value).
3. The migration comment states which option was chosen and why, and describes
   only the shape it actually creates.
4. Any daily-notes rows present in `agent_memory` at migration time are copied
   into `agent_memory_files` before the reshape — the reshape loses no data.
5. `GET /api/settings/cost-history` returns **200** with a seven-element array,
   observed against the running dev server.
6. `PATCH /api/agent-pause` no longer fails with `no column named key`, observed
   against the running dev server.
7. `lib/required-tables.ts` probes a shape-bearing column, so a table with the
   wrong shape is reported unhealthy rather than green.
8. Acceptance 7 is **proved by breaking it**: point a probe at a column that does
   not exist, observe `/api/health` report unhealthy, then restore it.
9. `lib/__tests__/agent-kv.test.ts` covers the key/value accessor and the
   shape-probe behaviour.
10. `lib/__tests__/migrations-from-zero.test.ts` still passes under `npm test`
    (PGlite, every `migrations/*.sql` in filename order, from empty).
11. `node scripts/acceptance/run.mjs` still reports 45/45.
12. `npx tsc --noEmit` is clean.
13. Every fixture row inserted during verification is removed, confirmed by a
    follow-up count query.
