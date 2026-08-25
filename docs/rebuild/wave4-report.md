# Wave 4 Acceptance Report — Todero

**Harness score: 45/45 passing, 0 critical failing, score 10/10**

Run artifacts:
- JSON: `C:/Users/msaen/AppData/Local/Temp/claude/C--Development-Todero/9ddc17d7-6e60-4b28-bbea-9d05df164c88/scratchpad/wave4-final.json`
- `{ total: 45, passed: 45, failed: 0, criticalFailed: 0, inconclusive: 0, serverUp: true, score: 10 }`

## Before → after

Per `scripts/board/waves.json` (Wave 4 "before" bullets, dated 25 Aug 06:10):

- Harness **8/10 — 8 critical, all Wave 4 targets**
- No SQLite adapter — cloud Supabase still required to run
- 5 colliding migration prefixes; no ordered runner had ever run
- `POST /api/connect` did not exist — no fleet registration
- Memory injected uncapped and unranked; ledger never closed a row
- Inbox approve still 5xx — no human decision could be recorded

This matches the ballpark figure you gave (~37/45, 8 critical) — 37/45 scaled to /10 is 8.2, i.e. "8/10, 8 critical."

**After this run: 45/45, 0 critical, 10/10.** Every check in the suite passes.

## Checks that flipped (previously the 8 critical failures, now green)

Mapped from the "before" bullets to today's passing checks:

