# PIECE: The invented agents leave the registry, and a guard keeps them out

id: no-invented-projects-sweep
lane: Truth
sibling: `no-invented-projects.md` — that piece owns the *screens*. This piece owns
the *registries and queue rules those screens read from*, plus the guard.

OWNS EXCLUSIVELY:
`lib/agent-capabilities.ts`, `lib/agent-queue.ts`, `lib/constants.ts`,
`lib/mc-constants.ts`, `lib/agents-config.ts`, `lib/agent-roster.ts`,
`lib/issue-type-config.ts`, `scripts/no-invented-projects.mjs` (new),
this file (new).

DO NOT TOUCH: `app/api/**`, `app/page.tsx`, `components/**`, `lib/bolt-time.ts`,
`migrations/**`, `scripts/check-no-secrets.js`, `scripts/no-unscoped-issues.mjs` —
other agents are writing those right now.

## Why this piece matters

`docs/rebuild/FEEDBACK.md` ("Earlier, still open") records the invented projects as
two files. Re-measured 2026-08-26 it is **24 source files**, and it reaches the MC
API itself. `docs/rebuild/HANDOFF.md` separately records that a hardcoded emoji
table *already survived two rounds* of a sweep whose entire job was removing exactly
that kind of table. So this piece assumes that reading a file is not enough — every
claim below is a grep or a command, and the guard is required to be shown failing
before it is trusted.

Two agents do not exist on any host: `kemuni-sme`, `vespera-sme`. Two projects do
not exist: `Kemuni`, `Vespera`. The one real managed project is **Limiglow**.
`AGENTS.md` on this host still lists both invented agents, which is why the roster
loader alone cannot be the fix — the *code-side* registries are what this piece
removes.

Dispatch is guarded off (`lib/dispatch-guard.ts`, `TODERO_DISPATCH_ENABLED`), so
none of these lanes has ever run. That is luck, not design: `lib/agent-queue.ts`
carries prompt text instructing an agent to `POST /api/issues` with
`project:Kemuni`. The kill switch is the only thing between that text and rows in
the database, and this piece **does not touch, relax, or route around it**.

## What is a defect and what is not

A **tombstone comment** — a comment that records what was deleted and why —
is correct and must survive. `lib/mc-constants.ts:4`, `:29`, `:64`, `:73`, `:76`,
`:82`, `app/page.tsx:56` and `lib/agents-config.ts`'s header are all tombstones.
Deleting the record of a deletion is how the same fabrication gets reinvented, and
this repo has already graded its own explanatory comments as defects twice, wasting
a round each time. Every removal in this piece **adds** a tombstone; it removes none.

`scripts/acceptance/checks.mjs:141` and `scripts/acceptance/checks-anywhere.mjs:136`
use `/Users/kemuniagent` as a **mac-path detector pattern**. That is the string the
check is hunting for. It is correct. Not a defect.

## Build instruction

1. Remove `kemuni-sme` and `vespera-sme` from every registry, capability map, emoji
   table, display map and queue lane in the owned files. Removing a member of the
   `AgentId` union has callers — `npx tsc --noEmit` must stay clean.
2. Remove the `Kemuni`/`Vespera` routing rules and the prompt prefixes that instruct
   an agent to file issues under those projects.
3. Decide honestly whether removing `VES`/`KEM` from `PROJECT_PREFIX` breaks
   **reading** historical rows that still carry those keys. Write the answer down;
   do not silently break historical data.
4. Write `scripts/no-invented-projects.mjs`. It must derive "which projects are
   real" from **one existing named constant**, not from a second hardcoded list, and
   its own header must state exactly what it does and does not cover.
5. Prove the guard fails when it should: reintroduce a reference, show a non-zero
   exit, remove it, show a zero exit. Both runs go in the report.
6. Do not delete a test to make anything pass.

## ACCEPTANCE

Each item is a command or a grep with a stated expected result.

1. **The two agent ids are gone from live code in every owned file.**
   `grep -n -i "kemuni\|vespera" lib/agent-capabilities.ts lib/agent-queue.ts
   lib/constants.ts lib/mc-constants.ts lib/agents-config.ts lib/agent-roster.ts
   lib/issue-type-config.ts` returns **only comment lines**. Every surviving match
   must begin (after leading whitespace) with `//`, `/*` or `*`.

