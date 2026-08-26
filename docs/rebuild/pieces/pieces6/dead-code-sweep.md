# dead-code-sweep — piece specification and result

Wave 6. Builder-owned. The ACCEPTANCE list was written before the first
deletion; the results were filled in after.

## Why this piece exists at all

`HANDOFF.md` records that a hardcoded four-project emoji table survived **three**
sweeps whose stated job was removing exactly it. The reason is worth stating
plainly, because it generalises:

> A sweep asks "what breaks if this goes?" Dead code correctly answers
> "nothing". So the sweep moves on, and the dead code survives — not despite
> being unreferenced, but **because** of it.

Dead code is therefore the **hard** case for a sweep, not the easy one. The
usual safety instinct (never delete what you cannot prove is safe) inverts into
a preservation instinct (never delete anything, because nothing ever proves
itself unsafe to keep).

This piece inverts the question. Not "what breaks if this goes?" but
**"prove nothing can reach this."** Deleting is the easy half. Proving
unreachable is the job.

The specific cost this time: `lib/issue-type-config.ts` declared a
`test_status` field at `:82`, a column that does not exist on `issues`. A
phantom field in a file nothing reads is the emoji table's exact shape — inert
until somebody wires it up, then an HTTP 500.

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
5. **`npx tsc --noEmit` is clean after the deletions** — the primary machine
   proof that nothing referenced what was removed. `npm run build` is never run
   (it clobbers `.next` and takes the running dev server down).
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
broken thing three times in this rebuild, and it was the broken thing twice
more here.

| # | Instrument | What it rules out |
|---|---|---|
| 1 | `grep` for the import specifier (`from '…/name'`) across `app components lib hooks scripts __tests__` | a literal static import, relative or aliased |
| 2 | `grep` for every **exported symbol** of each file, excluding the file itself | a re-export, a barrel, an aliased import |
| 3 | `grep` for `<ComponentName` JSX usage | a component rendered somewhere the import grep missed |
| 4 | `grep` for `import(`, `require(`, `next/dynamic`, and `importTs('…')` string literals | dynamic and string-keyed loading |
| 5 | `scripts/no-dead-modules.mjs` — a real import-graph walk from Next.js entry points, alias-aware, type-aware | everything above, systematically, and **dead clusters** (files that have an importer, but only a dead one) |

Instrument 5 catches what greps 1–4 cannot: a file whose only importer is
*itself dead*. `components/HubSwitcher.tsx` is exactly that shape — its own
header says it is "rendered in SidebarNav", and `SidebarNav` is dead too. A
grep for importers finds one and reports the file as live. A reachability walk
from entry points correctly reports the whole cluster as dead.

Barrel files were checked for and do not exist (`lib/index.ts`,
`components/index.ts`, `components/tabs/index.ts` — all absent), so an aliased
re-export cannot hide a reference. Build output (`.next`, `.next-ac3`,
`.next-critic`) was excluded from every grep: it contains stale compiled copies
of deleted code and is evidence of nothing.

## RESULT — the nine candidate files

Line counts are `wc -l`.

