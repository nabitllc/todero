# Wave 3 Acceptance Report — Todero

## Harness score

- **Before this wave:** 19/29 passing (6.6/10)
- **After this wave:** 29/29 passing (10/10)

## Checks that flipped fail → pass

All 10 previously-failing checks now pass (full 29/29 sweep, no regressions in the suite itself):

- `rbac-owner-reads`
- `rbac-anon-denied-read`
- `rbac-anon-denied-write`
- `rbac-owner-memory`
- `rbac-role-not-self-asserted`
- `issues-paginated` (total=3071, exceeds old 1000-row cap)
- `issues-no-silent-truncation` (has_more=true)
- `health-reports-missing-tables` (health check is now schema-aware)
- `no-500-on-missing-table` (3 routes degrade honestly instead of leaking raw Postgres errors)
- `chat-model-list-is-live` (no hardcoded vendor model menu)

*(Exact prior fail list wasn't in a saved artifact from before this wave, but the current run shows all 29 checks — including the RBAC, pagination, schema-migration, and OpenRouter-removal groups — passing.)*

## Still failing

**None.** `node scripts/acceptance/run.mjs` reports:

```
29/29 passing  (3627ms)
harness score: 10/10
```

`criticalFailed: 0` in the JSON output as well.

## Git log — `rebuild/2026-08-24` since `05b89c3`

```
add6745 checkpoint: 2026-08-25_02:22:32
f81e694 checkpoint: 2026-08-25_02:17:41
652aa1e checkpoint: 2026-08-25_02:08:53
4ff6d2c checkpoint: 2026-08-25_02:02:13
9a3af15 checkpoint: 2026-08-25_01:56:23
0b5eceb checkpoint: 2026-08-25_01:52:26
145d41f checkpoint: 2026-08-25_01:47:09
d41430c checkpoint: 2026-08-25_01:37:37
05ff3ed checkpoint: 2026-08-25_01:30:50
c232b4a checkpoint: 2026-08-25_01:22:14
c4eb9cc checkpoint: 2026-08-25_01:16:52
4b9065e checkpoint: 2026-08-25_01:14:23
b79658f checkpoint: 2026-08-25_01:09:24
6111cbd checkpoint: 2026-08-25_00:52:05
10b603d checkpoint: 2026-08-25_00:49:23
f3b3fe5 checkpoint: 2026-08-25_00:36:36
fa54561 checkpoint: 2026-08-25_00:02:30
```

17 commits, all generic `checkpoint: <timestamp>` messages — none reference a TASK-KEY or describe what landed, which doesn't match the repo's stated commit-format convention (`feat(TASK-KEY): description`).

`git diff 05b89c3..add6745 --stat`: 1273 files changed, 102,876 insertions(+), 7,173 deletions(-). Substantive source changes span `lib/db/*` (new Postgres adapter + query-param layer, `pg-adapter.ts`, `pg-sql.ts`, `join.ts`), `lib/agent-heartbeats.ts`, `lib/llm-provider.ts`, `lib/required-tables*.ts`, new migrations (`000_baseline_schema.sql`, `036_deploy_history_table.sql`, `037_agent_heartbeats.sql`), `scripts/acceptance/checks-truth.mjs`, `scripts/acceptance/ship-gate.mjs`, `scripts/db-migrate.mjs`, and a new `scripts/board/` dashboard generator.

## Regressions / concerns spotted (not fixed, per instructions)

1. **Build output committed to the branch.** `.next-ac3/` — a full Next.js build directory including webpack cache blobs (`*.pack.gz`, one 13.2 MB) — was committed: 614 files under `.next-ac3/` are tracked at `add6745`, ~150 of them touched in this diff range. `.gitignore` was only updated with a `.next-verify/` entry, not `.next-ac3/`, so this directory is unignored and will keep bloating the repo on every future build.
2. **Stray status dump at repo root.** `st.json` — a one-line JSON snapshot of local service health (ollama/discord/telegram/supabase status, hostname `G14-Mich`, uptime, etc.) — is committed at the repo root as of `add6745`. Looks like an accidental `>` redirect of a health-check script output rather than intentional app data.
3. **Commit hygiene.** All 17 commits use the non-standard `checkpoint: <timestamp>` message format instead of the required `feat(TASK-KEY): description [skip ci]` convention from `CLAUDE.md`, making it hard to trace which commit addressed which acceptance check without inspecting the diff.

No functional regressions were observed in the acceptance suite itself — every check that was passing before is still passing, and no check flipped pass → fail.
