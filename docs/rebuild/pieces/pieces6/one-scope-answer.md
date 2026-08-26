# PIECE: One scope answer, and no undeclared agent holding a queue lane

id: one-scope-answer
lane: Truth
branch: rebuild/2026-08-26

OWNS EXCLUSIVELY: lib/scope.ts (new), lib/__tests__/scope.test.ts (new),
app/api/conversations/thread-access.ts, app/api/commerce/scope.ts,
lib/agent-queue.ts, app/api/agent-config/route.ts,
scripts/no-invented-projects.mjs, this file.

DO NOT TOUCH: middleware.ts, app/api/db/[...path]/route.ts,
app/api/activity-feed/route.ts, app/api/issues/route.ts, lib/conversations.ts,
lib/commerce.ts, lib/pipeline-stages.ts, lib/agent-responsibilities.ts,
lib/agent-memory.ts, lib/inbox.ts, lib/issue-type-config.ts, app/page.tsx,
components/**, migrations/**, other scripts/*.

## What was measured before any edit (2026-08-26)

Six places answer "what project is this request scoped to". They disagree.
Measured, not relayed:

```
GET /api/issues?project=Limiglow&limit=1          (no referer)  -> 200 {"data":[],"total":0}
GET /api/db/issues?project=eq.Limiglow&limit=1    (fleet referer) -> 400 unscoped_issues_read
GET /api/db/issues?project=eq.Limiglow&limit=1    (work referer)  -> 200 []
```

Two endpoints, one question, opposite answers. **That pair is the OPEN DECISION
in docs/rebuild/LOOP-PLAN.md:57 and this piece does not resolve it.** It is
recorded here only so a later reader knows it was reproduced, not assumed.

`todero-sme` and `infra-sme` are declared by no AGENTS.md in this repo (19
files; only the root has a roster table; that table has 14 rows and neither id
is among them) yet both hold a live queue lane, a full `/api/agent-config`
record, an assignee dropdown option, and an auto-assign branch.
`scripts/no-invented-projects.mjs` passes them because check 1 validates
`<x>-sme` against canonical PROJECT names, and `Todero` and `Infrastructure`
are both canonical.

## ACCEPTANCE — every item observable

### A. One resolver for conversations and commerce

1. `lib/scope.ts` exists and exports exactly one scope-resolving function,
   `resolveProjectScope(headerScope, queryProject, surface)`, plus the
   `ScopeSurface` descriptors that name each surface.
   Observe: `grep -c "export function resolve" lib/scope.ts` prints `1`.

2. `app/api/conversations/thread-access.ts` calls `resolveProjectScope` from
   `@/lib/scope` and no longer imports `resolveScope` from `@/lib/conversations`.
   Observe: `grep -n "resolveScope" app/api/conversations/thread-access.ts`
   prints nothing.

3. `app/api/commerce/scope.ts` calls `resolveProjectScope` from `@/lib/scope`
   and no longer imports `resolveCommerceScope` from `@/lib/commerce`.
   Observe: `grep -n "resolveCommerceScope" app/api/commerce/scope.ts` prints
   nothing.

4. No refusal weakens on the wire. Every code and status that a client could
   observe before this piece is observed after it:

   | request | before | after |
   |---|---|---|
   | `GET /api/conversations` no referer, no `?project=` | 400 `unscoped_conversations_read` | same |
   | `GET /api/conversations?project=Todero` from a `/p/limiglow/` referer | 409 `scope_conflict` | same |
   | `GET /api/commerce/products` no referer, no `?project=` | 400 `unscoped_commerce_read` | same |
   | `POST /api/commerce/products` body `project` absent, no referer | 400 `unscoped_commerce_write` | same |
   | `GET /api/commerce/products?project=Todero` from a `/p/limiglow/` referer | 409 `scope_mismatch` | same |

   Observe: run the five curls; the codes match the "after" column.

5. Neither surface gains a widening escape. `all_projects=1`,
   `x-mc-all-projects: 1`, `project=*` and `project=` (empty) all still refuse
   on both surfaces.
   Observe: `lib/__tests__/scope.test.ts` asserts each; and
   `grep -c "all_projects" lib/scope.ts` prints `0` outside comments.

6. The unified resolver applies the 120-character project-name cap to BOTH
   surfaces. Commerce did not have one before; gaining it is a tightening, and
   a tightening is allowed where a loosening is not.
   Observe: a 121-char project refuses 400 on the commerce surface.

7. `lib/__tests__/scope.test.ts` contains at least one test that FAILS against
   the pre-piece behaviour, and the report names it and shows both counts.

### B. Two undeclared agents leave live code, with tombstones

8. `lib/agent-queue.ts` has no `todero-sme` and no `infra-sme` key in
   `AGENT_QUEUE_CONFIGS`.
   Observe: `node -e` over the file, or
   `grep -n "'todero-sme':" lib/agent-queue.ts` prints only comment lines.

9. `app/api/agent-config/route.ts` has neither id in any of its five maps
   (`MODEL_MAP`, `QUEUE_FILTER_MAP`, `ESCALATION_MAP`, `SKILLS_MAP`,
   `SYSTEM_PROMPT_MAP`).

10. The live endpoint stops publishing them as configured agents.
    Observe: `GET /api/agent-config?id=todero-sme` returned **200** with a full
    config before; it returns **404 `Unknown agent id`** after. Same for
    `infra-sme`. The no-argument `GET /api/agent-config` list drops from 16
    entries to 14.

11. Both deletions leave a tombstone comment naming what was deleted, what it
    said, and why — following the `kemuni-sme`/`vespera-sme` precedent already
    in both files. The guard strips comments before scanning, so a tombstone
    can never itself be reported as a violation, and removing the record of a
    deletion is how a fabrication gets reinvented.
    Observe: `grep -n "one-scope-answer" lib/agent-queue.ts app/api/agent-config/route.ts`
    prints the tombstone headers.

12. Sites this piece does NOT own are REPORTED with exact line numbers rather
    than edited: `lib/issue-type-config.ts` (assignee dropdown),
    `app/api/issues/route.ts` (alias map, backlog transition list, allowed
    transitioners, auto-assign), `config/migrations/seed-agent-db.ts`.
    Observe: the report lists them; `git diff --name-only` does not.

### C. The guard proves the new defect class

13. `scripts/no-invented-projects.mjs` check 1 no longer asks "does `<x>`
    prefix a canonical project". It asks "is `<x>-sme` a declared agent id".
    Declared means: present in the roster table of the AGENTS.md this
    installation actually reads — the same candidate list `loadAgentRoster()`
    uses, honouring `AGENTS_MD_PATH` / `TODERO_AGENTS_MD`.

14. The guard still refuses to run rather than pass when it cannot read its own
    inputs. A missing or unparseable roster table exits **2**, never 0.
    Observe: `AGENTS_MD_PATH=/nonexistent node scripts/no-invented-projects.mjs;
    echo $?` prints `2`.

15. The guard FAILS when it should. Reintroduce one undeclared `-sme` id into a
    scanned file, run, observe **exit 1** and the id named with file:line.
    Remove it, run, observe **exit 0**. The report shows both runs.

16. The guard reports the new class distinctly. An `<x>-sme` whose `<x>` names
    no project at all (`kemuni-sme`) and one whose `<x>` names a real project
    but no declared agent (`todero-sme`) are both violations, with messages
    that say which is which.

### D. Nothing else moves

17. `node scripts/acceptance/run.mjs` is still **45/45**. (Baseline measured:
    45/45, 5.5s.)

18. `npm test` shows no NEW failures beyond the known pre-existing five
    (`agents-route`, `agents-unconfigured`, `spawn-live`). Baseline measured:
    918 passed / 5 failed / 2 skipped / 925 total. The report gives the after
    counts.

19. `npx tsc --noEmit` is clean. (`npm run build` is never run — the dev server
    is live and must not be disturbed.)

20. The 10-probe live scope guard in `scripts/no-unscoped-issues.mjs` stays
    green, and no probe of it is deleted, relaxed, or exempted.

21. No git command is run by this piece. The orchestrator stages and commits.

## Non-goals, stated so a later reader does not mistake them for misses

- The `/api/issues` vs `/api/db/issues` disagreement is NOT resolved here.
- `middleware.ts` (#1) and `app/api/activity-feed/route.ts` (#4) are not
  touched. What unifying all six would require is reported in prose only.
- The two wire-level conflict codes (`scope_conflict` and `scope_mismatch`)
  are preserved rather than merged. Merging them is visible to clients and is
  a decision for the owner, not a refactor.
