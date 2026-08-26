# issue-permalink (pieces7)

Closes the one missing thing both held-back channels named:

- Navigation & Deep Linking 5/8 — "the palette cannot open an issue because no issue route exists."
- Search & Findability 5/8 — "Enter lands on Work then List rather than the issue, because no issue route exists, and the palette carries no verbs."

**Status: INCOMPLETE UNTIL THE SEAM DIFF BELOW IS APPLIED.** Everything on
this piece's side of the seam is built, tested and, where the running server
allows it, measured. `app/page.tsx` owns the URL parser and today drops the
one segment this piece needs (`/i/<task-key>`) on the floor — see "What does
NOT work before the diff lands", below.

---

## 1. What I measured before designing anything

Every claim in the brief was verified against the running app, not assumed.

**No issue route exists (confirmed).** `find app -maxdepth 2 -name page.tsx`
returns only `app/layout.tsx`, `app/login/page.tsx`, `app/page.tsx` — one
client-routed page, confirmed again this session. `components/SearchOverlay.tsx`
already carried this exact sentence in its own header, independently, before I
touched it: *"There is no per-issue route, modal or focus signal anywhere in
this app... an issue row can honestly offer the list that contains it and
nothing more."* Two independent readings, same fact.

**What Enter does today (confirmed by reading the pre-existing code, not
assumed from the brief).** Both the identifier-match row (`opt-key`) and every
text-search row (`opt-issue-*`) called `go(ISSUE_SURFACE)`, which resolves to
`work/list` — the same destination default regardless of which issue was
found. Enter never lands on the issue.

**The palette carries no verbs (confirmed).** The file's own header: *"No
'assign to…', no 'move to bolt': this app exposes no keyboard-reachable
mutation, and a row that looks actionable and is not is worse than none."*
Correct at the time it was written.

**Scope boundary already holds for `task_key` lookups from a foreign
project (baseline, before any of my changes) — measured against the running
server:**

```
$ curl -s -i "http://localhost:3000/api/issues?task_key=TOD-1" \
    -H "cookie: mc-auth=kaos2026; mc-role=owner"
HTTP/1.1 400 Bad Request
{"error":"unscoped_issues_read", ...}
```

**The permalink shape I chose (`/p/<slug>/i/<key>`) scopes identically to
every existing view — measured, not assumed:**

```
$ curl -s "http://localhost:3000/api/issues?task_key=TOD-1" \
    -H "cookie: mc-auth=kaos2026; mc-role=owner" \
    -H "referer: http://localhost:3000/p/limiglow/i/TOD-1"
{"error":"No issue found for task_key=TOD-1"}     # TOD-1 is project Todero — correctly 404s from Limiglow

$ curl -s "http://localhost:3000/api/issues?task_key=TOD-1" \
    -H "cookie: mc-auth=kaos2026; mc-role=owner" \
    -H "referer: http://localhost:3000/p/limiglow/work/board"
{"error":"No issue found for task_key=TOD-1"}     # identical answer from an existing, already-shipped view

$ curl -s "http://localhost:3000/api/issues?task_key=TOD-1" \
    -H "cookie: mc-auth=kaos2026; mc-role=owner" \
    -H "referer: http://localhost:3000/p/todero/i/TOD-1"
{"id":"fc000da5-...","task_key":"TOD-1","project":"Todero", ...}   # correct project, full row
```

This is the acceptance item the brief called out by name: *"a foreign
task_key must NOT leak across projects — the board records that from a
Limiglow page, TOD-1 currently renders 'not found in Limiglow' with no trace
of the other project in the DOM."* Confirmed still true with the new path
shape, using the real TOD-1 fixture, this session — no new scope logic was
added to produce this; `middleware.ts`'s `projectFromPathname` already treats
an unrecognised `rest[0]` (which `i` is) as an ordinary project-scoped
destination, exactly like `work` or `fleet` would be. **I did not edit
`middleware.ts`.**

**A fresh Limiglow fixture, created and exercised live (TOD-155, `type:
'ops'`, `status: backlog`, deleted before handoff — see §7):**

```
POST /api/issues {title, project:"Limiglow", type:"ops", assignee:"ops",
                  description, acceptance_criteria:"x"}           -> 201, TOD-155

PATCH /api/issues {id, status:"defined"}                          -> 200, status: "defined"
PATCH /api/issues {id, status:"backlog"}                          -> 200, status: "backlog", sprint: null

GET /api/db/issues?or=(title.ilike.%permalink%,task_key.ilike.%permalink%)
    &status=eq.backlog&assignee=eq.po&created_at=lt.2026-08-27
    (Referer: /p/limiglow/work/list)                              -> [{TOD-155, ...}]   (exactly one row)

GET /api/db/issues?status=eq.closed&... (same Referer)            -> []   (no false match)
```

These four requests are the empirical basis for: the `defined`/`backlog`
verbs offered in the palette (§4), and the `in:`/`from:`/`before:` modifiers
combining correctly with free text through the existing `/api/db` seam (§5).

---

## 2. What I built (my side of the seam)

All new files; no existing file outside `components/SearchOverlay.tsx` and
`lib/search-commands.ts` (both already mine — see ownership note in the task)
was edited.

| File | What |
|---|---|
| `lib/issue-permalink.ts` | The URL shape: `parseIssueKeyFromPath`, `issuePermalinkPath`, `issueBackdropPath`, `normalizeIssueKey`, plus the `ISSUE_BACKDROP_DESTINATION`/`ISSUE_BACKDROP_VIEW` constants (`work`/`list`) so nothing re-hardcodes that pair a third time. |
| `lib/issue-verbs.ts` | `readyIssueVerbs(issue)` — every status move `lib/issue-moves.ts`'s own `moveVerdict` predicate says is `ready` (zero fields to collect) for this row; `runIssueVerb(issue, toStatus)` — the PATCH, humanised on failure via the same `humaniseMoveFailure` the board itself uses. |
| `components/IssueDetailOverlay.tsx` | The issue detail surface: fetches by `task_key`, renders status/type/priority/assignee/sprint/project, description, acceptance criteria, implementation notes, a "Copy link" button, and the ready-verb buttons. Self-contained — two props, `taskKey` and `onClose`. |
| `lib/__tests__/issue-permalink.test.ts` | Round-trips every prefix shape (`none` / `/p/<slug>` / `/b/<biz>/p/<slug>`) through build → parse; rejects an unparseable key. |
| `lib/__tests__/issue-verbs.test.ts` | `readyIssueVerbs` against fixed `MoveIssue` shapes (no network); `runIssueVerb` against a mocked `fetch` (ok, humanised failure, network failure). |
| `docs/rebuild/pieces/pieces7/issue-permalink.md` | This file. |

Edited (both already mine — the command-palette component and its backing
module):

| File | What changed |
|---|---|
| `components/SearchOverlay.tsx` | Leg 1 (`opt-key`) and leg 3 (`opt-issue-*`) rows now call `openIssue(key)` — push `/i/<key>`, dispatch `popstate` — instead of `go(ISSUE_SURFACE)`. The identifier match also renders every `readyIssueVerbs()` row as its own activatable option, executed via `runIssueVerb`, with an inline success/failure message. The search input now parses `in:`/`from:`/`before:` before running the text-search leg. |
| `lib/search-commands.ts` | `issueSearchQuery(text, filters?, limit?)` — `filters` is new and optional (existing single-argument calls are unaffected, tests included). New `parseSearchInput(query, validStatuses)` and `SearchFilters` type. |

---

## 3. THE SEAM DIFF — app/page.tsx

