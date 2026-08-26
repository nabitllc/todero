# PIECE: Resolve an identifier, jump to a destination, without a mouse

id: search-and-jump
lane: Search & Findability
benchmark: Linear's command palette (⌘K)

OWNS EXCLUSIVELY: `components/SearchOverlay.tsx`, `lib/search-commands.ts` (new),
`lib/__tests__/search-commands.test.ts` (new),
`docs/rebuild/pieces/pieces6/search-and-jump.md` (this file)

DO NOT TOUCH: `app/page.tsx`, `components/nav/**`, `app/api/issues/**`,
`app/api/db/**`, `components/tabs/**`, `scripts/**`, `migrations/**` — seven
other agents hold those right now.

## Why this piece exists

Two independent critics wrote the same sentence about the same gap:

> Linear's ⌘K resolves an identifier (ENG-431) straight to the issue and also
> carries verbs. Here ⌘K opens SearchOverlay over issues only, and ⌘J opens
> chat; there is no way to jump to a DESTINATION or trigger an action from the
> keyboard. Every one of the six destinations requires the mouse.

The overlay as found (92 lines) did three things and no more:

1. one debounced `ilike` query against `dbUrl('issues?…')`;
2. rendered rows whose click handler was `onNavigate('board')` — **every row,
   regardless of which issue it was**. The key `TOD-1` and the key `TOD-9`
   both went to the Board and neither one was selected there. The row looked
   like a link to an issue and was a link to a tab;
3. `Escape` closed it. There was no arrow-key traversal, no `Enter`, no
   `role="listbox"`, no `aria-activedescendant`, no notion of a destination,
   and no statement anywhere of where a result had come from.

Item 2 is the one that matters most: it is the exact failure mode this rebuild
keeps paying for — an affordance that *reads* as an action and performs a
different, weaker action silently.

## Two structural facts this piece must respect, found while scoping it

### 1. The scope boundary is at the server seam, and search must not be its hole

`app/api/issues?task_key=X` answers **404** — deliberately, not 403 — when the
key belongs to a project outside the caller's resolved scope, "so a scoped
caller should not be able to use this endpoint to discover which keys exist
outside its own project" (`app/api/issues/route.ts`). `app/api/db/issues?…`
fails **closed** (400 `unscoped_issues_read`) when no scope resolves, and
`scripts/no-unscoped-issues.mjs` proves both with ten live requests. Scope is
resolved in exactly one place — `middleware.ts`, from the request's own path or
its `Referer` — and both scope headers are stripped off the incoming request
before being recomputed, so a caller cannot assert its own scope.

Consequence for this piece, and the reason it adds **no** `app/api/search`
route: a second issues-reading endpoint is a second place the boundary has to
be re-derived and a second place to get it wrong. `middleware.ts` would stamp
`x-mc-project` on it just the same, but nothing would *prove* the new route
read that header — the guard script probes the two endpoints that exist today,
not one invented tonight. The palette therefore reads through the two seams
that are already proven: `GET /api/issues?task_key=…` and `GET /api/db/issues?…`.
Zero new server surface; zero new scope logic.

The corollary the UI has to honour: on Fleet, Runs and Settings → Projects —
the destinations `middleware.ts` names as deliberately cross-project — no scope
resolves, so the issues legs return 400 by design. That is a **failure to
show**, not an emptiness to render.

### 2. No per-issue surface exists to deep-link to

There is no `/issue/<key>` route, no issue modal, no `?issue=` parameter, and
no focus signal any tab listens for. `components/tabs/IssuesTab.tsx` keeps its
row expansion in local `useState`. The only navigable surfaces in this app are
the six destinations and their views (`components/nav/config.ts`), and
`app/page.tsx` — which this piece may not edit — hands the overlay a single
`onNavigate(tab: string)` prop.

So "resolves an identifier straight to the issue" is delivered as far as it
honestly can go and no further: the palette resolves the key against the real
scoped endpoint and renders **that issue's real fields** inline — title,
status, type, priority, assignee, bolt, project — and `Enter` then goes to
Work → List, the surface that lists it. The row says exactly that. It does not
claim to open the issue, because nothing in this app can. Item 11 below records
this as a known limitation rather than hiding it.

## Build instruction

### 1. One module: `lib/search-commands.ts`
Every palette decision that is not React lives here, pure and unit-tested. It
imports `components/nav/config.ts` and derives everything from it — there is no
second list of destination names anywhere in this piece. `sprint` was renamed
to `bolt` at TOD-2416; a hardcoded copy would already be stale.

### 2. `components/SearchOverlay.tsx` consumes it
Three groups, each stating its source in the dim monospace `.prov` style
`components/nav/Card.tsx` established for its `source` prop. Full combobox
keyboard model. Per-leg error state, never coerced to empty.

---

## ACCEPTANCE

Every item is observable — a keystroke and what renders, a request and its
status, or a test that fails when the behaviour regresses.