| # | File | Lines | Evidence it was unreachable | Deleted |
|---|---|---:|---|---|
| 1 | `lib/agent-memory.ts` | 67 | Zero import specifiers. Its three exports (`rememberFact`, `recallFact`, `recallAll`) appear **nowhere** in source outside the file. Not reached by the graph walk. The incoming claim that the *string* appears nowhere in the repo is **FALSE** — `migrations/062_agent_memory_kv.sql:19` names `lib/agent-memory` in a comment, and `app/api/agent-memory/` is a live API route with a similar name but no import of this module. A comment and a same-named route directory are not reachability. | YES |
| 2 | `lib/inbox.ts` | 104 | Zero import specifiers. `requestApproval` appears only in the comment at `app/api/inbox/route.ts:21` saying it has zero callers — claim CONFIRMED. Its `InboxEntry` and `ApprovalStatus` types are **independently redefined** in `components/tabs/ApprovalCard.tsx:55` and `lib/approvals.ts:32`, so nothing depended on this file's copies. The 60+ `.from('inbox')` hits across the app are the **database table**, not this module. | YES |
| 3 | `lib/issue-type-config.ts` | 261 | Zero import specifiers. All seven exports appear nowhere else. Referenced only from a comment in `scripts/no-invented-projects.mjs`. **Phantom field CONFIRMED**: `test_status` declared at `:82` with `options: ['passed','failed','skipped']`. TOD-2445 had already swept the live write sites (`lib/issue-routing.ts:65`, `lib/pipeline-stages.ts:11`, `app/api/issues/route.ts:2050` all now carry tombstones saying it is not a column); this dead file was the leftover declaration that sweep did not reach. | YES |
| 4 | `components/ActiveAgentsCard.tsx` | 318 | Zero import specifiers, zero `<ActiveAgentsCard` JSX usage anywhere, not reached by the graph walk. No barrel file exists that could re-export it. | YES |
| 5 | `components/SidebarNav.tsx` | 315 | Zero imports, zero JSX usage. Superseded by design: `app/page.tsx:789` says PrimaryNav "replaces the old flat 20-item SidebarNav", and `components/nav/PrimaryNav.tsx:4` repeats it. Its only mentions are those two comments plus `app/api/inbox/route.ts:348`. **Silent-swallow CONFIRMED** at `:152-160` (the claim said 155-160): `fetchInboxCount` wraps `if (res.ok) {…}` with no `else`, inside `catch { /* non-blocking */ }`, so a non-ok response silently leaves a stale count — the exact pattern `scripts/no-silent-empty.mjs` exists to kill. | YES |
| 6 | `components/FeatureRequestModal.tsx` | 199 | Zero imports, zero JSX usage, not reached by the graph walk. | YES |
| 7 | `components/tabs/AgentConfigPanel.tsx` | 131 | Zero imports, zero JSX usage, not reached by the graph walk. | YES |
| 8 | `components/HubSwitcher.tsx` | 110 | Zero imports, zero JSX usage. **Dead-cluster member**: its own header says it is "rendered in SidebarNav" and "in the More menu (TOD-1197)" — SidebarNav is dead (row 5) and CLAUDE.md records the More menu as deliberately removed at TOD-2381. A plain importer-grep would be fooled here; the reachability walk is what proves it. | YES |
| 9 | `components/HubRail.tsx` | 68 | Zero imports, zero JSX usage. Same pre-TOD-2381 nav cluster. Mentioned only in the `app/page.tsx:63` comment recording the emoji-table sweep. | YES |
| | **TOTAL** | **1573** | | **9 deleted** |

**On the line count.** The brief said 1,579 (432 lib + 1,147 components).
Measured `wc -l` gives **1,573** — lib is exactly 432 as claimed, but each of
the six `.tsx` files measures one line fewer than claimed (1,141, not 1,147).
The discrepancy is a final-newline counting convention, not a different set of
files. Reporting what the tool actually printed.

### Machine proof after deletion

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0**, no output — nothing in the tree referenced any deleted module |
| `node scripts/acceptance/run.mjs` | **45/45 passing** (5.3s), harness score 10/10 |
| `bash scripts/smoke-test-layout.sh` | **exit 0** — sidebar found, `lg:hidden` mobile nav (1 instance), honest-error guard, scope guard (10 live probes) |
| `node scripts/no-invented-projects.mjs` | **exit 0**, 253 files scanned — *then exit 1 on a re-run, for a reason that is not this piece's. See below.* |
| `npm test` | 950 passed, **5 failed — exactly the known pre-existing set** (`agents-route`, `agents-unconfigured`, `spawn-live`). No new failure. |
| `node scripts/no-dead-modules.mjs` | **exit 0** |

### `no-invented-projects` went 0 → 1 mid-session, and it was not this piece

Reported rather than quietly re-run until green, because a builder explaining
away a red gate is exactly how a real defect gets shipped.

