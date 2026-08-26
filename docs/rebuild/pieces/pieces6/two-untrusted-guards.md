# two-untrusted-guards

Two guards in this tree claim enforcement they do not perform. `docs/rebuild/HANDOFF.md`
names this the worst class: *"a guard whose comment describes enforcement it does not
perform is worse than no guard, because it is trusted."* Both were found by critics
reading the source, not by CI — which is the point: CI was green through both.

Everything in the two "MEASURED" blocks below was reproduced in this session before a
line was edited. The mutation in Defect 1 was actually applied and actually reverted.

---

## DEFECT 1 — a test named after a function that never calls it

`lib/__tests__/pipeline-stages.test.ts:160-169` is titled
`computeModelDefects() names the status when one is unmapped` and comments that it
*"Proves the detector FAILS when it should, not merely that it passes when it should."*
Its body never calls `computeModelDefects`. It re-implements a set difference from
`VALID_STATUSES` and `mappedStatuses()` in local variables and asserts on that local
arithmetic. The set difference it proves correct is JavaScript's, not the detector's.

This matters more than a mis-titled test, because `PIPELINE_MODEL_DEFECTS` — the
module-load result of `computeModelDefects()` — is what `components/tabs/PipelineTab.tsx`
renders **in place of** the board when it is non-empty. The detector is the only thing
standing between an operator and a board that is silently dropping cards.

### MEASURED before any edit
- `npm test -- lib/__tests__/pipeline-stages.test.ts` → **53 passed, 53 total**.
- Inserted `if (1) return []` as the first line of `computeModelDefects()`
  (`lib/pipeline-stages.ts:207`), disabling all six of its checks.
- Re-ran → **53 passed, 53 total**. Zero failures.
- Reverted from a byte copy taken before the mutation.

The claim is true as written. The detector can be neutered whole and CI stays green.

---

## DEFECT 2 — a derived-honesty mechanism that is a typed literal

`lib/agent-responsibilities.ts:431` declares
`export const RESPONSIBILITY_CONSUMERS: readonly string[] = []` and nothing computes it.
`components/tabs/ResponsibilitiesCard.tsx:15-18` claims the opposite in words:
*"The notice below is not a hardcoded sentence — it is `not_consulted_notice` from the
API, driven by RESPONSIBILITY_CONSUMERS … Wiring a real consumer changes what this card
says, in the same commit, automatically."*

### MEASURED before any edit — three sub-claims, all three true
1. `RESPONSIBILITY_CONSUMERS` is a literal `[]`. Nothing computes it: the only
   occurrences repo-wide are its declaration, two pass-throughs in
   `app/api/agent-responsibilities/route.ts` (lines 147 and 236) and one assertion in
   `lib/__tests__/agent-responsibilities.test.ts:280`.
2. `NOT_CONSULTED_NOTICE` (`lib/agent-responsibilities.ts:433`) is a plain string
   concatenation. It does not read `RESPONSIBILITY_CONSUMERS` and cannot vary with it.
   Populating the array changes nothing the card says. The quoted sentence is false.
3. `ResponsibilitiesCard.tsx:172-173` renders the notice unconditionally and appends
   `Read by: …` when `consulted_by` is non-empty. A populated array therefore renders
   both *"Nothing acts on these assignments yet"* **and** *"Read by: agent-queue"* in
   the same amber box.

### The option chosen, and why the other two were rejected
- **Rejected: derive the list by scanning for importers.** A static import scan cannot
  distinguish "reads these rows to make a decision" — what the sentence means — from
  "renders them". `app/api/agent-responsibilities/route.ts` imports `coverage()` today
  purely to serve it for display. A derived list would immediately name the API route
  and the card as consumers, making the card say *"Read by: route.ts"* while nothing
  acts on the rows. That replaces a false sentence with a different false sentence.
- **Rejected: delete the claim.** Honest, but it discards the only pressure that would
  make the notice update when dispatch is finally wired.
- **Chosen: make the sentence structurally true, and put a test behind the array.**
  Two halves, both observable:
  - `notConsultedNotice(consumers)` becomes a real pure function of the array, and
    `NOT_CONSULTED_NOTICE` is defined as `notConsultedNotice(RESPONSIBILITY_CONSUMERS)`.
    Same export name, same `string` type, so `app/api/agent-responsibilities/route.ts`
    (not owned by this piece) is untouched. Populating the array now genuinely changes
    the sentence, which is what the card claims.
  - An importer test fails the moment any file outside a named display-only allowlist
    imports the decision-making exports while `RESPONSIBILITY_CONSUMERS` is still empty.
    The array is still maintained by hand — the card no longer pretends otherwise — but
    it can no longer go stale silently.

---

## ACCEPTANCE

Every item observable by a command named in the item.

