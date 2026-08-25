# Wave 5 Acceptance Report — Full Suite

**Server:** `TODERO_URL=http://localhost:3001` (measurement server)
**Range examined:** `cb9bc6f` (checkpoint 2026-08-25 11:26:15) → `HEAD` / `c2bc9ea` (checkpoint 2026-08-25 15:27:29) — 20 commits
**Raw JSON:** `wave5-final.json` in this scratchpad directory

## Harness score

```
45/45 passing
harness score: 10/10
```

## Before / after

- **Before (Wave 4 end, per `scripts/board/waves.json`):** harness **45/45 · 10/10**, zero critical — this was already the Wave 4 exit state after the "Runs anywhere, runs an agent" wave repaired 3 harness commits alongside product fixes.
- **After (this run, Wave 5 in progress):** harness **45/45 · 10/10**, zero critical — unchanged.
- **Check composition:** `run.mjs` merges three files: `checks.mjs` (15), `checks-truth.mjs` (14), `checks-anywhere.mjs` (16) = **45 total**. This is the same 45-check set as Wave 4's "after" figure — no checks were added, removed, or renamed in this commit range.

## Which checks flipped

**None.** All 45 checks pass now and all 45 passed at the Wave 4 baseline captured on the board (45/45 → 45/45). Ran full table output (non-JSON) and confirmed every id is `PASS`, including the security-sensitive ones (`rbac-*`, `no-jwt-in-source`, `dispatch-guard-armed`, `dispatch-guard-untouched`) and the new-since-Wave-4 evidence/agent-manifest-adjacent checks (`agent-registration-endpoint`, `liveness-from-data`, `vault-is-read-only`, `runs-without-vault`, `memory-loop-portable`, `retrieval-is-budgeted`, `inbox-approve-persists`, `ceilings-exist`, `ledger-closes-rows`).

## Does this range modify `scripts/acceptance/`?

**No.** `git log --oneline cb9bc6f..HEAD -- scripts/acceptance/` returns empty, and `git diff --stat cb9bc6f..HEAD -- scripts/acceptance/` shows zero changes. **The instrument was not touched in this range** — unlike Wave 4, where 3 of that wave's commits modified the harness itself and the score movement had to be attributed partly to instrument repair. Here, the 45/45 score reflects the product's state being verified by an unchanged measuring stick — a "product held steady" signal, not a "score moved because the ruler changed" signal.

Note there IS a new, separate script in this range — `scripts/evidence/verify.mjs` (598 lines, new file, added by the `evidence-based-verification` piece work) plus a new `npm run verify:evidence` entry in `package.json`. This is **not** part of `scripts/acceptance/` and is not wired into `run.mjs` — it's a standalone live-dispatch correlation verifier (checks that a claimed agent run is corroborated by its own token-ledger row + matching runtime + Ollama/trace evidence, replacing an earlier co-occurrence-only verifier). It does not affect the 45-check harness score reported above, but flag it as a second verification surface that exists now.

## `git log --oneline` since `cb9bc6f`

```
c2bc9ea checkpoint: 2026-08-25_15:27:29
26b2591 feat(TOD-2381): stage the archive — migration 057 + the Wave 6 piece
6806eb4 checkpoint: 2026-08-25_15:08:49
1cc3a66 checkpoint: 2026-08-25_14:54:16
adbbeb1 wip(TOD-2381): memory-retrieval-relevance r4 — PASS; track auto-epic creation failures in cascade_failures
df72eb7 checkpoint: 2026-08-25_14:05:45
36e5889 wip(TOD-2381): silent-write-failures r3 — critic 7; add tests for corrupt sqlite store detection
32706bb checkpoint: 2026-08-25_13:54:14
597d332 chore(TOD-2381): merge four project spellings into Todero
fa5f656 checkpoint: 2026-08-25_13:42:07
daf0287 checkpoint: 2026-08-25_13:39:36
f7d362e checkpoint: 2026-08-25_13:37:34
9de5534 checkpoint: 2026-08-25_13:29:58
667c1e8 checkpoint: 2026-08-25_13:27:52
ac3fc4a wip(TOD-2381): silent-write-failures r1 — critic 6; route retrieval diagnostics to stdout, not just stderr
32645dd wip(TOD-2381): memory-retrieval-relevance r1 — critic 5; refactored memory retrieval portable logic, agent manifest tables, and circuit-breaker queue integration
0d38daa wip(TOD-2381): evidence-based-verification r4 — critic 4; harness test failure with UV_HANDLE_CLOSING assertion
d845987 wip(TOD-2381): evidence-based-verification r3 — gate 10 failing; extend token ledger and verification logic
0d262f4 wip(TOD-2381): evidence-based-verification r2 — critic 5; strict correlation via run-id, runtime gate, upstream timing windows
aa89ad8 checkpoint: 2026-08-25_12:24:11
```
20 commits: 6 named `wip(TOD-2381)` / 1 `feat(TOD-2381)` / 1 `chore(TOD-2381)`, plus 12 unlabeled `checkpoint:` autosave commits. All work is under a single ticket, TOD-2381.

## Anything that looks like a regression

None found by re-running the suite — all 45 checks still pass, including the historically fragile ones (RBAC, pagination `has_more`, dispatch kill switch, no-fabricated-status/meetings/cron checks). One commit message is itself a documented regression-during-development, not a shipped one: `0d38daa "evidence-based-verification r4 — critic 4; harness test failure with UV_HANDLE_CLOSING assertion"` — this correlates with the stray `output.txt` file (see below), which is the crash log from that failing run. It shows the harness hit a Windows-specific libuv assertion (`UV_HANDLE_CLOSING`, `src\win\async.c:94`) mid-wave and reported `0/0 passing · harness score: 0/10` at that moment — but this was a transient dev-loop failure that a later commit (`0d262f4`+ / the eventual green run) resolved; the *current* full-suite run is clean at 45/45. Flagging it because a `0/0` harness score existing anywhere in the commit history for this piece is worth knowing about even though it didn't ship.

Also worth a look, not a regression per se: `components/crew/AgentDetail.tsx` (224 lines) was deleted and `components/crew/AgentDetailView.tsx` / `components/tabs/AgentDetailView.tsx` were both substantially rewritten in the same range — two similarly-named `AgentDetailView.tsx` files now exist in different directories (`components/crew/` and `components/tabs/`). Not verified whether this is intentional duplication or leftover from a move; worth a human check.

## Files that should not be tracked

- **`output.txt`** (repo root, added by commit `0d38daa`) — contents are a raw harness crash dump, not source:
  ```

    0/0 passing  (0ms)
    harness score: 0/10

  Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
  ```
  This is debug/scratch output from a failed local test run (Windows libuv assertion), committed to the repo root. `.gitignore` only excludes `*.log`, not `*.txt`, so this slipped through. It should be removed from tracking (not fixed here per instructions — report only).

No other untracked-looking additions found; `git status` is clean (nothing untracked/modified in the working tree), and the rest of the diff (migrations 054–057, `lib/agent-manifests.ts`, `lib/resolve-dispatch-model.ts`, new test files, `scripts/evidence/verify.mjs`, `scripts/merge-todero-projects.mjs`) all read as intentional source/migration/test additions tied to TOD-2381 pieces (evidence-based-verification, memory-retrieval-relevance, silent-write-failures, project-name merge, and the Wave 6 archive staging).

## Harness score (plain text)

```
45/45 passing
harness score: 10/10
```