Immediately after the deletions, `node scripts/no-invented-projects.mjs` exited
**0**. On the final gate run it exited **1**, reporting 6 findings — all of them
`todero-sme` / `infra-sme` agent ids in `app/api/issues/route.ts` at
`:45, :97, :596, :1279, :1280`.

It is not this piece's doing, and the evidence is in the timestamps:

| File | mtime | Touched by this piece? |
|---|---|---|
| `scripts/no-invented-projects.mjs` | **01:55** | **no** — `scripts/*` except my own new one is DO-NOT-TOUCH |
| `app/api/issues/route.ts` | **01:35** | **no** — `app/api/issues/**` is DO-NOT-TOUCH |

My passing run was before 01:55; the failing run was after. **The guard itself
was rewritten mid-session by another agent** — the two runs do not even print
the same diagnostics: the failing run emits a line the passing run never did,
`declared agents = 14 roster row(s) -> 20 accepted id(s) from AGENTS.md`, i.e. a
new AGENTS.md roster check that did not previously exist. The new failure
message says so itself: *"Its 'todero' DOES name a real project, which is why
**the old project-prefix check passed it**."*

So this is a **pre-existing condition newly detected by a strengthened guard**,
in a file this piece does not own, found by a guard this piece does not own.
None of the six references has any relationship to a deleted module. **Flagged,
not fixed, and not worked around.**

### Two files the graph flagged that I did NOT delete

* **`components/tabs/AgentsTab.tsx`** — genuinely unrendered
  (`components/tabs/CrewTab.tsx:32` states CrewTab was its only caller), BUT it
  is still the declaration site of the `RosterMeta` type, imported as a type by
  `app/page.tsx:21`, `components/tabs/CrewTab.tsx:56` and
  `hooks/useAgentRoster.ts:20`. Deleting it breaks three live importers. The
  fix is to move `RosterMeta` to a types module and *then* delete the
  component — a separate piece, and `components/tabs/*` is outside this
  piece's ownership. Allowlisted with that reason.
* **`lib/db/pg-sql.ts`** — flagged DEAD by the first version of my own guard,
  and **that was the guard being wrong, not the file**. See "The guard" below.
  It is live, imported at `lib/db/pg-adapter.ts:51`. Not deleted.

### Walked the running app after deletion

All **21 views across all 6 destinations** loaded and rendered: Now
(Overview / Inbox / Activity / Signal / Conversations), Work
(Board / List / Epics / Bolt board / Commerce), Fleet (Roster / Office / Roles),
Runs, Memory, Settings (Settings / AI Services / Automations / Infra /
Job timing / Projects). The hub rail, top bar and nav are intact
(`app/page.tsx` untouched). **No surface broke.**

Residual console noise, attributed rather than waved away: a `400` on
`/api/hub-settings?business_id=` with an empty parameter — the existing "no hub
selected" state, which the UI renders honestly as *"No hub selected"* — plus
static-asset `404`s. Every `/api/*` call on a fresh page load returned `200`.
None of it involves a deleted module, which is structurally guaranteed:
nothing imported any of them.

## Hub rail — the decision-record question

**Conclusion: deleting `HubRail.tsx` and `HubSwitcher.tsx` does NOT contradict
FEEDBACK item 7, because they are not the hub rail the decision is about.**

FEEDBACK item 7 and `HANDOFF.md` say the same thing, unambiguously:

> "The 14px rail is the HUB switcher, and it stays permanently. It does not
> move into Settings."
> Status: LANDED (round 4) — and it **supersedes** item 2.

The decision is about a rail that **stays**. So the question is not "is the
rail wanted?" (it is) but **"which file is that rail?"**

It is `components/BusinessRail.tsx`, and that file proves it in its own header —
it carries Michael's item-7 quotation verbatim and then says:

> "So this rail is the HUB switcher — Slack's workspace rail — and it stays
> here permanently; it does not move into Settings."