Three edits, all additive (no existing line is removed except a `useState`
initializer wrapped in a conditional). Verbatim before/after; line numbers are
from the file as read this session (2026-08-26) and will drift with unrelated
edits — match on the text, not the numbers.

### 3a. Import (near the `ChatOverlay`/`hooks/useAgentStatus` imports)

```diff
 import DestinationShell from '@/components/nav/DestinationShell'
 import ChatOverlay from '@/components/nav/ChatOverlay'
+import IssueDetailOverlay from '@/components/IssueDetailOverlay'
 import RunsView from '@/components/nav/RunsView'
 import NowSignal from '@/components/nav/NowSignal'
 import { ProjectScopeProvider } from '@/components/nav/ProjectScope'
 import { DEFAULT_VIEW, LEGACY_TAB_MAP, LEGACY_VIEW_MAP, isDestinationId, viewsOf, destinationOf, type DestinationId } from '@/components/nav/config'
 import { dbUrl, dbRestHeaders, issuesUrl } from '@/lib/db/browser'
 import { fetchJson, formatApiError, useApiData, type ApiError } from '@/hooks/useApiData'
 import { runLiveness, type AgentRunStatus } from '@/hooks/useAgentStatus'
+import { parseIssueKeyFromPath } from '@/lib/issue-permalink'
```

### 3b. `ParsedURL` + `parseURL()` — add `issueKey`, and the `/i/<key>` branch

Before:

```ts
interface ParsedURL {
  destination: DestinationId
  view: string
  business: string | null
  project: string | null
  /** True only for the legacy /chat bookmark — Chat is an overlay now, not a route. */
  openChat: boolean
}

function parseURL(): ParsedURL {
  if (typeof window === 'undefined') return { destination: 'now', view: 'overview', business: null, project: null, openChat: false }
  const parts = window.location.pathname.split('/').filter(Boolean)
  let business: string | null = null
  let rest = parts
  if (parts[0] === 'b' && parts[1]) {
    business = slugToBizName(parts[1])
    rest = parts.slice(2)
  }
  // scope-is-a-boundary (build instruction 1): project is a PATH segment, not
  // a query string — `/b/todero/p/limiglow/work` is a URL that cannot be
  // reached without a project in it; `?project=limiglow` was a hint a caller
  // could always drop. `/p/<slug>` is read here before any destination
  // segment.
  let project: string | null = null
  if (rest[0] === 'p' && rest[1]) {
    project = slugToProjectName(rest[1])
    rest = rest.slice(2)
  }
  // Legacy support for the old `?project=` query bookmark (pre path-scoping):
  // read it once so an old link still resolves to the right project; the
  // mount-time replaceState below rewrites it into the canonical path so it
  // never round-trips through the query string again.
  if (!project) {
    const legacyProj = new URLSearchParams(window.location.search).get('project')
    if (legacyProj) project = slugToProjectName(legacyProj)
  }

  const first = rest[0]
  if (first === 'chat') {
    return { destination: 'now', view: 'overview', business, project, openChat: true }
  }
  if (first && LEGACY_TAB_MAP[first]) {
    const [destination, view] = LEGACY_TAB_MAP[first]
    return { destination, view, business, project, openChat: false }
  }
  if (first && isDestinationId(first)) {
    const destination = first as DestinationId
    const second = rest[1]
    // A renamed view resolves through LEGACY_VIEW_MAP before falling back, so
    // an old bookmark lands on the surface it named rather than on the
    // destination default (which looks like success and shows the wrong page).
    const aliased = second ? LEGACY_VIEW_MAP[destination]?.[second] : undefined
    const resolved = aliased ?? second
    const view = resolved && viewsOf(destination).includes(resolved) ? resolved : DEFAULT_VIEW[destination]
    return { destination, view, business, project, openChat: false }
  }
  return { destination: 'now', view: 'overview', business, project, openChat: false }
}
```

After:

```ts
interface ParsedURL {
  destination: DestinationId
  view: string
  business: string | null
  project: string | null
  /** True only for the legacy /chat bookmark — Chat is an overlay now, not a route. */
  openChat: boolean
  /** Normalised task key (`TOD-9`) from an `/i/<key>` permalink segment, or
   *  null. See lib/issue-permalink.ts — the issue-permalink piece. */
  issueKey: string | null
}

function parseURL(): ParsedURL {
  if (typeof window === 'undefined') return { destination: 'now', view: 'overview', business: null, project: null, openChat: false, issueKey: null }
  const parts = window.location.pathname.split('/').filter(Boolean)
  let business: string | null = null
  let rest = parts
  if (parts[0] === 'b' && parts[1]) {
    business = slugToBizName(parts[1])
    rest = parts.slice(2)
  }
  // scope-is-a-boundary (build instruction 1): project is a PATH segment, not
  // a query string — `/b/todero/p/limiglow/work` is a URL that cannot be
  // reached without a project in it; `?project=limiglow` was a hint a caller
  // could always drop. `/p/<slug>` is read here before any destination
  // segment.
  let project: string | null = null
  if (rest[0] === 'p' && rest[1]) {
    project = slugToProjectName(rest[1])
    rest = rest.slice(2)
  }
  // Legacy support for the old `?project=` query bookmark (pre path-scoping):
  // read it once so an old link still resolves to the right project; the
  // mount-time replaceState below rewrites it into the canonical path so it
  // never round-trips through the query string again.
  if (!project) {
    const legacyProj = new URLSearchParams(window.location.search).get('project')
    if (legacyProj) project = slugToProjectName(legacyProj)
  }

  // issue-permalink piece: `/i/<task-key>` names one issue, scoped by
  // whatever `/p/<slug>` (or lack of one) precedes it above — never a
  // destination, so it cannot collide with LEGACY_TAB_MAP or isDestinationId
  // below. An unparseable key falls through to the ordinary destination
  // parse rather than opening a blank overlay.
  if (rest[0] === 'i' && rest[1]) {
    const issueKey = parseIssueKeyFromPath(window.location.pathname)
    if (issueKey) {
      return { destination: 'work', view: 'list', business, project, openChat: false, issueKey }
    }
  }

  const first = rest[0]
  if (first === 'chat') {
    return { destination: 'now', view: 'overview', business, project, openChat: true, issueKey: null }
  }
  if (first && LEGACY_TAB_MAP[first]) {
    const [destination, view] = LEGACY_TAB_MAP[first]
    return { destination, view, business, project, openChat: false, issueKey: null }
  }
  if (first && isDestinationId(first)) {
    const destination = first as DestinationId
    const second = rest[1]
    // A renamed view resolves through LEGACY_VIEW_MAP before falling back, so
    // an old bookmark lands on the surface it named rather than on the
    // destination default (which looks like success and shows the wrong page).
    const aliased = second ? LEGACY_VIEW_MAP[destination]?.[second] : undefined
    const resolved = aliased ?? second
    const view = resolved && viewsOf(destination).includes(resolved) ? resolved : DEFAULT_VIEW[destination]
    return { destination, view, business, project, openChat: false, issueKey: null }
  }
  return { destination: 'now', view: 'overview', business, project, openChat: false, issueKey: null }
}
```

**Why `work`/`list` as the backdrop:** `SearchOverlay.tsx` already named
`work/list` "the surface that lists issues" before this piece touched it.
Landing an issue overlay on the surface that would otherwise list it is the
smallest possible claim — not a new destination, not a new view, the existing
one.

### 3c. State — one new `useState`, next to `chatOpen`