1. `lib/__tests__/pipeline-stages.test.ts` contains no test that re-implements
   `computeModelDefects`'s set arithmetic locally and asserts on the local copy.
   Observable: the body of every test whose title names `computeModelDefects` calls
   `computeModelDefects`.
2. `computeModelDefects()` accepts the column model as an argument, defaulting to
   `PIPELINE_COLUMNS`, so a test can hand it a deliberately broken model. Observable:
   `npx tsc --noEmit` is clean and `PIPELINE_MODEL_DEFECTS` still equals `[]`.
3. Each of the six checks inside `computeModelDefects()` has a test that feeds it a
   model violating exactly that check and asserts the returned sentence NAMES the
   offending column or status. Observable: six distinct failing-input tests.
4. Re-applying the Defect 1 mutation (`if (1) return []` as the first statement of
   `computeModelDefects`) turns `npm test -- lib/__tests__/pipeline-stages.test.ts`
   RED, and the report states the exact failure count. Before this piece the same
   mutation left 53/53 green.
5. `PIPELINE_MODEL_DEFECTS` is still `readonly string[]`, still frozen, still `[]` in a
   healthy tree, and `components/tabs/PipelineTab.tsx` is not edited by this piece.
6. `lib/agent-responsibilities.ts` exports `notConsultedNotice(consumers)`, a pure
   function whose output differs between an empty and a non-empty argument.
   Observable: a test asserting both branches on the real function.
7. `NOT_CONSULTED_NOTICE` keeps its name and `string` type and is defined as
   `notConsultedNotice(RESPONSIBILITY_CONSUMERS)`. Observable:
   `app/api/agent-responsibilities/route.ts` is unedited and `npx tsc --noEmit` is clean.
8. A populated `RESPONSIBILITY_CONSUMERS` can never render both "Nothing acts on these
   assignments yet" and "Read by: …". Observable: a test asserting the non-empty branch
   of `notConsultedNotice` does not contain "Nothing acts on", and
   `ResponsibilitiesCard.tsx` no longer appends a second `Read by:` clause.
9. A test fails when any file outside the display-only allowlist imports a
   decision-making export of `lib/agent-responsibilities.ts` while
   `RESPONSIBILITY_CONSUMERS` is empty. Observable: the test names the offending file.
10. The comment block at `components/tabs/ResponsibilitiesCard.tsx:15-18` describes the
    mechanism that actually exists, and claims no automation that is not there.
11. Reverting either fix turns its test RED. Both counts reported, both measured, not
    predicted.
12. No test is deleted to make anything pass.
13. `node scripts/acceptance/run.mjs` is still 45/45.
14. `node scripts/no-invented-projects.mjs` still exits 0.
15. `npm test` shows no failures beyond the known pre-existing `agents-route`,
    `agents-unconfigured` and `spawn-live` (5 tests).
16. No fixture rows are left in `./db.sqlite`. This piece inserts none — it is pure
    module-level logic — so the observable is that Limiglow ends at ZERO issues and
    `TOD-1` remains archived in project "Todero", unchanged from session start.

---

## MEASURED AFTER THE FIX

All counts below were run, not predicted.

### Defect 1
| run | result |
|---|---|
| `npm test -- lib/__tests__/pipeline-stages.test.ts`, before any edit | 53 passed / 53 |
| same file, `if (1) return []` inserted at the top of `computeModelDefects()` | **53 passed / 53** — the neutered detector was invisible |
| same file, after the fix | 59 passed / 59 |
| same file, after the fix, **same mutation re-applied** | **6 failed**, 53 passed / 59 |

The six failures are the six new tests, one per check inside the detector.

### Defect 2
| run | result |
|---|---|
| `npm test -- lib/__tests__/agent-responsibilities.test.ts`, before any edit | 36 passed / 36 |
| after the fix | 42 passed / 42 |
| revert: `notConsultedNotice()` stops varying with its argument (the old flat-string semantics) | **2 failed**, 40 passed / 42 |
| revert: the second `Read by: …` clause restored in `ResponsibilitiesCard.tsx` | **1 failed**, 41 passed / 42 |
| simulate a new consumer — `lib/pipeline-stages.ts` imports `coverage` while the list is empty | **1 failed**, 41 passed / 42; the message named `lib\pipeline-stages.ts imports coverage` |

### Gates
- `npx tsc --noEmit` — clean, exit 0.
- `npm test` (full) — 924 passed, 5 failed, 2 skipped / 931. The 5 failures are the known
  pre-existing `agents-route`, `agents-unconfigured`, `spawn-live`. No new failure.
- `node scripts/acceptance/run.mjs` — **45/45 passing**, harness score 10/10, exit 0.
- `node scripts/no-invented-projects.mjs` — exit 0.
- `db.sqlite` — 1 issue total, project "Todero", `archived_at` set; ZERO rows in Limiglow.
  This piece inserted no fixtures.