It is mounted and live at `app/page.tsx:786`, and the layout contract at
`app/page.tsx:3` lists `<BusinessRail />` as `w-14, always visible`. I confirmed
it renders on every destination during the app walk.

`HubRail.tsx` (TOD-723) and `HubSwitcher.tsx` (TOD-1035 / TOD-1197) are its
**superseded predecessors**, from the pre-TOD-2381 nav:

* `HubSwitcher`'s header says it is "rendered in SidebarNav" and "in the More
  menu (TOD-1197)". `SidebarNav` is dead (deleted here), and CLAUDE.md records
  the More menu as deliberately removed at TOD-2381: *"restoring one is a
  regression, not a fix."* Both of its mount points are gone.
* Both read `/api/businesses` and would show **"T" for the business "Todero"** —
  precisely the thing item 2 flagged as looking wrong. `BusinessRail`
  deliberately reads `/api/projects` instead so the rail shows **"L" for
  Limiglow**, and documents that choice at length.

So the two deleted files are the *older, wrong* rendering of the rail, kept
alive by nothing. The decision record's "the rail stays" is satisfied by
`BusinessRail`, which I did not touch. **Deleting the predecessors removes no
hub rail from the product** — verified by walking every destination after
deletion and seeing the rail still there.

This was the one case in the brief where a wrong deletion was plausible, and it
is worth naming why it was not: *the decision record protects a **capability**,
not a **filename**.* Checking that the capability still has a live
implementation is the test — not whether some file's name matches the
decision's noun.

## commerce_actions — measured

**Verdict: the claim is essentially CORRECT, its enumeration was slightly off,
and there was one more defect inside it than reported.**

Every write and every read, enumerated from source:

| Site | `action` | `object_type` | `object_ref` | Readable today? |
|---|---|---|---|---|
| `inventory/route.ts:~245` | `inventory.adjust` | `inventory` | SKU | **yes** |
| `orders/route.ts:403` | `inventory.adjust` | `inventory` | SKU | **yes** |
| `products/route.ts:220` | `product.create` | `product` | **SKU** | was **no** → **now yes** |
| `products/route.ts:346` | `product.update` | `product` | **SKU** | was **no** → **now yes** |
| `orders/route.ts:338` | `order.fulfilment` | `order` | order number | **no — write-only** |

Read sites: exactly **one**, `inventory/route.ts:94`, reachable only via
`?history=<sku>`.

Two corrections to the incoming claim:

1. **There are five write sites, not four.** The brief missed
   `orders/route.ts:403`, which writes an `inventory` row when a fulfilment
   moves stock. That one was always readable, so the conclusion is unaffected —
   but the count was wrong.
2. **The `product` rows are keyed by SKU, not by a product id.** The brief
   lumped "order and product" together as unreachable. Orders genuinely cannot
   be reached by a SKU-keyed read. But **product rows share the exact
   `object_ref` the history read already queries** — they were excluded only by
   the hardcoded `object_type = 'inventory'` clause. So the question *"what
   happened to this SKU?"* was answering with half its own trail: every price
   change, every status change, and the SKU's own creation were written and then
   hidden from the only endpoint that reads the table.

**What I changed** (in `app/api/commerce/inventory/route.ts`, the one read I
own): the clause is now `.in('object_type', ['inventory', 'product'])`, and
`object_type` is returned in the response so a caller can still tell a stock
movement from a catalogue edit. Rows and columns are untouched.

**Proof it changes behaviour**, with the counterfactual `HANDOFF.md` asks for.
`commerce_actions` was empty (0 rows), so I inserted three probe rows,
measured, and deleted exactly those three (table verified back to 0):

```
live GET ?history=ZZ-PROBE-SKU  -> total: 2
  inventory | inventory.adjust | 8
  product   | product.create   | active @ 9.99 USD

OLD clause (object_type = 'inventory')        returns: 1
NEW clause (object_type IN inventory,product) returns: 2
order rows in table: 1  -> readable by zero endpoints
```