2. **`AgentId` no longer admits them.** `lib/agent-capabilities.ts`'s exported
   `AgentId` union contains neither `'kemuni-sme'` nor `'vespera-sme'`, and
   `AGENT_REGISTRY` has no key for either. A grep for `kemuni-sme` outside comments
   in that file returns nothing.

3. **No queue lane can file an issue under an invented project.**
   `grep -n "project:Kemuni\|project:Vespera\|project=eq.Kemuni\|project=eq.Vespera"
   lib/agent-queue.ts` returns nothing. `AGENT_QUEUE_CONFIGS` has no `'kemuni-sme'`
   or `'vespera-sme'` key.

4. **The emoji/display tables are clean.** `AGENT_EMOJI` and `AGENT_DISPLAY` in
   `lib/mc-constants.ts`, `AGENT_MAP` in `lib/agents-config.ts`, and `AGENT_META` in
   `lib/agent-roster.ts` each have no key for either invented agent. (This is the
   table shape `HANDOFF.md` records as having survived two sweeps; it is checked by
   name, not by eye.)

5. **The picker cannot offer an invented project or assignee.** In
   `lib/issue-type-config.ts`, the `project` field's `options` array contains no
   `Kemuni` or `Vespera`, and the `assignee`/`owner` `options` arrays contain no
   `kemuni-sme` or `vespera-sme`.

6. **`PROJECT_PREFIX` / `PROJECT_ALIASES` no longer map the invented names**, and
   the removal is accompanied by a written finding, in the piece report, stating
   whether reading historical `VES-*` / `KEM-*` rows is affected and by what
   mechanism. A claim of "no impact" with no mechanism named does not satisfy this
   item.

7. **Every tombstone comment listed above still exists.**
   `grep -c "KEMUNI_START\|LIVE_FEED\|ALL_AGENTS\|DEFAULT_SPRINT_PROJECTS\|ACTIVITIES"
   lib/mc-constants.ts` is unchanged from before the piece (5), and each removal made
   by this piece added a new tombstone naming what went and why.

8. **The guard exists and derives its truth from one named constant.**
   `scripts/no-invented-projects.mjs` reads the canonical project set from
   `PROJECT_PREFIX` in `lib/constants.ts` by parsing that one declaration. It
   contains no second literal list of project names. If it cannot parse that
   declaration it **exits non-zero with an error**, never silently passes.

9. **The guard's header states its own coverage boundary.** The file's opening
   comment names, explicitly, which directories it scans, which it skips, that
   comments are stripped before scanning (so tombstones are allowed), that
   `__tests__/` fixtures are allowed, and which reference shapes it cannot see.

10. **The guard is proven to fail when it should.** The report shows two runs of
    `node scripts/no-invented-projects.mjs`: one with a reference deliberately
    reintroduced into a live (non-comment) line, exiting non-zero and naming the
    file, line and token; and one after removal, exiting zero. A guard that has only
    ever been seen passing does not satisfy this item.

11. **The guard is proven to allow what it must allow.** In the same passing run,
    tombstone comments naming `Kemuni`/`Vespera` are present in the scanned files
    and are not reported.

12. **`npx tsc --noEmit` exits clean**, with no error mentioning `AgentId`,
    `AGENT_REGISTRY`, `AGENT_QUEUE_CONFIGS` or `PROJECT_PREFIX`.

13. **`node scripts/acceptance/run.mjs` still reports 45/45.** A lower number, or a
    run noticeably slower than ~4s, is reported as such rather than rounded up.

14. **`npx jest` shows no new failures.** The 5 known pre-existing failures
    (`agents-route`, `agents-unconfigured`, `spawn-live`) may remain; any additional
    failure is either fixed or reported with its cause. No test file is deleted, and
    no assertion is removed to make a check pass. If an assertion is *inverted* to
    lock in this piece's fix, the report names the file, the old assertion and the
    new one.

15. **The dispatch kill switch is untouched.** `git diff` (read by the orchestrator,
    not run by this piece) shows no change to `lib/dispatch-guard.ts`, and
    `grep -rn "TODERO_DISPATCH_ENABLED" lib/` still returns the guard.

16. **Every remaining reference outside the owned files is reported, with
    `file:line`** — including the ones this piece is forbidden to touch
    (`app/api/issues/route.ts`, `app/api/agent-config/route.ts`,
    `app/api/queue-refill/route.ts`, `app/api/activity-feed/route.ts`,
    `components/**`, `data/**`, `AGENTS.md`). A sweep that cleans its own files and
    stays quiet about the rest fails this item.