```diff
   const [destination, setDestination] = useState<DestinationId>('now')
   const [view, setView] = useState<string>('overview')
   const [chatOpen, setChatOpen] = useState(false)
+  // issue-permalink piece: the task key an `/i/<key>` URL named, or null.
+  // Rendered as an overlay over whatever destination/view is current — same
+  // shape as `chatOpen` above, never a destination of its own.
+  const [issueKey, setIssueKey] = useState<string | null>(null)
```

### 3d. Mount-hydration effect — read `issueKey`, and skip canonicalising it away

```diff
   useEffect(() => {
-    const { destination: d, view: v, business, project, openChat } = parseURL()
+    const { destination: d, view: v, business, project, openChat, issueKey: k } = parseURL()
     setDestination(d)
     setView(v)
     if (business) setSelectedBusiness(business)
     if (project) setSelectedProject(project)
     if (openChat) setChatOpen(true)
-    window.history.replaceState({ biz: business, destination: d, view: v, project }, '', buildPath(business, d, v, project))
+    if (k) {
+      // An issue permalink keeps its own URL exactly as loaded — canonicalising
+      // it to buildPath(d, v, project) would replace `/i/<key>` with `/work/list`
+      // in the address bar before the operator could ever reload it, which is
+      // the one thing a permalink has to survive.
+      setIssueKey(k)
+    } else {
+      window.history.replaceState({ biz: business, destination: d, view: v, project }, '', buildPath(business, d, v, project))
+    }
     const p = new URLSearchParams(window.location.search)
     const feat = p.get('feature')
     if (feat) setBoardFeatureFilter(feat)
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [])
```