**Said plainly, as required:** `order.fulfilment` audit rows **remain
write-only today.** They are keyed by order number, so no SKU-keyed read can
surface them, and `app/api/commerce/orders/**` is outside this piece's
ownership. They are written correctly and I deleted nothing — an audit trail
nothing reads *yet* is a different thing from one that is wrong. Making them
readable needs a history read on the orders route.

**Also true, and worth not overstating:** `?history=` still has **zero UI
callers** (`components/tabs/CommerceTab.tsx` is the only commerce UI and never
calls it). So the product rows are now *reachable by the API* but still not
*shown to anyone*. I fixed the seam I own; I am not claiming a user can see
this.

## The guard

`scripts/no-dead-modules.mjs`. Walks the import graph from real entry points and
fails on any `lib/**/*.ts` or `components/**/*.tsx` nothing can reach.

**Entry points** are the files loaded by convention rather than by import:
`app/**/{page,layout,template,route,loading,error,global-error,not-found,default}.{ts,tsx}`,
root `middleware.ts` / `instrumentation.ts`, every `__tests__/**/*.test.{ts,tsx}`,
and — importantly — every `importTs('lib/x.ts')` **string literal** in
`scripts/**`, which are real edges from plain `.mjs` scripts into TypeScript
that no import-statement scan can see (14 such call sites exist). 147 entry
points, 301 value-reachable modules.

**Value vs type.** The walk runs twice: once over value edges only, once over
all edges. A module reached *only* by `import type` is an error **if it exports
runtime values**; a module that exports only types and is imported only as types
passes. This rule does real work — it correctly clears `lib/vault-badge.ts` and
`lib/runtimes/types.ts` (interfaces only) while correctly flagging
`components/tabs/AgentsTab.tsx` (exports a React component nothing loads).

**Reachability, not importer-count.** It reports what no entry point can
*reach*, which catches dead **clusters** — a file whose only importer is itself
dead. `HubSwitcher` is exactly that shape, and a naive importer-grep would have
called it alive.

### Proven to fail when it should — real runs, both directions

| Direction | What was done | Exit |
|---|---|---|
| Clean tree | `node scripts/no-dead-modules.mjs` | **0** — `OK — 149 modules in scope, all reachable from 147 entry points (1 allowlisted)` |
| Dead file planted | added `components/ZZDeadCanary.tsx` | **1** — `unreachable — no entry point reaches it by any import edge` |
| Dead file removed again | deleted the canary | **0** |
| Stale allowlist — file gone | allowlisted `lib/agent-memory.ts` | **1** — `this file no longer exists — remove the allowlist entry` |
| Stale allowlist — file reachable | allowlisted `lib/db/pg-sql.ts` | **1** — `this file IS reachable now — remove the allowlist entry` |

The type-only rule was also observed firing live on `AgentsTab.tsx` before it
was allowlisted: *"reached ONLY by `import type` edges, but it exports runtime
values — nothing loads it."* Both stale-allowlist tests were run against a
temporary copy of the script so the committed guard was never left in a doctored
state; the copy was deleted.

### The guard was wrong twice before it was right — and that is the finding

`HANDOFF.md`: *"Verify the instrument before believing the verdict. The
measuring apparatus was the broken thing three times."* It was the broken thing
twice more here, and **both bugs made live code look dead**:

1. **A lazy regex that spanned 12 KB.** The clause pattern
   `(import|export)\s+([\s\S]*?)\s+from\s*['"]…` started at an
   `export interface` and ran to a `from '${…}'` inside a SQL template literal,
   swallowing every real import in `lib/db/pg-adapter.ts`. Fix: restrict the
   import clause to characters a clause can actually contain, so it cannot
   cross `(`, `;`, `:`, a quote or a backtick.
