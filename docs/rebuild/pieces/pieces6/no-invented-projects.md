# PIECE: No screen may invent a project

id: no-invented-projects
lane: Truth

OWNS EXCLUSIVELY: components/tabs/AutomationsTab.tsx, components/tabs/FeaturesTab.tsx,
components/tabs/OverviewTab.tsx, components/tabs/ChatTab.tsx, components/tabs/BoardTab.tsx,
components/BusinessRail.tsx, components/HubRail.tsx, components/HubSwitcher.tsx,
components/ActivityFeed.tsx

DO NOT TOUCH: app/page.tsx, components/nav/**, lib/db/browser.ts — another agent owns
those right now and will be editing them at the same time as you.

## Why this piece matters

Michael, verbatim: "Showing a large mess with things about Todero, Vespera, Kemuni
(when only single project selected 'Todero' was selected) showed a mess and if there
was no progress being made."

The landing-screen instance of this was fixed today. EIGHT MORE REMAIN, and fixing one
while seven others still render the same invented projects is not a fix. Verified
2026-08-25 in live code, not comments:

- AutomationsTab.tsx:48 — a five-name array rendered as FILTER PILLS. The operator can
  click a filter for a project that does not exist.
- FeaturesTab.tsx:15 — a PROJECTS constant, four invented names.
- OverviewTab.tsx:608 — PROGRESS_PROJECTS, four invented names.
- ChatTab.tsx:146-151 — per-project colours plus a PROJECT_CYCLE array.
- BoardTab.tsx:937-943 — a business map plus a bizOrder array of five names.
- BusinessRail.tsx:9, HubRail.tsx:10, HubSwitcher.tsx:13 — emoji maps keyed by the
  same invented names.

There is exactly ONE project: Limiglow. Everything else was archived to history.

## Build instruction

1. Projects come from GET /api/projects. That table is the only thing that knows which
   projects exist. A list of project names may not be written into a source file.
2. An emoji or colour map keyed by project name is the same defect wearing decoration.
   If a project needs an emoji it comes from the row, or there is one neutral default
   — not a hand-written table of five names.
3. ActivityFeed STILL SHOWS ARCHIVED ISSUES. The running app displays "TOD-1 CRITIC
   probe epic" on the Now screen, and that issue is archived. GET /api/issues already
   excludes archived rows by default; the feed is reaching the raw proxy instead. Fix
   it at the query, not by filtering the result.
4. Where the projects list has not loaded, render a loading state. Where it is
   genuinely empty, say so. NEVER fall back to a hardcoded list "so the UI has
   something to show" — that is how every one of these got here.
5. Deleting a filter pill row is an acceptable outcome if there is nothing real to
   filter by. An honest absence beats an invented control.

## ACCEPTANCE — verified against the RUNNING app

1. A grep for the invented project names across components/ returns matches ONLY
   inside comments explaining the removal. No live code.
   Note: your own explanatory comments WILL match that grep. Exclude comment lines
   when you check — two checks in this project have already graded their own comment
   as a defect, and it wasted a full round each time.
2. Every project name rendered anywhere traces to a row from /api/projects. Show the
   query for each surface you changed.
3. The Now screen's Recent Activity shows NO archived issue. Confirm by requesting the
   feed's own endpoint and reading the returned rows, not by looking at pixels.
4. With one project in the table, no filter pill, dropdown, cycle or swimlane offers
   any other project.
5. `npx tsc --noEmit` clean and `bash scripts/smoke-test-layout.sh` passes.
