# sweep-unowned-files — the seven files no builder owned

`scripts/no-invented-projects.mjs` exited **1** with **46** violations across
seven files. Every one of them sat outside the ownership boundary of the two
previous sweeps (`no-invented-projects.md`, `no-invented-projects-sweep.md`),
which is why they survived: each sweep cleaned the files it owned and the
fabrication lived in the gap between them.

The `PROJECT_EMOJI` table in `app/api/issues/route.ts:147` is the third-time
survivor `docs/rebuild/HANDOFF.md` warns about. This piece records *why* it kept
surviving, because that reason generalises: **it is dead code.** Nothing in the
repository reads `PROJECT_EMOJI` — the only other match in a full-tree grep is
the guard's own header prose. A sweep that asks "what breaks if I remove this?"
gets the answer "nothing", finds no call site to follow, and moves on. Only a
scanner that looks at *declarations* rather than at *usage* sees it. That is
check 3 in the guard, and it is why the guard exists.

## ACCEPTANCE

1. `node scripts/no-invented-projects.mjs` exits **0**. Not "reports fewer" —
   zero. The exit code is the acceptance criterion; a grep is not.
2. All 46 reported violations are resolved at their reported `file:line`, in
   these seven files only:
   `app/api/issues/route.ts` (18), `app/api/agent-config/route.ts` (16),
   `components/tabs/BoardTab.tsx` (4), `components/KanbanCard.tsx` (4),
   `app/api/activity-feed/route.ts` (4), `app/api/queue-refill/route.ts` (2),
   `components/tabs/ProductBoardTab.tsx` (2).
3. `PROJECT_EMOJI` is **gone as a declaration**, not merely edited down to its
   two real keys. It has no reader anywhere in the tree; a two-key dead table is
   still dead code, and leaving the shape behind is what let it come back twice.
   A tombstone comment replaces it.
4. `AGENTS.md` no longer declares `kemuni-sme` or `vespera-sme` in the Agent
   Roster table. This is the runtime-visible half: `loadAgentRoster()` parses
   that table, so Fleet renders a roster row for every line in it regardless of
   what `lib/agent-roster.ts` contains. Removing the ids from `AGENT_META` in
   the previous sweep changed only how those rows were *styled*, not whether
   they appeared.
5. **`Mission Control` and `Infrastructure` are KEPT, deliberately.** Both are
   canonical in `PROJECT_PREFIX` and both are reported clean by the guard. They
   are not fabrications: each owns a live task-key prefix (`MC-*`; `INF-*`,
   which now mints as `TOD-*`) for rows already in the table, and
   `app/api/issues/route.ts` still files issues under `Mission Control` today
   (`:1899`, `:2381`, `:2385`). Removing either from `PROJECT_PREFIX` would
   silently re-prefix newly minted keys to the `TOD` fallback. This piece does
   not touch `lib/constants.ts`, which already carries the written analysis.
6. Tombstone comments recording each deletion survive in every edited file. The
   guard strips comments before scanning, so a tombstone can never trip it — and
   the record is the only thing that stops a future session reinventing the
   entry. Removing the record is how the fabrication comes back.
7. `lib/dispatch-guard.ts` and `TODERO_DISPATCH_ENABLED` are untouched. The
   queue-refill lane that carried `project: 'Kemuni'` was only ever harmless
   because that kill switch is off; the fix is deleting the lane, never
   loosening the switch.
8. Gates, all green together, not one at a time:
   `npx tsc --noEmit` clean; `node scripts/acceptance/run.mjs` 45/45;
   `npm test` at exactly the known pre-existing failures
   (`agents-route`, `agents-unconfigured`, `spawn-live`) and no new ones;
   `bash scripts/smoke-test-layout.sh` passing.
9. Verified on the **running** app, not by reading source: Fleet's roster lists
   neither `Kemuni SME` nor `Vespera SME`.
10. No files outside the owned list are modified, and no git command is run.