2. **Regex comment-stripping that ate the imports.** Stripping `/*…*/` before
   `//…` meant the line comment `// … migrations/*.sql …` at
   `lib/db/pg-adapter.ts:16` opened a *phantom* block comment that consumed
   1026 characters — including that file's entire import block. Reversing the
   order only moves the bug (a `//` inside a block comment then breaks it).
   Fixed with a real character scanner tracking
   code / line-comment / block-comment / `'` / `"` / backtick state.

**Both bugs had the same visible symptom: `lib/db/pg-sql.ts` reported as
DEAD.** It is live, imported at `lib/db/pg-adapter.ts:51`. Had I trusted the
first green-looking run and deleted what it listed, I would have deleted a live
module in the database seam. The independent greps (instruments 1–4) are what
caught the disagreement. **This is the strongest argument in this piece for not
trusting a single instrument** — including one you wrote yourself five minutes
ago.

### What the guard does NOT cover

Stated in its own header, and repeated here: it is not a per-export check (a
live file full of dead functions passes); it is not a runtime proof (a module
behind a permanently-off flag counts as "reachable"); its parsing is regex over
a scanned source, not a TypeScript AST, and it deliberately errs toward calling
things alive; only `lib/**/*.ts` and `components/**/*.tsx` are in scope (dead
routes, hooks and scripts are not reported); a module reached only from a test
counts as reachable; `.d.ts`, `__tests__` and `*.generated.ts` are excluded;
and it cannot see reflection — an `eval`, a runtime-assembled path, or a bundler
glob would make it blind **without saying so**. None of those forms exist in
this repo today.

## What I could not do honestly

* **I could not prove the `?history=` fix against real data**, because
  `commerce_actions` has **zero real rows** — the commerce feature has never
  been used. I proved it with three synthetic probe rows I inserted and then
  deleted (table verified back to 0 rows). That is a proof about the *query*,
  not about production data.
* **`order.fulfilment` rows are still unreadable.** I fixed only the read I own.
  I did not make orders readable and I am not claiming otherwise.
* **`?history=` still has no UI caller**, so the newly-readable product rows are
  reachable by API but not visible to a user. Fixing that means UI work in
  `components/tabs/CommerceTab.tsx`, which this piece does not own.
* **`components/tabs/AgentsTab.tsx` is dead in the way that matters and I left
  it**, allowlisted with a reason. Deleting it needs `RosterMeta` moved first,
  and the file is outside this piece's ownership.
* **`app/page.tsx:63` and `app/api/inbox/route.ts:21,348` now contain comments
  naming files that no longer exist** (`HubRail`, `HubSwitcher`, `SidebarNav`,
  `lib/inbox.ts`). Those files are DO-NOT-TOUCH for this piece. `HANDOFF.md`
  records that tombstone comments naming deleted things are *correct and should
  stay*, so this may be fine as-is — but the `app/api/inbox/route.ts:21`
  comment now reads *"requestApproval() in lib/inbox.ts has zero callers"*
  about a file that is gone, which is stale rather than a tombstone. Flagging,
  not fixing.
* **`lib/issues.ts:51` still declares `test_status?: string`** on the issue
  type. That is the same phantom field deleted with `lib/issue-type-config.ts`,
  still present in a **live** file, and `components/tabs/BoardTab.tsx:1663-1667`
  renders it — meaning it renders a column that does not exist and is therefore
  always empty. `lib/*` outside my three files and `components/tabs/*` are
  DO-NOT-TOUCH. **Flagged, not fixed** — this is the emoji-table shape again,
  in live code.
* **`trash` is not available on this machine** (CLAUDE.md prefers `trash` over
  `rm`); I used `rm`. The files are recoverable from git history, and per
  instruction I ran **no git commands** — the orchestrator stages and commits.
* **`npm run build` was never run**, per the environment rules.
  `npx tsc --noEmit` is the type proof. This means
  `bash scripts/smoke-test-layout.sh` asserted against build output compiled
  *before* these deletions — but since no deleted file was ever imported, none
  of them could have been in that bundle anyway.
* **The 5 failing tests were not fixed.** They are the documented pre-existing
  set and outside this piece.
