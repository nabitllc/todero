# PIECE: Scope must reach the server, not stop at the React tree

id: scope-reaches-the-server
lane: Truth

OWNS EXCLUSIVELY: middleware.ts, app/api/db/[...path]/route.ts, app/api/issues/route.ts,
lib/db/query-params.ts, scripts/no-unscoped-issues.mjs

DO NOT TOUCH: components/**, app/page.tsx — the point of this piece is that those
files should NOT need editing. If you find yourself wanting to edit a component,
you are solving it in the wrong layer.

## Why this piece matters

Round 2 put the project in the URL path, added a context provider, a render gate,
and an `issuesUrl()` whose scope argument has no default. All of that is real, and
all of it is client-side furniture. A fresh critic then un-archived one issue and
watched it reappear across nine surfaces. Its conclusion, verbatim:

  "Scope stops at the React tree; it never reaches the server. The path segment,
  the context provider, the render gate and issuesUrl() are all client-side
  furniture standing in front of an /api/db/issues proxy and an /api/issues route
  that will hand any caller any project's rows — and twelve call sites do exactly
  that. That is why un-archiving one row refills the landing page."

It is right. The client-side guard also has six known holes: a trailing comment
satisfies the substring check, a table name in a variable evades it, a literal on
the next line evades it, `fetch('/api/db/issues?...')` bypasses `dbUrl` entirely,
`fetch('/api/issues?limit=0')` is out of its declared scope, and — worst — the
per-file pinned COUNT lets a debt file trade a fixed violation for a brand-new one
forever, net zero, still green.

Patching six regex holes is the wrong response. Close the hole they patrol.

## Build instruction

1. **The request carries the scope.** `middleware.ts` already rewrites every SPA
   path. Have it read the `/p/<slug>` segment and stamp the resolved project onto
   the request (a header is fine) so every downstream route can see it without
   trusting a client-supplied query param.
2. **The proxy injects the clause.** `app/api/db/[...path]/route.ts` adds
   `project=eq.<scoped>` and `archived_at=is.null` to every `issues` query,
   server-side. All eighteen currently-exempted call sites become correct without
   being edited — that is the test of whether this was done in the right layer.
3. **The route refuses rather than defaults.** `GET /api/issues` without a project
   should not silently mean "all projects". Decide the honest behaviour and
   implement it: either require the scope, or return all projects only when the
   caller explicitly asks (`?all_projects=1`). Whichever you choose, an omitted
   scope must never quietly widen the result.
4. **Do not break the legitimately cross-project surfaces.** Some reads are
   genuinely global by design — the projects list, agent-level Fleet and Runs
   aggregates, cross-project search if the owner wants it. Name each one you
   exempt and why, in the code. An exemption you can justify in one sentence is
   fine; one you cannot is a leak.
5. **Then shrink the guard.** With scoping enforced server-side,
   `PRE_EXISTING_DEBT` should go to zero or near it. Whatever the guard still
   claims to check, make its claims true: its comment currently describes
   enforcement it does not perform, which is the exact defect class this wave has
   been removing all day.

## ACCEPTANCE — verified against the RUNNING app

There is a dev server on http://localhost:3000. Do NOT restart it and do NOT run
`npm run build`. Authenticate with `cookie: mc-auth=kaos2026; mc-role=owner`.

1. THE TEST: un-archive TOD-1 (project "Todero"), then request EVERY issues read
   path the app uses while scoped to Limiglow, and show that none returns it.
   The critic's leak list, all of which must come back clean:
     /api/activity-feed, the five OverviewTab dbUrl reads, the sprint burndown
     (note: its `select` omits task_key, so check ids — an earlier grep missed the
     leak for exactly this reason), ActivityTab, ActiveAgentsCard, PipelineTab,
     EpicMapTab's /api/issues?limit=0, and ChatTab's /tasks.
   Then RESTORE it exactly: archived_at "2026-08-25 19:36:02", archived_reason
   "Pre-Limiglow history. Todero the tool is built against the Flight Board, not
   its own backlog." Verify the restore and show it.
2. Prove the clause is doing the work, not the archive: with TOD-1 un-archived,
   the same query WITHOUT a project scope must still return it.
3. `PRE_EXISTING_DEBT` is empty, or every remaining entry is justified in one
   sentence in the file.
4. Try to defeat your own guard the six ways listed above. Report which still
   work. Revert every probe and prove the tree is clean.
5. `npx tsc --noEmit` clean, `bash scripts/smoke-test-layout.sh` passes,
   `node scripts/acceptance/run.mjs` reports 45/45.
   Note: that suite takes about 4 seconds against a healthy server. If it takes
   minutes or reports mass failures, the SERVER is unhealthy, not the product —
   say so rather than reporting a regression.