1. **The destination list is derived, not copied.** `lib/search-commands.ts`
   holds no list of destination or view names; every label, id, question and
   alias is read out of `@/components/nav/config` at module load.
   `grep -n "bolt\|Fleet\|Memory\|epics" lib/search-commands.ts` returns
   nothing. **One named exception:** `pathForView` contains the literal `now`,
   because `app/page.tsx`'s `buildPath()` special-cases exactly that
   destination (`!project && destination === 'now' && view === 'overview'`
   renders as `/`), and the point of `pathForView` is to reproduce `buildPath`
   byte-for-byte. Deriving it as "whatever is first in `DESTINATIONS`" would be
   a guess about a different file's constant, not a derivation. A test asserts
   the reproduction for every command, so the two cannot drift apart silently.
   A further test enumerates `DESTINATIONS` and asserts one command exists for
   every view — 6 destinations, 18 views, 18 commands — with no command that
   config does not account for.

2. **Typing a destination name offers it.** With the palette open, typing
   `fleet` renders a row labelled `Fleet` whose hint is that destination's own
   `question` string from config. Typing `bolt` renders `Work → Bolt board`.
   Typing `sprint` — the pre-TOD-2416 name, still in `LEGACY_TAB_MAP` — also
   renders `Work → Bolt board`, under its *current* label, never the old one.

3. **Enter on a destination row lands on that destination.** For every one of
   the 18 commands, activation reaches exactly that `(destination, view)` pair.
   Proven two ways: `resolveNavToken()` in the module models
   `app/page.tsx`'s `navigate()`/`goTo()` resolution (LEGACY_TAB_MAP →
   isDestinationId → DEFAULT_VIEW, including `goTo`'s fallback when a mapped
   view no longer exists in `viewsOf(dest)`), and a test asserts every
   command's plan round-trips to its own pair. `navPlanFor()` *verifies that
   round-trip at runtime before choosing a token* and falls back to a path
   push otherwise — so renaming a view in config can never silently route the
   palette to a destination's default view.

4. **All six destinations are reachable with the keyboard alone.** Opening the
   palette with an empty query lists all 18 commands, all six destinations
   among them. The sequence `⌘K`, `↓`×n, `Enter` reaches each one; no pointer
   event is required at any step.

5. **`now/signal` is reachable too.** It is the one view with no entry in
   `LEGACY_TAB_MAP`, so no `onNavigate(string)` token can express it. Its
   command carries a `{kind:'path'}` plan that pushes the canonical URL
   (`pathForView()` reproduces `app/page.tsx`'s `buildPath()`, preserving the
   `/b/<biz>` and `/p/<slug>` prefixes) and dispatches `popstate`, which
   `app/page.tsx`'s own back/forward listener already handles. A test asserts
   `pathForView` output for every command matches what `buildPath` would emit.

6. **A task key resolves to the issue.** Typing `TOD-1` (case-insensitive,
   spaces tolerated) issues exactly one request — `GET /api/issues?task_key=TOD-1`
   — and on 200 renders one row carrying the issue's real `title`, `status`,
   `type`, `priority`, `assignee`, `sprint` and `project`, all read from that
   response. Nothing on that row is defaulted or invented; a field the row
   omits is a field the response did not carry.

7. **A foreign key does not leak — from any screen.** From a page scoped to
   Limiglow, typing `TOD-1` — which exists, in project Todero — renders
   `TOD-1 — not found in Limiglow`, and nothing else. The palette never prints
   the string `Todero`, never a status, never a 403, never "you don't have
   access to this". The row is not activatable; Enter on it does nothing. The
   underlying request is the app's existing 404 path; this piece adds no
   bypass, no `all_projects=1`, and no second endpoint.

   **Including on Fleet, Runs and Settings → Projects.** Found while building
   this and fixed here: `/api/issues?task_key=` applies its 404 only
   `if (scope && …)`, and `middleware.ts` resolves NO scope for those three
   deliberately-cross-project destinations — so from
   `/p/limiglow/fleet/office` the endpoint returned `TOD-1` in full, project
   and all. That is the same hole `app/api/db/[...path]/route.ts` closed for
   the other seam, whose comment names *this component* as the reason:
   "SearchOverlay is mounted unconditionally, so Cmd-K pressed on the Fleet
   screen returned another project's backlog". The leaking route is not this
   piece's to edit, so the palette refuses to render a row whose `project`
   differs from the one its own URL names, and its provenance line no longer
   claims a server-side scope it cannot guarantee. This is a refusal, not an
   enforcement claim: the server-side 404 is still the boundary, and the
   underlying asymmetry is reported for the owner of `app/api/issues/**`.

8. **A failed leg shows its failure.** Each of the three groups holds its own
   `{data | error}` and neither is coerced from the other. When the issues
   query fails — including the by-design 400 `unscoped_issues_read` on Fleet,
   Runs and Settings → Projects — that group renders `ApiErrorBanner` with the
   real status, endpoint and server message. The words "No results" never
   appear over a leg that errored, and the destination group keeps working
   while the issues group is failing.