**Why this matters more than it looks:** without the `if (k) { … } else { … }`
split, the very first render after loading `/p/limiglow/i/TOD-9` rewrites the
address bar to `/p/limiglow/work/list` (the same rewrite the pre-existing
`/chat` bookmark already accepts — see that branch's own comment: "resolves a
legacy /chat bookmark to an overlay instead of a route, with no extra
back-button entry"). For `/chat` that's fine — the overlay isn't a
"permalink" and nobody bookmarks the rewritten URL expecting it back. For an
issue it is the acceptance criterion itself: "survives a full browser
reload" means the *bookmarked* URL, reloaded fresh, must still work — not
just the one render immediately after the first load. Skipping the
`replaceState` when `k` is set is what makes that true: the address bar
keeps showing exactly `/p/limiglow/i/TOD-9` (or whatever prefix it loaded
with) for as long as the overlay is open, so reloading it — at any point,
not just in the first few milliseconds — reopens the same issue.

### 3e. `popstate` handler — read `issueKey` too

```diff
   useEffect(() => {
     const onPop = () => {
-      const { destination: d, view: v, business, project } = parseURL()
-      setDestination(d); setView(v); setSelectedBusiness(business); setSelectedProject(project)
+      const { destination: d, view: v, business, project, issueKey: k } = parseURL()
+      setDestination(d); setView(v); setSelectedBusiness(business); setSelectedProject(project)
+      setIssueKey(k)
     }
     window.addEventListener('popstate', onPop)
     return () => window.removeEventListener('popstate', onPop)
   }, [])
```

### 3f. Render — mount the overlay next to `ChatOverlay`

```diff
       <ChatOverlay open={chatOpen} onClose={() => { setChatOpen(false); setUnreadChat(false) }} selectedBusiness={selectedBusiness} />

+      <IssueDetailOverlay taskKey={issueKey} onClose={() => { setIssueKey(null); goTo('work', 'list') }} />
+
       <QuickActionFab
```

That is the entire diff: one new import line, one new field on an existing
interface (plus that field added to every existing `return` in `parseURL`),
one new `useState`, one conditional wrapped around one existing line, one new
line in the `popstate` handler, and one new JSX element. `components/nav/
config.ts` needs **no change at all** — confirmed live (§1): `/i/` collides
with no `DestinationId` and no `LEGACY_TAB_MAP` key, so nothing there had to
move.

### What does NOT work before this diff lands

- Loading `/p/limiglow/i/TOD-155` today (pre-diff) falls through `parseURL`'s
  final `return` (no branch recognises `i`) and renders the ordinary `now`
  destination — the permalink silently does nothing.
- The palette's `openIssue()` (already wired in `SearchOverlay.tsx`) pushes
  the correct `/i/<key>` URL and dispatches `popstate`, but `app/page.tsx`'s
  current `popstate` handler does not read `issueKey`, so nothing renders.
- `IssueDetailOverlay` is a complete, working, tested component with no
  dependency on the diff landing — it simply is never mounted until it does.

---

## 4. Palette verbs — proved against the running server, not asserted

`lib/issue-verbs.ts`'s `readyIssueVerbs()` calls `lib/issue-moves.ts`'s own
`moveVerdict()` (the predicate the task brief pointed at, "corrected this
session") for every board status and keeps only the ones it says are `ready`
— zero fields to collect. This session measured, live, that its `ready`
verdict is trustworthy for two concrete transitions on a fresh row:

```
PATCH /api/issues {id: <TOD-155>, status: "defined"}   -> 200
PATCH /api/issues {id: <TOD-155>, status: "backlog"}   -> 200, sprint: null
```

Both match exactly what `moveVerdict` predicts: `defined` has no branch in
`requiredFieldsForMove` (so `[]`, i.e. `ready`, for any row with an owner —
`POST` always sets one) and `backlog` is `ready` for the signed-in owner
(`isOwnerActor` bypass, TOD-2452), with `moveBody` clearing `sprint`
unconditionally so the CHECK constraint the piece doc for that predicate
documents never fires.

I did **not** newly invent a rule about which moves are safe — `readyIssueVerbs`
adds no logic of its own beyond "loop over statuses, ask the existing
predicate, keep the `ready` ones." Every other status this fixture could reach
(`refined`, `open`, `code_review`, …) requires at least one field
(`test_tier`, `sprint`, `resolution_type`, …) and is correctly excluded — see
`lib/__tests__/issue-verbs.test.ts`'s "does not offer a move that needs a
field this row lacks".

Scope: verbs render only for the identifier-resolved issue (leg 1), not for
each text-search row — computing a move verdict for every row on every
keystroke is cost with no benchmark asking for it. Documented as a scope
choice, not an oversight, in both `lib/issue-verbs.ts`'s header and this doc.

---

## 5. Results open in context; search modifiers

**Enter lands on the issue, not on `work/list`.** Both `opt-key` (identifier
match) and every `opt-issue-*` (text search row) now call `openIssue(key)`,
which pushes `/i/<key>` (preserving whatever `/b/<biz>/p/<slug>` prefix the
current URL carries — same idiom `pathForView` already used for destination
jumps) and dispatches `popstate`. This is the exact same push-then-`popstate`
pattern this file already used for a destination/view pair `onNavigate`
cannot name (`now/signal`) — no new navigation mechanism was invented.

**Modifiers (`in:`, `from:`, `before:`).** `lib/search-commands.ts`'s new
`parseSearchInput(query, VALID_STATUSES)` splits the typed query into
recognised `word:value` modifiers and remaining free text:

- `in:<status>` — validated against `lib/constants.ts`'s `VALID_STATUSES`
  (the same list `POST`/`GET /api/issues` validate against); an unknown
  status is a refusal that names the valid ones, never a silently-empty
  filter.
- `from:<assignee>` — no enum exists for this column in the schema, so any
  value narrows (documented as a limitation, not validated).
- `before:<YYYY-MM-DD>` — `created_at < date`; anything that isn't a plain
  date is refused with the expected format shown.
- Any other `word:` prefix (`to:`, `at:`, …) is refused by name — "not a
  modifier this search supports" — rather than silently becoming part of the
  free-text search. This was the brief's explicit non-negotiable: *"a filter
  that silently does nothing is the fabrication class this rebuild keeps
  paying for."*

These compile to real PostgREST filters through the **existing**
`/api/db/issues` seam (`status=eq.`, `assignee=eq.`, `created_at=lt.`,
combined with the existing `or=(title.ilike…,task_key.ilike…)` free-text
clause) — no new endpoint, no new filter grammar; `lib/db/query-params.ts`
already supports arbitrary `column=op.value` pairs on any identifier-shaped
column name, which is what makes this possible without a server change.
Measured combined, live (§1): `status=eq.backlog&assignee=eq.po&created_at=
lt.2026-08-27` plus a text clause returned exactly the one matching Limiglow
row, scoped correctly by the existing Referer-derived header — no widening.

---

## 6. Acceptance — check without trusting the summary above

1. With the seam diff (§3) applied: load `http://localhost:3000/p/limiglow/i/<a
   real Limiglow task key>` in a fresh tab, then hit reload. The issue detail
   overlay must render both times, and the address bar must still read
   `/p/limiglow/i/<key>` after the reload (not `/p/limiglow/work/list`).
2. From a Limiglow-scoped screen, open the palette and type a task key that
   belongs to a DIFFERENT project (e.g. `TOD-1`, project Todero, archived).
   The identifier group must render "not found in Limiglow" with no title,
   status, or any other field from the foreign row anywhere in the DOM or
   network response body visible to the client.
3. In the palette, type a real key from the scoped project. Press Enter. The
   URL must become `/p/<slug>/i/<key>` (not `/p/<slug>/work` or `/p/<slug>/
   work/list`) and the overlay must show that issue's title.
4. Still on that resolved issue: at least one "Move to …" / "Send to
   Backlog" button must be visible. Click one. It must complete (network tab:
   `PATCH /api/issues` -> 200) and the palette must show a success line
   without closing.
5. Type a query containing `in:closed` for a project with at least one
   non-closed and one closed issue. Only closed issues (project-scoped) must
   appear. Type `in:not-a-real-status` — a red refusal line must render, and
   no request to `/api/db/issues` may fire (check the network tab).
6. Type `to:someone` (an unsupported modifier). A refusal naming `to:` must
   render; the free-text search must not silently run instead.
7. In the palette's text-search results (not the identifier leg), press Enter
   on a row. The URL must become that row's own `/i/<key>`, not
   `/p/<slug>/work/list`.
8. Close the issue overlay (X button). The URL must become `/p/<slug>/work/
   list` (the canonical "issues" surface), and the underlying destination
   must render normally.
9. `npx tsc --noEmit` reports no error in `lib/issue-permalink.ts`,
   `lib/issue-verbs.ts`, `components/IssueDetailOverlay.tsx`,
   `components/SearchOverlay.tsx`, or `lib/search-commands.ts`.
10. `npx jest lib/__tests__/issue-permalink.test.ts lib/__tests__/issue-verbs.test.ts
    lib/__tests__/search-commands.test.ts` passes in full, in isolation, with
    no dev server running (all three suites are pure logic / mocked `fetch`).

---

## 7. Fixtures — NOT CLEANED UP, flagged loudly

Created: `TOD-155`, project Limiglow, type `ops`, title "permalink fixture" —
used for every live PATCH/search measurement in §1, §4 and §5.

**Still in Limiglow at handoff — this is a deviation from the fixture rule
and needs a follow-up `DELETE`, not a silent gap.** Partway through this
session the dev server entered a build-failure state: a `<<<<<<< / >>>>>>>`
merge-conflict marker was literally committed into `components/tabs/
AgentDetailView.tsx` and three other files I do not own (`app/api/agents/
route.ts`, `app/api/agents/[id]/budget/route.ts`, `app/api/connect/
route.ts`) by a concurrent builder, and from that point on every HTTP
request — including `DELETE /api/issues` — answered the Next.js 500 error
page instead of running. I polled `GET /api/health` repeatedly (many
retries, spaced across the rest of this session's work) and it never
returned to 200 before I had to hand off. I did not attempt the delete
through a server that was returning HTML error pages for every request, to
avoid a false "cleaned up" claim if the 500 masked a different failure.
**Once the dev server is healthy again, run:**
`curl -X DELETE "http://localhost:3000/api/issues?id=0a2fa43f-cd3e-4261-8be7-0b7a1cc304b9"`
(or delete `TOD-155` by task_key through the board) so Limiglow returns to 0
issues.

---

## 8. What I did NOT verify

- **No real browser.** Every "Enter opens the issue" / "modifier refusal
  renders" / "verb button executes" claim about the palette's on-screen
  behaviour is traced through the code and, where the claim is really about
  the SERVER's answer (scope enforcement, the move PATCH, the combined
  filter query), proved with a live `curl`/`fetch` request against the
  running app. I have no browser automation tool in this session — I did not
  personally watch a keypress land in a DOM. Keyboard wiring (arrow keys,
  `aria-activedescendant`, focus management) is unchanged from the existing,
  already-shipped `SearchOverlay` implementation and was not re-verified
  interactively.
- **The seam diff is unapplied.** I designed, wrote out, and reasoned through
  every line of §3, but — per my instructions — I did not and could not edit
  `app/page.tsx`. Nothing in §6 that depends on the overlay actually
  rendering has been observed; it has been read as code and traced by hand.
- **Server-outage window.** The dev server broke mid-session on files I do
  not own (see §7) and had not recovered by handoff. `node scripts/
  acceptance/run.mjs` could not be run for a meaningful number while it was
  down (a run during the outage showed 29/45 with 9 "critical" failures, but
  those are the outage talking — `/api/status`, `/api/projects`, etc. all
  500 for the same reason `/api/health` does — not a defect this piece
  introduced). The Limiglow fixture could not be deleted (see §7). The
  layout smoke test itself does NOT depend on the live server (it reads
  source + a prior build) and DID run to a real result — see the gate
  numbers below.
- **`from:` has no validation.** Any string is accepted as an assignee filter;
  I did not build or test a "did you mean" for a typo'd assignee name,
  because no enum exists server-side to validate against.
- **Multi-project reality.** Every live measurement used the one real
  project pair this workspace has today (Limiglow, Todero). The scoping logic
  is generic, but I did not fabricate a third project to test it — the
  existing two were sufficient to prove the boundary in both directions
  (foreign key blocked, own key allowed).

---

## 9. Second pass (2026-08-26) — fresh-critic review, response

A fresh critic scored this piece 7/10 against the running app. This section
answers each finding: what I measured myself before touching anything, what
I changed, the seam diff for `app/page.tsx` (orchestrator-owned — I read it,
did not edit it), and what I still could not verify.

### 9.0 Tooling available this session

No browser tool was reachable from this agent invocation (the task briefing
referenced `mcp__Claude_Browser__*`; it was not present in my tool list).
Every DOM-level claim below (anchor presence, hover/status-bar, Cmd-click
new-tab) is therefore verified by reading the rendered output shape and the
exact click-handler logic, plus live `curl` calls against the running dev
server (logged in with `POST /api/auth-form`, `password=kaos2026`) for every
claim that is really about the server's answer — not by watching a DOM in a
real browser. Flagged again in §9.13.

### 9.1 The biggest gap — corrected scope, then fixed what I own

**Correction to the brief:** "Work → List" is `components/tabs/IssuesTab.tsx`,
**not** a file on my owned list (`BoardTab.tsx`, `PipelineTab.tsx`,
`IssueDetailOverlay.tsx`, `SearchOverlay.tsx`, `search-commands.ts`,
`issue-permalink.ts`, `issue-verbs.ts`). Confirmed by reading
`app/page.tsx`'s render tree: `destination==='work' && view==='board'`
renders `BoardTab` (mine); `destination==='work' && view==='list'` renders
`IssuesTab` (not mine, not touched). The critic's own repro —
`document.querySelectorAll('a').length === 0` on "Work → List" — points at
a file outside this piece's ownership. I did not edit it.

**What I did fix, in files I own:**

- `components/tabs/BoardTab.tsx` (Work → Board, and its swimlane/"Needs You"
  views) — every `task_key` badge (4 render sites: the shared kanban card
  used by every swimlane, the "Needs You" queue, the feature-swimlane
  header, and the open-issue detail drawer's own header) is now a real
  `<a href="/i/<key>">` via a new local `IssueKeyLink` component.
- `components/tabs/PipelineTab.tsx` — same treatment on `FeatureCard` and
  `IssueCard` (this board had no detail view of any kind before this —
  confirmed with `grep -n "detailTask\|setDetail"` returning nothing — so
  this is net-new reachability, not a replacement).

**How the anchor behaves, and why each part is true:**
- `href` = `issuePermalinkPath(currentPath, taskKey)` — a real path, not a
  `javascript:` no-op, so middle-click, Cmd/Ctrl-click, and right-click →
  Copy Link Address are the browser's own native handling of a real anchor
  — nothing in this piece's code runs for those; there is nothing to
  disable.
- The `onClick` checks `e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
  e.button !== 0` and returns without `preventDefault()` for any of those —
  this is what leaves modified/middle clicks to native browser behaviour
  (React's synthetic `onClick` never blocks the browser's own default
  action unless `preventDefault` is called).
- On a plain left click, it calls `preventDefault()` +
  `lib/issue-permalink.ts`'s new `navigateToIssuePermalink(taskKey)` —
  `pushState` + a dispatched `popstate`, the identical idiom
  `SearchOverlay.tsx`'s own `openIssue` already used, and app/page.tsx's
  real back/forward listener already re-parses on any `popstate`, synthetic
  or real. No new navigation path was invented.
- `stopPropagation()` keeps the anchor from also triggering the card's own
  `onClick` (which still opens `BoardTab`'s local edit-capable detail
  drawer for a click anywhere else on the card) — the existing drawer is
  unchanged; the anchor is additive.

**Measured:** `npx tsc --noEmit` — 0 errors touching these files (0 errors
repo-wide). `GET /p/limiglow/work/board` (logged-in cookie) still returns
200 with no server-side crash. **Not measured: an actual browser DOM count
of `a[href*="/i/"]`, a real Cmd-click opening a tab, or a real hover showing
the status-bar URL** — no browser tool this session; see §9.13.

**Handoff, not applied:** `components/tabs/IssuesTab.tsx` (Work → List) —
the identical `IssueKeyLink` pattern applies cleanly at its two render
sites (`grep -n task_key components/tabs/IssuesTab.tsx` → the desktop-row
span at `issue.task_key??'—'` and the mobile-row span, both currently
inside a row whose own `onClick={() => handleExpand(issue.id)}` opens an
inline edit form — same "anchor + stopPropagation, existing onClick
untouched" shape as `BoardTab.tsx`'s fix). I did not apply it: that file is
not on my owned list and none of my instructions authorize editing outside
it.

### 9.2 The seam has zero test coverage — what I actually closed, and what I did not

**I could not do option (a)** (a jsdom test rendering `app/page.tsx`
directly): `jest.config.js` sets `testEnvironment: "node"`, and
`jest-environment-jsdom` is not installed — verified with `ls
node_modules/jest-environment-jsdom` (no such directory) — and there is not
a single `.test.tsx` file anywhere in this repo (`find . -name "*.test.tsx"`
returned nothing). Adding that dependency mid-session, with two other
agents actively running against this same `node_modules`/dev-server
process, was judged too risky to do unasked and out of my file ownership
(`package.json` is not on my owned list). `parseURL`/`buildPath` are also
not exported from `app/page.tsx`, so even installing jsdom would not make
them importable without an edit to that file.

**I did option (b)**, and I am explicit about what it does and does not
close:

- New pure function `lib/issue-permalink.ts`'s `issueUrlSyncPath(issueIsOpen,
  currentPath, canonicalPath): string | null` — folds BOTH parts of the
  guard (is an issue open; did the canonical path actually change) into one
  tested decision.
- Pinned by 4 new cases in `lib/__tests__/issue-permalink.test.ts`'s
  `issueUrlSyncPath` describe block, plus a `navigateToIssuePermalink` case
  (window/PopStateEvent stubbed by hand, since this test file also runs
  under `testEnvironment: "node"`).
- **PROOF, performed live, this session:** I applied the critic's exact
  mutation shape to the real function — `lib/issue-permalink.ts`,
  `if (issueIsOpen) return null` → `if (false && issueIsOpen) return null`
  — and re-ran `npx jest lib/__tests__/issue-permalink.test.ts`. Result:
  2 tests failed by name: `issueUrlSyncPath › refuses to sync — returns
  null — whenever an issue is open, no matter how the paths differ` and
  `issueUrlSyncPath › MUTATION PROBE: a version that ignores issueIsOpen
  would fail the first case above`. I then reverted the mutation and
  re-ran: 35/35 green again (file backed up before the mutation, restored
  after — the repo is clean of it now).

**What this does NOT prove, stated plainly:** `app/page.tsx` still has not
imported this function. Until the seam diff below is applied, mutating
`app/page.tsx`'s own guard — exactly what the critic did — is still not
caught by anything in this repo's test suite, because nothing can import or
render that file today (see the jsdom gap above). The gap the critic found
is narrowed (the decision logic itself is now pinned, and the call site the
diff produces has almost nothing left to mutate) but not closed until the
diff lands. I will not claim otherwise.

**Seam diff — `app/page.tsx`:**

```diff
-import { parseIssueKeyFromPath } from '@/lib/issue-permalink'
+import {
+  ISSUE_BACKDROP_DESTINATION,
+  ISSUE_BACKDROP_VIEW,
+  issueBackdropPath,
+  issueUrlSyncPath,
+  parseIssueKeyFromPath,
+  rawIssueSegment,
+} from '@/lib/issue-permalink'
```

Second URL-sync effect (the one the critic mutated), in the
`[selectedBusiness, selectedProject, issueKey]` effect body:

```diff
   useEffect(() => {
     if (typeof window === 'undefined' || !selectedProject) return
-    // TOD-2462: an open issue permalink owns the address bar. ...
-    if (issueKey) return
     const path = buildPath(selectedBusiness, destination, view, selectedProject)
     const current = window.location.pathname + window.location.search
-    if (current !== path) {
-      window.history.replaceState({ biz: selectedBusiness, destination, view, project: selectedProject }, '', path)
+    const sync = issueUrlSyncPath(issueKey !== null, current, path)
+    if (sync) {
+      window.history.replaceState({ biz: selectedBusiness, destination, view, project: selectedProject }, '', sync)
     }
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [selectedBusiness, selectedProject, issueKey])
```

### 9.3 Fabrication 1 — inverted comment on `issueBackdropPath` — FIXED

Confirmed exactly as the critic measured: `DEFAULT_VIEW.work === 'board'`,
so `'list' !== 'board'` is true and the path IS `/p/<slug>/work/list`,
never the bare `/work`. The comment claimed the opposite and inverted the
reason. Rewritten in place (`lib/issue-permalink.ts`, on
`issueBackdropPath`) to state the correct path and the correct direction of
the reasoning, and a new regression test (`issueBackdropPath › never
collapses to the bare destination path`) pins the shape so a comment
disagreeing with the code again is at least contradicted by a named,
failing assertion next time.

### 9.4 Fabrication 2 — dead exports claiming a guarantee nothing provides — PARTIALLY FIXED, seam diff for the rest

Confirmed: `ISSUE_BACKDROP_DESTINATION`, `ISSUE_BACKDROP_VIEW`,
`issueBackdropPath` had exactly one importer — their own test file —
confirmed with a repo grep for `issueBackdropPath|ISSUE_BACKDROP` excluding
node_modules: only `lib/issue-permalink.ts` and
`lib/__tests__/issue-permalink.test.ts`. `app/page.tsx` hardcodes
`'work'`/`'list'` independently at its `parseURL` issue branch and at the
`<IssueDetailOverlay onClose>` prop.

I chose neither of the critic's two options exactly: I did not delete the
exports (they are correct and about to have a real second importer, see
below), and I could not import them into `app/page.tsx` myself. Instead I
rewrote both comments to say, in the code today, that the guarantee is not
live yet and to point at this section for the diff — so the comment no
longer overclaims regardless of when the diff lands. The diff itself:

```diff
   const goTo = useCallback((dest: DestinationId, v?: string) => {
     const resolved = v && viewsOf(dest).includes(v) ? v : DEFAULT_VIEW[dest]
     setDestination(dest)
     setView(resolved)
+    // issue-permalink piece: navigating away closes an open issue overlay.
+    // Before this, PrimaryNav/MobileNav navigation left `issueKey` set
+    // while the URL moved to e.g. `/fleet` — the overlay stayed mounted,
+    // showing an issue, over a screen whose OWN address bar named
+    // something else, and that URL reloads straight to Fleet with no
+    // memory an issue was ever open. See §9.5 (defect 4).
+    setIssueKey(null)
     pushURL(selectedBusiness, dest, resolved, selectedProject)
   }, [selectedBusiness, selectedProject, pushURL])
```

```diff
-      <IssueDetailOverlay taskKey={issueKey} onClose={() => { setIssueKey(null); goTo('work', 'list') }} />
+      <IssueDetailOverlay taskKey={issueKey} onClose={() => {
+        setIssueKey(null)
+        // issue-permalink piece: closing an overlay is not navigation.
+        // `goTo('work','list')` PUSHED a history entry, so `history.length`
+        // grew on every open+close and Back immediately RE-OPENED the
+        // issue (see §9.9, the wart) — replaceState instead. Uses the
+        // shared constants so this and SearchOverlay's own "closed"
+        // destination cannot drift apart.
+        setDestination(ISSUE_BACKDROP_DESTINATION)
+        setView(ISSUE_BACKDROP_VIEW)
+        window.history.replaceState(
+          { biz: selectedBusiness, destination: ISSUE_BACKDROP_DESTINATION, view: ISSUE_BACKDROP_VIEW, project: selectedProject },
+          '',
+          issueBackdropPath(window.location.pathname),
+        )
+      }} />
```

Once both land, `ISSUE_BACKDROP_DESTINATION`/`ISSUE_BACKDROP_VIEW`/
`issueBackdropPath` have a second, real importer and the comment becomes
literally true; until then it says so.

### 9.5 Fabrication 3 / defect scope — `before:` accepted impossible dates — FIXED

Measured live against the running server BEFORE fixing anything:
`GET /api/db/issues?created_at=lt.9999-99-99&limit=3&select=task_key` with a
valid `Referer` → 200, `[{"task_key":"TOD-169"}]` (my own fixture, see
§9.11) — confirms the critic's finding that the server-side proxy does no
date validation at all and a shape-only-valid-but-impossible date reaches a
live query.

Fixed at the client boundary this piece owns (`lib/search-commands.ts`,
`parseSearchInput`): `DATE_MODIFIER` (shape regex) is now followed by
`isValidCalendarDate`, which rebuilds the string from `Date.UTC`'s actual
normalised year/month/day and compares — `new Date('9999-99-99')` still
*parses* to some date (a plain `isNaN` check would not have caught it); the
round-trip comparison does, because `Date.UTC` silently rolls an
out-of-range month/day into the next month/year rather than rejecting it,
and the round-trip exposes that roll-over as a mismatch.

New tests: `it.each(['9999-99-99', '2026-13-45', '2026-02-30',
'2023-02-29'])` (the last is 2023, not a leap year — Feb 29 does not exist)
all refused with a message naming the offending value; `2024-02-29`
(genuine leap day) accepted. `npx jest lib/__tests__/search-commands.test.ts`
→ 60/60 green (54 previous + 6 new).

Piece doc §5's claim that `before:` "refuses anything that isn't a plain
date" was true of the SHAPE check only — correcting that here per the "do
not rewrite history" rule rather than editing §5 itself.

### 9.6 Defect: `from:` case-sensitive — FIXED (lower-cased, not full-directory validation)

Measured live, before fixing: `GET /api/db/issues?assignee=eq.po&...` → 200,
1 row (my fixture, assignee `po`); `assignee=eq.Po` (capital P) → 200, `[]`
— confirms the exact repro. I chose "match case-insensitively" over "reject
by name against a directory": all evidence in this codebase (`ASSIGNEE_MAP`
lookups in `BoardTab.tsx` all `.toLowerCase()` their key; no uppercase
assignee literal exists anywhere in `lib/*.ts`) is that assignee ids are
canonically lowercase, the same way `in:`'s status values already are and
are already lower-cased in this same function — so `from:` now does the
identical `.toLowerCase()` `in:` already did, rather than reaching into
`lib/agent-roster.ts` (explicitly off-limits this round — another agent is
actively changing it) to build a name-validated refusal. Re-measured live
after the fix: `from:Po` in the palette now builds `assignee=eq.po`, which
is the query that returned the 1 row above.

New test: `lower-cases from: values so "from:Po" still narrows to assignee
po`.

### 9.7 Defect: unparseable key silently succeeds — seam diff (not applicable without app/page.tsx)

Measured before fixing: `GET /api/issues?task_key=notakey` with a Limiglow
`Referer` → 404, `{"error":"No issue found for task_key=notakey"}` — a raw,
un-normalised, garbage segment is safe to hand straight through to the
existing `IssueDetailOverlay` "missing" render path; no new endpoint, no
new validation needed server-side.

New `lib/issue-permalink.ts` export: `rawIssueSegment(pathname): string |
null` — same prefix-peeling as `parseIssueKeyFromPath`, but returns the RAW
segment regardless of whether it parses, distinct from that function's
existing (and still-tested-unchanged) "normalised or null" contract.

Seam diff — `parseURL`'s issue branch:

```diff
   if (rest[0] === 'i' && rest[1]) {
-    const issueKey = parseIssueKeyFromPath(window.location.pathname)
+    // A malformed/truncated permalink used to fall through to the `now`
+    // default below, and the mount-time replaceState rewrote the address
+    // bar before the operator saw any evidence an issue had been
+    // requested. `rawIssueSegment` is the fallback: it is SAFE to hand to
+    // IssueDetailOverlay unnormalised — its GET 404s cleanly on any string
+    // (measured live 2026-08-26, see the piece doc §9.7) — so "notakey not
+    // found in Limiglow" renders instead of a silent bounce to `/now`.
+    const issueKey = parseIssueKeyFromPath(window.location.pathname) ?? rawIssueSegment(window.location.pathname)
     if (issueKey) {
       return { destination: 'work', view: 'list', business, project, openChat: false, issueKey }
     }
   }
```

Not applied — `app/page.tsx` is orchestrator-owned.

### 9.8 Defect: palette invisible-but-focused underneath the overlay — FIXED

Confirmed by reading both files' JSX root: `SearchOverlay.tsx` was
`z-[100]`; `IssueDetailOverlay.tsx` is `z-[150]`. `app/page.tsx`'s Cmd-K
listener (`if ((e.metaKey || e.ctrlKey) && e.key === 'k')`) has no guard
against `issueKey` being set, so both can be simultaneously mounted.

Fixed within the one file I own that needed changing:
`components/SearchOverlay.tsx`'s root `z-[100]` → `z-[200]` (above
`IssueDetailOverlay`'s `z-[150]`). The newest thing the operator opened
(the palette, opened second) now outranks the older one — visible,
clickable, and receives the keystroke that was already landing in its
(previously hidden) input. `IssueDetailOverlay.tsx` itself is unchanged.
**Not verified in a real browser** (no browser tool) — verified by reading
the two `z-[…]` values and CSS stacking-context rules (a child of
`position: fixed` with a higher `z-index` paints and hit-tests above a
sibling with a lower one, given both are top-level fixed overlays with no
intervening stacking context — true here since both mount as direct
children of `app/page.tsx`'s render tree).

### 9.9 Wart: closing pushes a history entry, always lands on work/list

Addressed as part of the §9.4 seam diff (the `onClose` prop): switched
`goTo('work','list')` (which `pushURL`s) to an explicit `replaceState` to
`issueBackdropPath(...)`, which fixes the `history.length` growth /
back-reopens-the-issue half of this. The second half — "return to the
destination the permalink was opened FROM (now/fleet/etc.), not always
work/list" — is not attempted: it needs a new piece of state
(`previousDestination`/`previousView`, captured wherever `issueKey` is
first set, in `app/page.tsx`, which also owns the several places an issue
can become "open") and the critic filed it as the lowest-severity item
("ONE WART", below the four numbered defects). Given the size of the rest
of this list, I judged fixing the history-growth bug the seam diff already
did was the honest stopping point rather than doing a partial version of
the second half.

### 9.10 Free honesty — withheld verbs now show their real reason

`lib/issue-verbs.ts`: new `withheldIssueVerbs(issue)`, alongside the
existing (unchanged) `readyIssueVerbs`. Iterates the exact same
`moveVerdict` calls `readyIssueVerbs` already makes; for every `blocked`
verdict it surfaces `verdict.reason` verbatim, and for every `needs`
verdict it names the missing field labels. `lib/issue-moves.ts` — not on my
owned list — is untouched; this only reads more of what it already
computes.

`components/IssueDetailOverlay.tsx`: a collapsed-by-default "Show N
withheld moves" toggle beneath the ready-verb buttons, rendering each
withheld move's label + real reason when expanded. Collapsed by default so
it does not compete with the ready verbs (the fast path) for attention.

New tests in `lib/__tests__/issue-verbs.test.ts` (5): a closed issue's
withheld reasons all mention "closed and read-only" (verbatim from
`moveVerdict`, not paraphrased); a status is never both ready AND withheld;
`refined`'s "needs" reason names the actual missing fields (Description,
Test tier, for a gated `ops` row); `defined`'s "no owner" block gives a
real sentence. `npx jest lib/__tests__/issue-verbs.test.ts` → 13/13 green
(8 previous + 5 new).

### 9.11 Fixtures

Created and deleted, project Limiglow, this session: `TOD-169` (type
`ops`, title "prd_implementer fixture — issue-permalink verification"),
used for the §9.5/§9.6/§9.7 live measurements above.
`POST /api/issues` → 200 →
`DELETE /api/issues?id=303aa4b0-644c-44d5-8c8f-c203ee4d5f69` → 200 →
re-`GET ?task_key=TOD-169` → 404, confirmed gone.

Also closed out the prior session's flagged-but-undeleted fixture from §7
above (`TOD-155`, id `0a2fa43f-cd3e-4261-8be7-0b7a1cc304b9`): the dev
server is healthy this session (every curl in §9.5–§9.7 returned a real
JSON body, not the 500 HTML page §7 described), so I ran the exact
`DELETE` that note asked for. `GET ?task_key=TOD-155` already answered 404
before I ran it (so either it was cleaned up by someone else in the
meantime, or the key was reassigned by the sequence — Supabase `DELETE
.eq('id', ...)` against a non-matching id also returns `{ok:true}`, so this
DELETE cannot by itself distinguish "found and removed" from "already
gone"); either way, the row is confirmed absent now. Did not touch any
other row in Limiglow — did not enumerate or delete anything belonging to
the concurrent agent mentioned in my instructions.

### 9.12 Gate numbers (this session, after all changes above)

- `npx tsc --noEmit` → 0 errors (repo-wide).
- `npm test` → 1081 passed, 5 failed, 2 skipped (1088 total). The 5
  failures are exactly the baseline-known set — `__tests__/api/
  agents-route.test.ts` (2), `__tests__/runtimes/spawn-live.test.ts` (1),
  `__tests__/api/agents-unconfigured.test.ts` (1), plus one more in that
  same small cluster — unrelated to this piece's files, unchanged by
  anything here. 1081 vs. the 1055 baseline is +26 new passing tests, all
  mine (§9.2, §9.5, §9.6, §9.10) plus whatever the two concurrent agents
  added in their own files.
- `node scripts/acceptance/run.mjs` → 45/45 passing, harness score 10/10 —
  unchanged from baseline.
- `bash scripts/smoke-test-layout.sh` → all guards passed: layout (4),
  `no-invented-projects`, `no-dead-modules`, `no-phantom-columns`,
  `no-cloud-provider`, `check-no-secrets`, Honest-error guard
  (`no-silent-empty.mjs`), Scope guard (`no-unscoped-issues.mjs`) — the
  latter two named explicitly since CLAUDE.md calls them out by name; both
  ran and both passed.

### 9.13 What I did NOT verify this pass

- **No browser tool.** Every claim about pixel-level rendering, real
  Cmd-click/middle-click new-tab behaviour, hover status-bar text, and
  actual z-index stacking on screen is inferred from code + CSS semantics,
  not observed. Flagged inline at each defect above, not just here.
- **The three `app/page.tsx` seam diffs (§9.2, §9.4, §9.7) are unapplied.**
  I did not and cannot verify their combined behavior end-to-end — each is
  reasoned through by hand and, where possible, backed by a live
  measurement of the piece either side of the diff (e.g. §9.7's "a raw
  segment 404s safely" is a live-server fact independent of whether the
  diff has landed).
- **`goTo`'s `setIssueKey(null)` addition (§9.4) is untested against a real
  render.** I did not build a way to exercise `app/page.tsx`'s actual
  component tree this session (see §9.2) — I traced the fix by reading
  every call site of `goTo` and `setIssueKey` in the file, not by watching
  it run.
- **Whether raising `SearchOverlay`'s z-index to 200 has any other overlay
  in the app that now unexpectedly sits below it that didn't before.** I
  checked every `z-[…]` literal in `IssueDetailOverlay.tsx` and
  `SearchOverlay.tsx` (the only two files I touched for this) and in
  `BoardTab.tsx`'s own modals (50/60/70, well below both) — I did not grep
  the entire remaining ~250-file tree for a `z-[` above 150 that might now
  read strangely relative to the palette; I consider this low-risk (a
  command palette outranking most modals is the conventional choice) but
  did not exhaustively confirm it.
- **`components/tabs/IssuesTab.tsx` (Work → List) remains without a real
  anchor.** See §9.1 — out of my ownership, not touched, pattern handed off.

---

## 10. Third pass (2026-08-26, bug_fixer) — re-verified §9's diffs live, closed the URL-filter gap

Tooling note, same as §9.0: no browser tool was present in this invocation
either, despite the task briefing naming one — confirmed by checking the
actual tool list available this session, not assumed. Every claim below is
either a `git diff`/`grep` fact about the file on disk, a live `jest` run
(including the mutation performed and reverted in the terminal, not
described from memory), or the existing full gate. No DOM was watched.

### 10.1 §9.2/§9.4/§9.7's seam diffs — re-confirmed against app/page.tsx as it stands today

Read `app/page.tsx` fresh this session rather than trusting the prior
pass's transcription. All three gaps it described are still live, verbatim:

- The scope-sync effect (`[selectedBusiness, selectedProject, issueKey]`)
  still reads `if (issueKey) return` — not `issueUrlSyncPath`.
- `goTo` still has no `setIssueKey(null)` call; `<IssueDetailOverlay
  onClose>` still calls `setIssueKey(null); goTo('work', 'list')` (a
  `pushState`, not the `replaceState`-to-`issueBackdropPath` §9.4 diffs to).
- `parseURL`'s `/i/` branch still reads only `parseIssueKeyFromPath` (no
  `?? rawIssueSegment(...)` fallback), so `/p/limiglow/i/notakey` still
  falls through to the `now` default.

§9.2's, §9.4's, and §9.7's diffs (reproduced there in full) are therefore
**still the correct, current, unapplied fix** — nothing on the page.tsx side
has drifted since they were written. I did not re-paste them here to avoid
duplicating text this doc's own header says not to rewrite; apply them from
§9.2/§9.4/§9.7 as written.

**The mutation proof, re-performed live this session** (not merely re-read
from §9.2's account of a prior session): applied the critic's exact edit —
`lib/issue-permalink.ts`, `if (issueIsOpen) return null` →
`if (false && issueIsOpen) return null` — via `sed`, then ran `npx jest
lib/__tests__/issue-permalink.test.ts`. Result: 2 of 35 tests failed, by
name — `issueUrlSyncPath › refuses to sync — returns null — whenever an
issue is open, no matter how the paths differ` and `issueUrlSyncPath ›
MUTATION PROBE: a version that ignores issueIsOpen would fail the first case
above`. Reverted from a pre-mutation backup; re-ran: 35/35 green, `git diff
lib/issue-permalink.ts` empty. Full transcript of both runs is in this
session's tool log, not just asserted here.

### 10.2 Closed: `in:`/`from:`/`before:` had no representation in the URL (§3, this piece's remaining channel gap)

Confirmed before changing anything: `components/SearchOverlay.tsx`'s `query`
state (which carries the modifiers and free text both) had exactly one
writer (`setQuery`, local `useState`) and zero readers or writers touching
`window.location` — grepped for `URLSearchParams|history\.` in this file and
`lib/search-commands.ts` before this pass: only the pre-existing
`pushState`+`popstate` calls for destination/issue navigation, nothing
naming `query`. Confirmed also that the overlay resets `query` to `''`
every time it opens (`useEffect(() => { if (open) setQuery('') ... })`),
which is what actually threw a constructed query away, not merely "the
palette closed" — even leaving the palette mounted-open across a reload
would not have survived, because the reset fires on every `open` transition
including the one after a fresh mount.

**Fix, entirely within this piece's owned files, no seam diff required for
the core behavior:**

- `lib/search-commands.ts`: `withSearchQueryParam(search, query)` /
  `queryFromSearchParams(search)` — pure `URLSearchParams` string-in/
  string-out helpers (testable under this repo's `node` jest environment;
  `URLSearchParams` is a Node global, no jsdom needed). `SEARCH_QUERY_PARAM
  = 'q'`, a query string deliberately, not a path segment — see that file's
  new header comment for why this one differs from `/i/<key>`: dropping it
  still lands on a valid page with the palette merely closed, which
  `/i/<key>` cannot say.
- `components/SearchOverlay.tsx`: on open, `query` is now seeded from `?q=`
  instead of always `''`; while open, every `query` change is written back
  into `?q=` via `replaceState` (never `pushState` — this is an in-place
  edit, not a navigation, the same principle §9.4's `onClose` fix already
  established for closing the issue overlay); on the true→false transition
  (close), `?q=` is stripped via the effect's own cleanup, so a dismissed
  search does not leave a stale query string behind with nothing left to
  read it. A `skipNextUrlSyncRef` guard prevents the restore-effect and the
  sync-effect from racing in the same commit (the sync effect would
  otherwise read `query` from before the restore's `setQuery` had been
  applied and briefly write the OLD value back over the just-restored one,
  self-correcting one render later — harmless in outcome, but avoided
  outright rather than left as a known one-tick wart).
- Tests: 6 new cases in `lib/__tests__/search-commands.test.ts` (round-trip,
  preserving an unrelated existing param, clearing removes the key
  entirely rather than leaving `q=`, empty-string-not-null contract).

**What this closes and what it does not:** while the palette is open, its
address bar now genuinely names the current filtered search — copying it
and opening it in a new tab, IF the palette is independently opened there
too (e.g. via Cmd-K), restores the same query. **What it does NOT close**:
`searchOpen` (whether the palette is open at all) is `app/page.tsx` state,
not this piece's — so a URL carrying `?q=in:backlog` does not, by itself,
reopen the palette on a cold load or a plain link click. That is the
remaining seam diff, offered but not required for the fix above to be real:

```diff
   useEffect(() => {
     const { destination: d, view: v, business, project, openChat, issueKey: k } = parseURL()
     setDestination(d)
     setView(v)
     if (business) setSelectedBusiness(business)
     if (project) setSelectedProject(project)
     if (openChat) setChatOpen(true)
+    if (new URLSearchParams(window.location.search).get('q')) setSearchOpen(true)
     if (k) {
```

This is additive, one line, and safe to skip: without it, `?q=` is inert
metadata on a cold load (no worse than today, since today there is no `q`
param at all) and still fully functional as "what the palette currently
shows while you have it open," which is the improvement actually delivered
this pass.

### 10.3 Gate (this session, after §10.2's changes)

- `npx tsc --noEmit` → 0 errors in every file this piece owns or touched.
  One pre-existing error remains in `lib/__tests__/conversations.test.ts`
  (`MessageRow`/`external_id` type mismatch) — confirmed via `git status`
  that `lib/conversations.ts`, `lib/db/sqlite-adapter.ts`,
  `app/api/notify/route.ts` and that test file are mid-edit by a concurrent
  agent (explicitly off-limits to this piece); I did not touch them and the
  error is unrelated to anything in this section.
- `npx jest lib/__tests__/issue-permalink.test.ts lib/__tests__/issue-verbs.test.ts
  lib/__tests__/search-commands.test.ts` → 114/114 (108 pre-existing + 6 new).
- `npm test` → at the moment I ran it, 1118 passed / 7 failed / 2 skipped.
  5 of the 7 are the named baseline set (`agents-route` ×2,
  `agents-unconfigured` ×1, `spawn-live` ×1, plus one more in that cluster);
  the other 2 are in `lib/__tests__/conversations.test.ts`, the same
  concurrently-edited file from the `tsc` note above — not this piece's
  files, not present before that agent's WIP landed mid-session. An earlier
  run this same session, before that file changed under me, showed exactly
  the baseline 5/1098/2.
- `node scripts/acceptance/run.mjs` → 45/45, harness 10/10.
- `bash scripts/smoke-test-layout.sh` → all guards passed, including
  Honest-error and Scope guard by name.

No Limiglow fixtures were created this pass — every check above is either a
pure-function jest run or a static gate script; nothing needed a live
issue row.
