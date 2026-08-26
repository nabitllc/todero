# dead-code-sweep — piece specification and result

Wave 6. Builder-owned. Written before the first deletion, completed after.

## Why this piece exists at all

`HANDOFF.md` records that a hardcoded four-project emoji table survived **three**
sweeps whose stated job was removing exactly it. The reason is worth stating
plainly, because it generalises:

> A sweep asks "what breaks if this goes?" Dead code correctly answers
> "nothing". So the sweep moves on, and the dead code survives — not despite
> being unreferenced, but **because** of it.

Dead code is therefore the **hard** case for a sweep, not the easy one. The
usual safety instinct (don't delete what you can't prove is safe) inverts into
a preservation instinct (never delete anything, because nothing ever proves
itself unsafe to keep).

This piece inverts the question. Not "what breaks if this goes?" but
**"prove nothing can reach this."** Deleting is the easy half. Proving
unreachable is the job.

The specific cost this time: `lib/issue-type-config.ts` declares a
`test_status` field at `:82`, a column that does not exist on `issues`. A
phantom field in a file nothing reads is the emoji table's exact shape — inert
until somebody wires it up, then a 500.

## ACCEPTANCE

1. **Every deletion is proved unreachable before it is made**, by a method
   written down in this document, not by a relayed claim. Relayed findings in
   this rebuild have been wrong five times in one night; every claim in the
   incoming brief is treated as a hypothesis to test.
2. **The proof covers the five ways a file can be reachable without a literal
   static import**: a path-alias import (`@/…`), a dynamic `import()` or
   `require()`, a string-keyed loader (`importTs('lib/x.ts')`), a Next.js
   filesystem convention (`page.tsx` / `route.ts` / `layout.tsx` /
   `middleware.ts`), and a test file. A file reachable by any of these is NOT
   dead and is NOT deleted.
3. **A file that turns out to be reachable is reported and kept.** A wrong
   deletion costs more than a surviving dead file.
4. **Type-only reachability is distinguished from value reachability.** An
   `import type` does not keep a runtime component alive. A module that exports
   only types and is imported only as types is legitimately alive.
5. **`npx tsc --noEmit` is clean after the deletions** — this is the primary
   machine proof that nothing referenced what was removed. `npm run build` is
   never run (it clobbers `.next` and takes the running dev server down).
6. **The existing gates stay green**: `node scripts/acceptance/run.mjs` at
   45/45, `bash scripts/smoke-test-layout.sh` passing,
   `node scripts/no-invented-projects.mjs` at exit 0, `npm test` with no new
   failures beyond the 5 known pre-existing ones (`agents-route`,
   `agents-unconfigured`, `spawn-live`).
7. **A guard exists so this cannot silently regrow**: `scripts/no-dead-modules.mjs`
   resolves the import graph from real entry points and fails on an unreachable
   module.
8. **The guard is proved to fail when it should**, not merely to pass when it
   should. `HANDOFF.md`: *"A guard whose comment describes enforcement it does
   not perform is worse than no guard, because it is trusted."* Both exit codes
   are recorded below, from real runs.
9. **The guard's allowlist carries a reason string per entry, and a stale entry
   is an ERROR, not silence.** An allowlist that quietly outlives its reason is
   the same defect as the dead code it excuses.
10. **The guard states in its own header what it does NOT cover.** A guard that
    overstates its reach is the trusted-but-wrong case again.
11. **`commerce_actions` is measured, not assumed** — every write site and every
    read site enumerated from source. The finding is reported plainly whichever
    way it falls. **No audit row and no column carrying one is deleted**: an
    audit trail nothing reads *yet* is a different thing from one that is wrong.
12. **The running app is walked after the deletions** — every destination and
    every view — and any broken surface is reported.
13. **Limiglow still ends at zero issues** (that is the correct state, not a
    defect), and no issue data is touched.

## Method — how "unreachable" was proved

Five independent instruments, because `HANDOFF.md` warns *"verify the
instrument before believing the verdict"* — the measuring apparatus was the
broken thing three times in this rebuild.

| # | Instrument | What it rules out |
|---|---|---|
| 1 | `grep` for the import specifier (`from '…/name'`) across `app components lib hooks scripts __tests__` | a literal static import, relative or aliased |
| 2 | `grep` for every **exported symbol** of each file, excluding the file itself | a re-export, a barrel, an aliased import |
| 3 | `grep` for `<ComponentName` JSX usage | a component rendered somewhere the import grep missed |
| 4 | `grep` for `import(`, `require(`, `next/dynamic`, and `importTs('…')` string literals | dynamic and string-keyed loading |
| 5 | `scripts/no-dead-modules.mjs` — a real import-graph walk from Next.js entry points, alias-aware, type-aware | everything above, systematically, and **dead clusters** (files that have an importer, but only a dead one) |

Instrument 5 is the one that catches what greps 1–4 cannot: a file whose only
importer is *itself dead*. `components/HubSwitcher.tsx` is exactly that shape —
its own header says it is "rendered in SidebarNav", and `SidebarNav` is dead
too. A grep for importers finds one and reports the file as live. A reachability
walk from entry points correctly reports the whole cluster as dead.

Barrel files were checked for and do not exist (`lib/index.ts`,
`components/index.ts`, `components/tabs/index.ts` — all absent), so an aliased
re-export cannot hide a reference.

## RESULT — the nine candidate files

Line counts are `wc -l`. "Refs" counts references **in source** (`app`,
`components`, `lib`, `hooks`, `scripts`), excluding the file's own body and
excluding build output (`.next*`, which contains stale compiled copies and is
not evidence of anything).

<!--RESULTS-->

## Hub rail — the decision-record question

<!--HUBRAIL-->

## commerce_actions — measured

<!--COMMERCE-->

## The guard

<!--GUARD-->

## What I could not do honestly

<!--CAVEATS-->