| Area | Check(s) now passing |
|---|---|
| SQLite adapter / no cloud requirement | `sqlite-adapter-registered`, `db-provider-selectable`, `no-external-service-required` |
| Migration collisions / ordered runner | `no-colliding-migrations` (53 unique prefixes), `migration-ledger-exists`, `migration-runner-exists` |
| Fleet registration endpoint | `agent-registration-endpoint` (returns `connection_id` + heartbeat url), `liveness-from-data` |
| Memory budget / ledger finalization | `retrieval-is-budgeted` (raises on overflow, doesn't truncate), `ledger-closes-rows` (finalize called from 14 sites), `memory-loop-portable` |
| Inbox approve 5xx | `inbox-approve-persists` |
| (Also passing, not explicitly called out in the "before" list but part of Wave 4 scope) | `vault-is-read-only`, `runs-without-vault` (Brain2 registry), `ceilings-exist`, `dispatch-guard-untouched`, `launch-control-honest` |

All previously-RBAC/security/path checks from earlier waves (`rbac-*`, `no-jwt-in-source`, `no-mac-paths`, `no-openrouter`, `dispatch-guard-armed`, etc.) remain green — no regressions there.

## `git log --oneline` since `fa96515` (19 commits, oldest → newest)

```
f996fc5 checkpoint: 2026-08-25_04:50:32
ca99e18 checkpoint: 2026-08-25_05:46:02
967c178 checkpoint: 2026-08-25_07:34:37
6a5e5b5 checkpoint: 2026-08-25_07:41:50
908d175 checkpoint: 2026-08-25_07:50:44
f9b62e8 checkpoint: 2026-08-25_07:58:45
a145f28 checkpoint: 2026-08-25_08:06:58
7552578 fix(TOD-2381): harness refuses to grade HTTP checks when the server is down
d870f1f checkpoint: 2026-08-25_08:17:02
b188dc0 checkpoint: 2026-08-25_08:22:41
6512ad2 checkpoint: 2026-08-25_08:31:34
7306915 fix(TOD-2381): inbox check called the wrong verb and slandered working code
e622013 checkpoint: 2026-08-25_08:47:27
b4f9b4d fix(TOD-2381): classify inconclusive by evidence, not by check name
3ad787b checkpoint: 2026-08-25_09:12:33
e40cd86 feat(TOD-2381): measurement gets its own server; board records what it published
34b1c09 checkpoint: 2026-08-25_10:04:46
b073d5c checkpoint: 2026-08-25_10:12:57
47573eb checkpoint: 2026-08-25_10:27:53
```

Three of the named commits touch the **harness itself**, not just the app — worth flagging explicitly since they change what "passing" means:

1. **`7552578`** — `run.mjs` now probes `/api/health` and `/login` first; if neither answers, HTTP-dependent checks report INCONCLUSIVE and are excluded from the critical tally rather than reading as a product regression when the dev server itself has died mid-session (per the commit message, this was the 3rd dev-server death of the session).
2. **`7306915`** — `inbox-approve-persists` had been POSTing to `/api/inbox` (create) instead of PATCHing `{id, status}` (resolve), and `checks.mjs`'s `http()` helper couldn't send a body at all, so it always 500'd. Commit message states explicitly: "Nothing in the app changed" — this was purely an instrumentation bug that had been misreported to the owner as a broken write path.
3. **`b4f9b4d`** — inconclusive-classification now goes by evidence in the failure detail (transport fault) rather than by check name, since name-matching missed `dispatch-guard-untouched` and made an intact guard look like a false "guard NOT armed" alarm.

None of these look like the checks were weakened to pass — each commit message documents a real instrument bug (wrong HTTP verb, no-body limitation, server-down misclassification) with before/after evidence, and `7306915` is explicit that the underlying app code was untouched. Flagging for awareness since harness self-modification is exactly the kind of change that deserves scrutiny, but the diffs read as legitimate measurement fixes, not score inflation.

`e40cd86` is a substantive product commit (measurement gets its own dev server on :3001 with a separate `.next-critic` build dir so a stray production build can't take the measurement server down; `build-board.mjs` now writes `scripts/board/last-published.json` recording what the board actually published, closing a stale-transition-report gap).

The 14 `checkpoint:` commits are auto-committed WIP snapshots (no diff summary needed here — they're the incremental builder commits between the four `fix`/`feat` commits above).

## Possible regressions

None observed. All 45 checks pass, 0 critical, 0 inconclusive, server was up for the full run. No check that was previously reported as passing appears in a failing state.

One thing worth a human look, not a regression per se: **uncommitted working-tree changes** exist right now, not covered by the `--json` run above (git status is clean relative to these, i.e. they're just unstaged, not untracked):

```
 M app/api/run-agent/route.ts       (44 lines changed)
 M app/api/run-agent/trace/route.ts (52 lines changed)
 M lib/runtimes/openai-api.ts       (7 lines changed)
 M lib/runtimes/token-ledger.ts     (8 lines changed)
```

These are live edits sitting on top of the last checkpoint commit (`47573eb`) — the acceptance run above passed against this working tree state (dev server was serving the edited code), but if anything crashes/reverts before the next checkpoint commit, this work is only in the working directory, not in git history yet.

## Files that should not be tracked / stray dumps / hostnames / secrets

- **No stray build output tracked.** `git ls-files` shows no `.next/`, `.next-*/`, `dist/`, or `build/` paths in the tree. `.gitignore` has a broad `.next*/` glob plus an explicit `.next-critic/` entry (added in `e40cd86`), and a comment noting a past incident where a 123MB `.next-ac3` directory got committed because the ignore only named one dir — the glob now covers any distDir name.
- **`scripts/board/last-published.json` is tracked** and is small (score summary: `{passed, total, score, criticalFailed}`, ~5 lines). This is intentional per the `e40cd86` commit message ("board records what it published"), not a stray dump — flagging only because it's app-generated output living in git, which is the kind of file worth watching if it starts growing or updating on every run.
- **No secrets found.** Searched tracked files for `sk-[…]` and JWT-shaped strings (`eyJhbGciOi…`) — zero matches. `no-jwt-in-source` and `no-project-ref-in-source` acceptance checks also pass (0 occurrences each).
- **`.env.local.template` contains no real values** — every credential line is commented out with a `YOUR_*` placeholder (Supabase, Telegram, Discord, GitHub PAT, Anthropic key, MC passwords). `.env.local` itself (the real one) is correctly gitignored via `.env*.local`.
- **Hostname references in tracked source** (`kaos.nabit.work`, `nabit.app`, `localhost:NNNN`) appear only in expected places — `.env.local.template` (documentation), `.cursorrules`, `.githooks/post-commit`, test files, and API routes that legitimately construct local dev URLs (`localhost:3000`/`3001`) or reference the production domain for CORS/webhook config. Nothing looked like a hardcoded personal machine hostname or leaked internal address; no further action flagged.
