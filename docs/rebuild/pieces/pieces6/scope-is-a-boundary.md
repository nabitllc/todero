# PIECE: Scope must be a query boundary, not a label

id: scope-is-a-boundary
lane: Operator

OWNS EXCLUSIVELY: app/page.tsx, components/nav/**, lib/db/browser.ts,
scripts/no-unscoped-issues.mjs (new), CLAUDE.md

DO NOT TOUCH: components/tabs/**, components/BusinessRail.tsx, components/HubRail.tsx,
components/HubSwitcher.tsx, components/ActivityFeed.tsx — another agent owns those
right now and will be editing them at the same time as you.

## Why this piece matters

A fresh-context critic named this the single biggest gap, and it is right:

  "Scope is a label, not a query boundary. Todero's scope is an optional React prop
  passed to ten of roughly twenty-three read paths, ignored by two of those ten,
  absent from eleven raw-proxy queries. Everything currently LOOKS correct only
  because migration 057 archived the other projects out of /api/issues. Un-archive
  one issue and the landing page fills with the mess again."

That last sentence is the test. Correctness that depends on the data happening to be
empty is not correctness.

A sentence claiming full scoping was already DELETED from app/page.tsx today for
being false — it read "Every panel below is scoped to X only". It goes back only when
this piece makes it true.

## Build instruction

1. Project belongs in the PATH, not a query string. A query param is a hint; a path
   segment is a boundary. Make it structurally impossible to render a destination
   without a scope.
2. ONE scope source. Replace the projectFilter prop-drill with a single context. A tab
   should not be able to receive the wrong scope, because it should not receive scope
   as an argument at all.
3. Make the seam enforce it. dbUrl() in lib/db/browser.ts should REQUIRE an explicit
   scope, so a call site that forgets does not compile. Inject the project clause and
   the archived clause there, once, rather than at twenty-three call sites. A filter
   spread across call sites is a filter the next call site forgets, and the failure is
   silent.
4. A GUARD, not a comment. Add scripts/no-unscoped-issues.mjs modelled on the existing
   scripts/no-silent-empty.mjs — same shape, same allowlist mechanism — failing on any
   issues-query literal under app/ or components/ that lacks both clauses. Wire it into
   the smoke test. From the vault: "A guard written in the prompt is not a guard." This
   is the only version of the fix that survives the next agent.
   One warning from this project's own history: a checker that greps for a bad pattern
   necessarily CONTAINS that pattern and will report its own source as a defect. Skip
   your own file.
5. The DEFAULT state must have a scope. Today the app cold-loads with no business
   selected, so page.tsx bails before deriving a project and every panel goes global.
   With one project in the table, select it.
6. Amend CLAUDE.md. Its Layout Integrity table still requires a hamburger and a mobile
   more-menu. Both were deliberately removed — six destinations fit the bar without
   them — and the sidebar now pairs at the lg breakpoint, not md, for a correct reason:
   an md sidebar against an lg-hidden phone nav shows BOTH between 768 and 1023px. An
   enforcement doc that contradicts the code will make the next agent "restore" a
   hamburger.
7. Work has too many views. design/Work.dc.html specifies FOUR — Board, List, Epics,
   Sprint. Eight pills is twenty tabs re-parented, not twenty becoming six. Group the
   rest under those four; nothing may become unreachable.

## ACCEPTANCE — verified against the RUNNING app

1. Un-archive one non-Limiglow issue, reload with Limiglow scoped, confirm it appears
   NOWHERE, then re-archive it. This is THE acceptance test — a pass that depends on
   the other projects being archived is not a pass.
2. `node scripts/no-unscoped-issues.mjs` exits 0, and exits NON-ZERO when you
   temporarily add an unscoped issues query. Prove BOTH directions with output.
3. A destination cannot be rendered without a scope — show the code path that makes
   this structural rather than conventional.
4. Cold-loading the app lands on a scoped view with the one project selected.
5. Work presents four views, and every previously-reachable view is still reachable
   inside one of them. Enumerate them.
6. CLAUDE.md's Layout Integrity table matches the code, with the reason recorded.
7. `npx tsc --noEmit` clean, `bash scripts/smoke-test-layout.sh` passes, and
   `node scripts/acceptance/run.mjs` still reports 45/45.
