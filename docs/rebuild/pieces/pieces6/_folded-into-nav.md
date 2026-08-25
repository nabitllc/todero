# PIECE: Selecting a project must actually scope the product to that project

id: project-scoping
lane: Operator

## Why this piece matters

Michael, 2026-08-25, verbatim: *"The 1 project showing and selected should only show
info about Limiglow. Showing a large mess with things about Todero, Vespera, Kemuni
(when only single project selected 'Todero' was selected) showed a mess and if there
was no progress being made."*

He is right, and the cause is three separate defects that compound:

**1. The selector is not a project selector.** `app/page.tsx:642` passes
`projectFilter={selectedBusiness}` — the thing every tab receives as its "project
filter" is the BUSINESS. There is exactly one business (Todero), so selecting it
selects everything. `selectedBusiness` is declared at :278 and threaded through
BusinessRail, HubSwitcher and every tab. There is no `selectedProject` anywhere.

**2. The Overview ignores the filter it is given.** `OverviewTab` accepts
`projectFilter` at :699/:716 and uses it exactly ONCE, at :1095, for
`<ActivityFeed>`. Every other panel — sprint cards, Risk Radar, Needs Your
Attention, Project Progress — ignores it entirely and queries unscoped.

**3. The VESPERA and KEMUNI sprint cards are not data.** They come from
`KEMUNI_DEADLINE, KEMUNI_START, VESPERA_DEADLINE, VESPERA_START` imported from
`lib/mc-constants` (OverviewTab.tsx:4). They are hardcoded constants rendering
"0 days left · 100% elapsed" against dates in March and April 2026. No filter could
ever remove them, because they were never queried. This is the same fabrication
class Wave 3 removed from the automations tab — and it was missed.

The combined effect is what the owner described: the most prominent thing on the
landing screen is two dead sprints for projects he did not select, which makes a
working system look like a stalled one.

## Build instruction

1. Introduce a real `selectedProject`, distinct from `selectedBusiness`. It belongs
   in the URL so a scoped view is linkable, and it persists across reloads.
2. Every panel on the Overview honours it — sprint, Risk Radar, Needs Your
   Attention, Project Progress, Activity. Scope in the query, not by filtering an
   unscoped result client-side: a panel that fetches everything and hides most of
   it is still fetching everything, and its counts will be wrong.
3. Delete the hardcoded sprint constants. A sprint card renders from a real sprint
   row for the selected project, or it does not render. If a project has no active
   sprint, say that plainly — do not show a dead countdown.
4. When one project is selected and it has no data yet, the empty state must say
   *which project* is empty and that this is expected — not render blank panels that
   read as breakage. Limiglow will legitimately have zero issues for a while.
5. Audit the other tabs for the same `projectFilter={selectedBusiness}` mistake.
   `app/page.tsx` passes it to roughly a dozen tabs; assume every one is wrong until
   checked.

## ACCEPTANCE — a critic will verify against the RUNNING app
1. `grep -n "projectFilter={selectedBusiness}" app/page.tsx` -> 0 matches.
2. `grep -rn "KEMUNI_DEADLINE\|VESPERA_DEADLINE\|KEMUNI_START\|VESPERA_START" components/ lib/` -> 0 matches.
3. With Limiglow selected, the Overview shows NO Vespera or Kemuni card, and no
   panel displays an issue whose project is not Limiglow. Verify by reading the
   network responses, not the rendered text — a panel that fetches everything and
   hides it still fails this.
4. With Limiglow selected and zero issues in it, every panel renders an empty state
   naming Limiglow. No panel is blank and none shows a count from another project.
5. Switching the selection changes the URL, and pasting that URL into a new tab
   restores the same scoped view.
6. Every sprint card on screen corresponds to a row in the sprints table for the
   selected project. No card is rendered from a constant.
