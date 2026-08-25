# PIECE: Twenty tabs become six destinations, and selecting a project actually scopes

id: nav-six-destinations
lane: Operator
OWNS EXCLUSIVELY: app/page.tsx, components/nav/**, app/layout.tsx
Every other Wave 6 piece is forbidden from touching these files. You are the only
writer. In exchange, do not edit any tab component's internals — other agents own
those. Move them, re-parent them, wrap them; do not rewrite what is inside them.

## Why this piece matters

Michael, 2026-08-25, verbatim: *"Can you redistribute Todero UIUX before continuing
in the next waves? Looping until the UIUX shows the way you planned it to show."*

And earlier, on what is wrong today: *"The 1 project showing and selected should
only show info about Limiglow. Showing a large mess with things about Todero,
Vespera, Kemuni (when only single project selected 'Todero' was selected) showed a
mess and if there was no progress being made."*

The nav is an inherited list, not a structure. `app/page.tsx:51-70` is twenty
entries plus a divider, accumulated one at a time from the OpenClaw lineage. It has
never been designed; it has only ever been appended to.

## THE SPEC IS A FILE, NOT A DESCRIPTION

`design/Nav.dc.html` is the target information architecture, and it is
authoritative. Read it before writing anything. It names six destinations, what
each absorbs, and the question each answers:

  Now       home        "What needs me right now, and what is running?"
            absorbs Overview, Inbox, Activity, Notifications, Infra — the signal
  Work      7 tabs → 1  "What is the work, and where is it stuck?"
            absorbs Board, Issues, Features, Pipeline, Product Board, Epic Map,
            Projects, Calendar — due dates
  Fleet     3 tabs → 1  "Which agents exist, which are alive, what are they doing?"
            absorbs Agents, Crew / Team, Office
  Runs      new         "What did that agent actually do, and what did it cost?"
  Memory    1 → 1       "What has it learned, and what will it reuse?"
            absorbs Memory, Agent docs, Skills
  Settings  4 tabs → 1  "How is this wired, and what are its limits?"
            absorbs Settings, AI Services, Automations, Infra — the detail,
            Calendar — job timing
  Chat      overlay     opens over whatever you are looking at, ⌘J

Sibling artboards `design/Main.dc.html` (Now), `design/Work.dc.html`,
`design/Fleet.dc.html`, `design/Run.dc.html`, `design/Memory.dc.html` and
`design/Mobile.dc.html` are the spec for what each destination contains. Read the
one you are placing before you place it.

## Build instruction

1. **Six destinations plus a Chat overlay.** Nothing is deleted: every current view
   survives as a tab or filter inside its new home, so no existing URL becomes a
   dead end. Old paths redirect to their new home — a link someone saved must still
   land somewhere correct.

2. **Two tabs SPLIT rather than move**, and this is deliberate, not an oversight:
   Calendar (due dates go to Work, job timing goes to Settings) and Infra (the
   signal goes to Now, the detail goes to Settings).

3. **Runs does not exist yet.** It is the one genuinely new destination. If the
   data behind it is not there, render an honest empty state that says what will
   appear and why it is empty — never a placeholder that implies data.

4. **Selection must scope.** `app/page.tsx:642` passes
   `projectFilter={selectedBusiness}` — what every tab receives as its "project
   filter" is the BUSINESS. There is one business, so selecting it selects
   everything. Introduce a real `selectedProject`, distinct from
   `selectedBusiness`, living in the URL so a scoped view is linkable and survives
   a reload. Then pass THAT. Audit every tab it is handed to; assume each is wrong
   until checked.

5. **Chat is an overlay, not a destination.** ⌘J opens it over whatever is on
   screen, and it carries that screen as context. It does not navigate away.

6. **The layout invariants in CLAUDE.md still hold.** `hidden md:flex` on the
   desktop sidebar, `lg:hidden fixed bottom-0` on the mobile bottom nav,
   `md:hidden` on the hamburger, `lg:hidden fixed bottom-[56px]` on the mobile more
   menu. Six destinations is the number that finally fits a phone's bottom bar
   without a "more" menu — use that. Run `bash scripts/smoke-test-layout.sh` before
   you claim done; it exists because this layout has broken repeatedly.

## ACCEPTANCE — a critic with fresh context will verify against the RUNNING app

1. The primary nav has exactly six destinations plus Chat. Not seven, not five.
2. Every one of the twenty current tab ids still resolves — as a tab, a filter, or
   a redirect. Enumerate all twenty and show where each landed. A view that
   silently disappeared is a failure, not a simplification.
3. `grep -n "projectFilter={selectedBusiness}" app/page.tsx` returns nothing.
4. With Limiglow selected, no panel anywhere displays an issue whose project is not
   Limiglow. Verify by reading the NETWORK RESPONSES, not the rendered text — a
   panel that fetches everything and hides most of it still fails this.
5. Selecting a project changes the URL; pasting that URL into a fresh tab restores
   the same scoped view.
6. ⌘J opens Chat over the current screen without navigating; Escape closes it and
   the underlying screen is unchanged.
7. Limiglow has zero issues and that is intended. Every destination renders an
   empty state that NAMES Limiglow and reads as "nothing here yet", never as a
   blank panel that reads as breakage.
8. `bash scripts/smoke-test-layout.sh` passes, and on a 375px viewport all six
   destinations are reachable from the bottom bar.
