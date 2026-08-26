# PIECE: Work gets the card treatment, and Sprint becomes Bolt board

id: work-cards
lane: Operator
follows: bolt-time (TOD-2413/2414), bolt-schedule (TOD-2415)

OWNS EXCLUSIVELY: components/nav/config.ts, components/tabs/WorkViewCard.tsx (new),
app/page.tsx (the Work branch only)

DO NOT TOUCH: components/tabs/OverviewTab.tsx, lib/bolt-time.ts — settled.
The eight legacy tabs Work renders (BoardTab, IssuesTab, EpicMapTab,
FeaturesTab, ProductBoardTab, PipelineTab, CalendarTab) are wrapped, not
rewritten. Rewriting 5,000 lines of legacy tab is a wave, not a round.

## Why

Work is where the operator lives. It absorbed eight of the twenty old tabs and
has ZERO card treatment — four pills over raw legacy components. The owner's own
table (`docs/rebuild/FEEDBACK.md` item 4) names its four cards:
**Bolt board, Backlog, Epics, Due.**

`components/nav/Card.tsx` implements the full contract and has had exactly two
consumers (Now's four cards, and the Bolt schedule card). This is the test of
whether that contract generalises to a destination it was not written for.

## Build instruction

### 1. Sprint becomes Bolt board
`components/nav/config.ts:59` still reads `{ id: 'sprint', label: 'Sprint' }`.
A bolt is the 24h window; the view that shows it is the **Bolt board**. Rename
the id and the label, and keep every legacy path reaching it alive through
`LEGACY_TAB_MAP` — `calendar` and `pipeline` both redirect there today and must
still land.

### 2. Each Work view renders inside a card
One wrapper, `WorkViewCard`, supplying per view:
- the QUESTION it answers, as the card title
- one number, from an EXACT count — `/api/issues?project=<p>&limit=0` returns
  `{ total }`. **Never `rows.length`.** `design/Work.dc.html` is explicit:
  "Counts come from a count:'exact' query, never from the length of a page."
  Round 4 shipped exactly that defect on Now (a `limit: 5` page rendered as
  "5 events") and it is still there — do not add a second instance.
- the source line, so the number is traceable
- an empty state naming the PROJECT
- an error state that replaces the body — never an empty state over a failure

### 3. The counts must be scoped
Every count passes the project. An unscoped count on a scoped card is the
cross-project leak this wave closed nine of.

## ACCEPTANCE — verified against the RUNNING app

Dev server is running at http://localhost:3000. Do NOT restart it, NEVER run
`npm run build`. Auth: `cookie: mc-auth=kaos2026; mc-role=owner`.
Limiglow has ZERO issues — that is CORRECT. Prove every claim with a FIXTURE,
then remove it.

1. All four Work views render inside a card with a title, a source line and a
   collapse control. Show each.
2. The `Sprint` pill reads `Bolt board`. `/work/sprint`, and the legacy
   `calendar` and `pipeline` paths, all still resolve. Show the URLs.
3. Each card's number comes from a `limit=0` total, NOT a page length. Insert
   MORE rows than any page size and show the count exceeds the page.
4. Every count is project-scoped. Insert a row under another project and show
   the count does not move.
5. Collapse a Work card, reload, and show it is still collapsed.
6. With zero issues, each card's empty state NAMES Limiglow and reads as
   "nothing yet", not as breakage.
7. Kill the API leg for one card and show the ERROR replaces the body rather
   than an empty state appearing over it.
8. `npx tsc --noEmit` clean, `bash scripts/smoke-test-layout.sh` passes,
   `node scripts/acceptance/run.mjs` reports 45/45 in about 4s. If slow or
   mass-failing, the SERVER is unhealthy — say so.