9. **Every group states its source.** Each group header carries a `.prov`
   line — `font-mono`, `text-[10px]`, `text-white/35`, the same treatment
   `Card.tsx` gives its `source` prop — naming the real origin: the exact
   request path for the two query legs (including the live query string), and
   `components/nav/config.ts — 6 destinations, 18 views` for the destination
   group, with both counts computed from the config rather than typed.

10. **The keyboard model is complete and announced.** The input is
    `role="combobox"` with `aria-expanded`, `aria-controls` and
    `aria-activedescendant` pointing at the highlighted row's id. The results
    container is `role="listbox"`; each group is a `role="group"` with
    `aria-labelledby` its header; each row is a `role="option"` with a stable
    `id` and `aria-selected`. `↓`/`↑` move and wrap, `Home`/`End` jump to the
    ends, `Enter` activates the highlighted row, `Escape` closes. Arrow keys
    inside the palette do not scroll the page (`preventDefault`). The
    highlighted row is scrolled into view as it moves.

11. **No verb that does not work.** The palette offers navigation and one
    action — `Open chat` — which calls `onNavigate('chat')`, the same call
    `app/page.tsx` already special-cases to open `ChatOverlay`, and which is
    verified working. There is no "assign to…", no "move to bolt", no
    "change status": this app exposes no keyboard-reachable mutation the
    palette could honestly perform, and a row that looks actionable and is not
    is worse than its absence. **Known limitation, stated on the row itself:**
    an issue row's action is `Open Work → List`, not "open the issue", because
    no per-issue surface exists to open (see structural fact 2).

12. **Nothing else regressed.** `npx tsc --noEmit` is clean.
    `node --experimental-vm-modules node_modules/jest/bin/jest.js lib/__tests__/search-commands.test.ts`
    passes. `node scripts/acceptance/run.mjs` still reports 45/45 and
    `bash scripts/smoke-test-layout.sh` — which includes the ten live scope
    probes — still passes. Any fixture row created to demonstrate the search
    leg is deleted afterwards and its absence re-verified.

## Tests, and what each one would catch

`lib/__tests__/search-commands.test.ts`. Each case is written to fail on a
specific regression, not merely to pass today:

- **command coverage** — fails if a destination or view is added to config and
  the palette silently does not offer it (the drift a hardcoded list produces).
- **round-trip** — fails if a view is renamed in config while `LEGACY_TAB_MAP`
  still names the old segment: `resolveNavToken` then returns the
  destination's *default* view, which looks like success on screen.
- **`bolt` / `sprint`** — pins TOD-2416 specifically: the current name matches,
  the old name still matches as an alias, and the row's label is the new one.
- **`pathForView` vs `buildPath`** — fails if the URL shape drifts from
  `app/page.tsx`, including the `/b/` and `/p/` prefix preservation.
- **`normalizeTaskKey`** — accepts `tod-1`, ` TOD-1 `, `TOD-1`; rejects `TOD`,
  `-1`, `TOD-`, `TOD-1x`, and a query containing a space. A too-loose matcher
  fires the key request on ordinary words; a too-strict one never fires.
- **`sanitizeIlikePattern`** — fails if a `,` `(` `)` `%` or `*` in the user's
  query reaches the PostgREST `or=()` filter, where it would change the
  filter's structure rather than its value.
- **`projectFromPath`** — fails if the palette's idea of the scope name drifts
  from `middleware.ts`'s `slugToProjectName`, which is what decides the
  wording of the "not found in <project>" line in item 7.

## Defect found, NOT owned, NOT fixed here

`app/api/issues/route.ts`, GET, the `task_key` branch. Its 404 is guarded by
`if (scope && !crossProject && data.project !== scope)`. Two ways `scope` is
falsy, both of which hand over the full row for any key:

1. **A cross-project destination.** `middleware.ts` resolves no scope for
   Fleet, Runs and Settings → Projects, so `?task_key=` is unfiltered there.
   Reproduced live: `referer: /p/limiglow/fleet/office` → **200**, full TOD-1
   row including `project: "Todero"`. The palette now declines to render it
   (item 7), but the endpoint still answers.
2. **No `Referer` at all.** `referer` absent → **200**, full row. The LIST
   read on the same route fails closed in the same situation (**400**
   `unscoped_issues_read`), and so does `/api/db/issues`. The task_key branch
   is the one issues read that falls open where its neighbours refuse, so
   anyone with the session cookie can enumerate keys with plain `curl`.

`scripts/no-unscoped-issues.mjs` does not cover this: all ten of its probes go
through list reads and the db proxy; none of them ask for a `task_key`.
Suggested for whoever owns that route: treat `crossProject` as the only
widening signal (it already is on the list path) and fail closed when neither
a scope nor that header is present.
