# PIECE: Cards, identity, and a page that fits one screen

id: cards-and-identity
lane: Operator

OWNS EXCLUSIVELY: app/page.tsx, app/layout.tsx, components/nav/**,
components/BusinessRail.tsx, components/tabs/OverviewTab.tsx

DO NOT TOUCH: middleware.ts, app/api/** — another agent is verifying those.

## Why this piece matters

This is the owner's own feedback on the running app, given today. It is recorded
verbatim in `docs/rebuild/FEEDBACK.md`; read that file first. The short form:

1. "In Claude, site should be responsive, I see it in tablet mode because it is
   not going to the full width."
2. "Left pane is meant to be for each project. Right now only 'Limiglow'. It
   should have either a logo or the first character of the project name, in this
   case the L."
3. "Tell me exactly where I should expect the name of the project being built,
   and where I should expect to see the 'Todero' logo/text."
4. "Make sections use Cards... Determine what cards should be in each section and
   what each of the cards should have."
5. "Instead of Sprints, since its 24h, we will call them bolts."

## Build instruction

### 1. Fill the width
The page is capped and does not fill its container. Find the constraint and
remove it. Verify at 1280, 1024, 820 and 375 that the content spans the pane with
no dead gutter. This is a bug, not a preference.

### 2. Identity — where each name lives
| Slot | Content |
|---|---|
| Top bar, far left | **Todero** wordmark. The tool's brand. Never changes, every user sees it. |
| Left nav, above PRIMARY | **Limiglow** + a project switcher. This is SCOPE — it answers "what am I looking at". |
| Left rail (the 14px column) | One avatar per PROJECT: first letter (`L`), or a logo when the row has one. |
| Breadcrumb bar | **Delete it.** It duplicates both, and "Business"/"Project" are developer words. |

The rail is currently `BusinessRail` and shows the BUSINESS. It must show
projects. Businesses become a switcher inside Settings, not a permanent rail —
there is one business and it earns no screen furniture.

Deleting the breadcrumb also removes the line "Scoped to Limiglow. Some panels
still read across projects — that is being fixed." That was orchestration
scaffolding that leaked into the product, and it is now stale: scoping is
enforced at the seam.

### 3. Cards
Every section becomes cards. The contract for one card:
- one question it answers
- one number that matters, and the query that produced it
- one action, or none — never a decorative button
- collapsible, and the collapsed state persists
- reflows to a single column on mobile
- an empty state that NAMES the project and reads as "nothing yet", never as breakage

**Now** — `Needs you` (inbox + blockers + risk radar MERGED into one card),
`Running now`, `Bolt status`, `Recent activity`.
Move OUT of Now: Subscriptions & Balances → Settings. Project Progress → Work.
**Now must fit one screen at 1280×800.** It currently runs about 1,250px to say
that Limiglow is empty. Seven separate "nothing here" messages is a wall; one is
information.

You own only Now's card work in this piece (`OverviewTab.tsx` plus the nav
shell). The other five destinations get the same treatment in later pieces —
but define the shared `Card` component here so they can.

### 4. Bolts
A bolt is the 24-hour equivalent of a sprint.

The rename is the easy half. The half that matters: every countdown, burndown,
velocity figure and "shipped yesterday" window was built for a two-week sprint.
A 24h bolt rendered with day-granularity math shows "0 days left" with nine
hours to run — which is EXACTLY the fabrication deleted in TOD-2401, where the
landing screen carried two dead countdowns reading "0 days left · 100% elapsed".
Do not reintroduce it in new clothes.

So: units become hours (and minutes under an hour), elapsed/remaining are
computed against a 24h window, and "shipped yesterday" becomes "shipped in the
last bolt". Keep the database column names; this is a display and units change,
not a migration. Where a real sprint row exists with a two-week window, render
it honestly rather than pretending it is a bolt.

## ACCEPTANCE — verified against the RUNNING app

A dev server runs on http://localhost:3000. Do NOT restart it, do NOT run
`npm run build`. `npx tsc --noEmit` is safe. Auth: `cookie: mc-auth=kaos2026; mc-role=owner`.

1. At 1280, 1024, 820 and 375 the content fills the pane — no dead gutter, no
   horizontal scroll. Report the measured content width at each.
2. The Todero wordmark appears once, top-left. The project name appears in the
   left nav above PRIMARY, with a switcher. The breadcrumb bar is gone.
3. The left rail shows `L` for Limiglow. No business appears in the rail.
4. Now fits one screen at 1280×800 — measure and report the scroll height.
5. Every card on Now states its source, and each number traces to a query. Show
   the query per card.
6. No countdown anywhere renders "0 days left" for a window measured in hours.
   Create a bolt with a 24h window, and show it rendering hours correctly.
7. `npx tsc --noEmit` clean, `bash scripts/smoke-test-layout.sh` passes,
   `node scripts/acceptance/run.mjs` reports 45/45 (about 4 seconds — if it takes
   minutes the SERVER is unhealthy, not the product; say so rather than reporting
   a regression).
