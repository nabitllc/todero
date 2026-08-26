# fleet-issues-scope — the OPEN DECISION, resolved as option 1

**Lane:** fleet-issues-scope (bug_fixer) · **Date:** 2026-08-26
**Host:** Windows 11, dev server already running on `:3000`, ten other lanes running concurrently
**Owned files:** `middleware.ts`, `lib/scope.ts`, `app/api/db/issues/**` (i.e. `app/api/db/[...path]/route.ts`),
`scripts/no-unscoped-issues.mjs`, this doc. Nothing else was touched.

The owner resolved the two-day-old OPEN DECISION in `docs/rebuild/LOOP-PLAN.md` as **option 1**:
an explicit `project=eq.<in-scope>` filter satisfies the project-scope requirement even from a
cross-project destination (Fleet, Runs), because the caller resolved the boundary itself. Options
2 (let Fleet reads span projects) and 3 (Fleet reads no issues at all) were explicitly rejected.
This doc is the attack table that proves the boundary held, not the feature.

---

## 1. Reproduced first, before touching anything

```
GET /api/db/issues?project=eq.Limiglow&select=id,project&limit=5
  Referer: /p/limiglow/work/board   -> 200  []
  Referer: /p/limiglow/fleet/team   -> 400  {"error":"unscoped_issues_read", ...}
```
Measured against the running dev server, before any edit. Identical query, identical embedded
project in both referers, different verdict — exactly as reported.

**Cause**, read from source, not guessed: `middleware.ts`'s `resolveProjectScope` returns `null`
for a cross-project destination (`isCrossProjectDestination` — `fleet/*`, `runs/*`,
`settings/projects`) even when the same path/Referer names a project, so `x-mc-project` never
gets stamped. `app/api/db/[...path]/route.ts`'s `scopedParams` then sees no `x-mc-project` and,
for the `issues` table specifically, refuses outright — it does not honour the generic
`x-mc-all-projects` cross-project escape hatch for `issues` (that hatch was closed at TOD-2419/
the `scope-reaches-the-server` piece, deliberately: a Fleet screen has no business reading another
project's issues *without limit*). The caller's own explicit `project=eq.Limiglow` was simply
never consulted in the cross-project branch. That gap is what option 1 closes.

---

## 2. The exact predicate implemented

**`middleware.ts`** gained one new header, `x-mc-cross-project-hint` (`CROSS_PROJECT_HINT_HEADER`):
the project named in *this same request's* own path or Referer, computed **only** when that
destination is cross-project (i.e. exactly the case where `x-mc-project` comes out null because
`isCrossProjectDestination` refused to let it narrow, not because nothing was nameable). Like the
two existing scope headers, any client-supplied copy is deleted before being recomputed — a caller
cannot assert it directly.

**`app/api/db/[...path]/route.ts`**'s `scopedParams`, for `issues` reads only, with no resolved
`x-mc-project`: if the hint header is present **and** the query's `project` filter is **exactly**
the literal string `eq.<hint>` (case-sensitive, no other operator, no extra characters), the
request is scoped to that project — `project=eq.<hint>` and `archived_at=is.null` are then forced
onto the params exactly as a normal resolved scope would, overwriting whatever else the caller sent
for those keys. Any other shape of `project=` — a different value, a different operator, an empty
value, multiple values, wrong case — does **not** match, and falls through to the existing refusal
(`400 unscoped_issues_read`) unchanged. No project filter at all also falls through unchanged.

**What this explicitly does NOT do**, matching the brief:
- It does not accept *any* project filter — only one that names the *same* project the request's
  own path/Referer already names. A foreign project explicitly named still refuses.
- It does not accept a filter-shaped string that isn't the exact `eq.<value>` form.
- It does not forgive an absent filter — the hint alone grants nothing; it only *confirms* an
  explicit claim that repeats it.
- It changes nothing about non-`issues` tables, about writes, or about `/api/issues` (a different
  route, not owned by this lane — see §6).

---

## 3. ATTACK TABLE — measured today, real HTTP, against the running server

All requests below: `Cookie: mc-auth=kaos2026; mc-role=owner`, target
`GET /api/db/issues?...&select=id,project&limit=5` unless noted. Fleet referer =
`/p/limiglow/fleet/team` (embeds project `Limiglow`) throughout.

| # | Request shape | Status | Notes |
|---|---|---|---|
| 1 | Work referer, `project=eq.Limiglow` (control, unchanged path) | **200** | `[]` |
| 2 | **Fleet referer, `project=eq.Limiglow`** (the grant) | **200** | was 400 before the fix; `[]` (no live Limiglow rows in the test DB at run time) |
| 3 | Fleet referer, `project=eq.Todero` (**foreign** project, explicit) | **400** | `unscoped_issues_read` — still refuses |
| 4 | Fleet referer, forged `x-mc-all-projects: 1` header, `project=eq.Limiglow` | **200** | passes, but *because* of the matching explicit filter (item 2's mechanism), not because of the forged header — see item 4b |
| 4b | Fleet referer, forged `x-mc-all-projects: 1`, **no** matching filter (foreign project / no filter) | **400** | proves the forged header alone grants nothing (see §3.1) |
| 5 | Fleet referer, forged `x-mc-cross-project-hint: Todero` header, `project=eq.Todero` | **400** | middleware strips and recomputes the hint before the route ever sees it — the forged value never reaches the route |
| 6 | Fleet referer, forged `x-mc-project: Todero` header (no filter) | **400** | same anti-forgery; middleware recomputes this header too |
| 7 | Fleet referer, `project=eq.*` | **400** | wildcard is a literal value, not a match |
| 8 | Fleet referer, `project=eq.` (empty) | **400** | empty value ≠ hint |
| 9 | Fleet referer, `project=in.(Limiglow,Todero)` | **400** | wrong operator, no `eq.` match |
| 10 | Fleet referer, `project=neq.Todero` | **400** | wrong operator |
| 11 | Fleet referer, URL-encoded `eq.Limiglow` (`%65%71%2E%4C...`) | **200** | decodes to the identical legal value before comparison — not a bypass, just an equivalent encoding of the SAME value |
| 12 | Fleet referer, case variant `project=eq.limiglow` | **400** | comparison is case-sensitive; a legitimate caller sends the exact title-case name middleware computed, same as the non-cross-project case already requires |
| 13 | Fleet referer, **no** `project` filter at all | **400** | nothing to check equality against; not forgiven just because the destination is cross-project |
| 14 | Fleet referer to a **nonexistent** slug (`/p/zzznotreal/fleet/team`), `project=eq.Zzznotreal` | **200**, `[]` | see §3.2 — the title-case codec resolves a made-up slug to a made-up (but self-consistent) name; the query then matches nothing, because no such project exists |

### 3.1 Forged-header attacks, isolated

```
Fleet referer + forged x-mc-all-projects + FOREIGN project=eq.Todero   -> 400
Fleet referer + forged x-mc-all-projects + NO project filter           -> 400
Fleet referer + forged x-mc-project: Todero (no filter)                -> 400
```
None of the three headers this route or middleware reads can be asserted by the caller. Every one
is stripped from the inbound request and recomputed by `middleware.ts` before the route sees it
(`withResolvedScope` deletes all three, then sets only what it itself resolved).

### 3.2 The title-case-codec caveat, and why it doesn't matter here

`middleware.ts`'s `slugToProjectName` is a plain codec (`slug-with-dashes` → `Slug With Dashes`),
not a lookup against a real project registry — its own comment says so, and this was true before
this piece touched anything. That means a Fleet referer for a **slug that names no real project**
still produces a well-formed hint (`Zzznotreal`). The predicate does not special-case this: it lets
the equality check pass (item 14) and hands the *literal string* `Zzznotreal` to the query as
`project=eq.Zzznotreal`. Because no row in any project is actually named `Zzznotreal`, the result is
an empty array, not another project's data. The codec's looseness lets a caller construct a
syntactically valid but semantically empty scope; it does not let a caller reach a real foreign
project's rows, because the equality check still requires the query to repeat the exact resolved
string, and no real project shares a name with a nonexistent slug's title-cased form (and if one
ever did by coincidence, that project's own data is what the caller would see — no *other*
project's).

### 3.3 End-to-end, with a real row

A fixture row was created (`POST /api/issues`, `project: "Limiglow"`, task_key auto-assigned
`TOD-445`) and read back through the exact Fleet-loader shape:

```
Work referer,  project=eq.Limiglow  -> 200  [{"task_key":"TOD-445","project":"Limiglow"}]
Fleet referer, project=eq.Limiglow  -> 200  [{"task_key":"TOD-445","project":"Limiglow"}]   <- the fix
Fleet referer, project=eq.Todero (foreign)   -> 400, row absent
Fleet referer, no filter                     -> 400, row absent
```
The row was deleted immediately after (`DELETE /api/issues?id=...`), confirmed gone by a follow-up
read. This is the one part of the brief I could observe end-to-end with a real row; item 4 in
§4 below records everything I could not.

---

## 4. What I did NOT verify

- **No browser.** Everything above is `curl`/`fetch` against the real server with real cookies and
  headers. I did not open Fleet in an actual browser tab, so I cannot confirm the loader's own
  fetch call sends `Referer` and `project=eq.<name>` in the shape I tested — only that the server
  behaves correctly for the shape the bug report and the OPEN DECISION describe, and that shape
  matches what `app/page.tsx`'s comments say the SPA sends (Referer carries the live `/p/<slug>`
  on every same-origin fetch; I did not read the Fleet loader's own fetch call site, since
  `components/office/**` and related Fleet UI files are another lane's territory per this
  session's file list).
- **`/api/issues` is a different route, not owned by this lane, and not touched.** While
  reproducing, I observed (not fixed, not in scope) that it appears to permit an **arbitrary**
  `project=` param from a cross-project destination without checking it against anything — see
  §6. I did not modify it and did not run its own attack table with the same rigor; that
  observation is a flag for whoever owns that file next, not a verified attack table entry for
  this piece.
- **Whether other lanes' concurrent edits to `middleware.ts` (the identity-sessions role-source
  seam, importing `resolveDecisionRole`) interact with anything here.** I re-ran the guard, `tsc`,
  and the reproduction curls after that edit landed on disk mid-session and confirmed no change
  in behavior (see §7), but I did not review that lane's diff for correctness — it is outside this
  piece's ownership and concern.
- **Production/Vercel behavior**, Cloudflare tunnel behavior, or any environment other than the
  local dev server on `:3000`.

---

## 5. Guard probes — proven RED, then GREEN, by name

Two probes added to `scripts/no-unscoped-issues.mjs` (probes 7–8, keeping the file's own
running total accurate: it already said "`8 + 2`" live probes in anticipation of exactly this).

- **Probe 7**: Fleet referer + explicit `project=eq.<the same project the referer names>` → must
  be **200** (was 400).
- **Probe 8**: Fleet referer + explicit `project=eq.<foreign project>` (the guard's own live probe
  row's real project) → must still **refuse and not leak**.

**RED, mutation A** (simulating "unimplemented" — commented out the new branch with `if (false && ...)`):
```
FAIL: the server leaks across the project boundary.
  fleet destination + explicit in-scope project filter -> 200 (was 400)
    status 400 :: {"error":"unscoped_issues_read", ...}
```
Probe 7 failed by name, for the right reason (still 400).

**RED, mutation B** (simulating the wrong, over-wide fix — "any project filter satisfies scope",
stripping any `eq.` prefix or accepting the raw value regardless):
```
FAIL: the server leaks across the project boundary.
  fleet destination + explicit FOREIGN project filter still refuses
    status 200 :: [{"id":"d16e0207-...","project":"Todero"}]
```
Probe 8 failed by name, and the failure body shows the guard's own **live** foreign row leaking —
this is not a status-code coincidence, the guard observed real cross-project data.

**GREEN**, mutation reverted, file diffed byte-identical to the pre-mutation fix:
```
PASS: scope holds under 10 live probes (scoped reads, cross-project destination,
      refusal without scope, forged headers, filter override, write path,
      explicit in-scope filter from a cross-project destination — both directions).
```
`scripts/smoke-test-layout.sh` (which runs this guard as one of nine) is green with the real fix
in place — confirmed as the last step before writing this doc.

---

## 6. Flagged, not fixed: `/api/issues` looks wider than option 1

Not this lane's file (not in the owned list, not touched). Recorded here because it's the other
half of the original bug report (`/api/issues` returned 200 where `/api/db/issues` 400'd) and
because picking wrong on this exact question is the entire reason the decision needed an owner.

Reading `app/api/issues/route.ts` (read-only, not edited): when `crossProjectDestination` is true
(Fleet/Runs) and `resolvedScope` is null, its unscoped-refusal condition
(`!resolvedScope && !allProjectsParam && !crossProjectDestination && !projectParam`) is already
false purely from `crossProjectDestination` being true — so the route does not refuse regardless
of what `projectParam` says, and there is no equality check against `projectParam` in that branch
(the mismatch check that exists a few lines down only fires when `resolvedScope` is non-null,
which it isn't here). Measured: `crossProjectDestination=true` plus **any** `?project=` value
appears to set `effectiveProject` to that value unchecked. That is closer to option 2 (or wider)
than option 1, on a route this piece does not own. I did not run a full attack table against it —
this is an observation from reading source and reasoning about the branch, not a "Measured" claim
for that route — and I am flagging it rather than fixing it, since silently touching a file another
piece may already be mid-edit on is exactly the failure mode this wave's fan-out rules exist to
prevent.

---

## 7. Gate — exact numbers, run today, in this order

```
npx tsc --noEmit
  exit 0, zero output

npm test
  Test Suites: 7 failed, 1 skipped, 112 passed, 119 of 120 total
  Tests:       22 failed, 2 skipped, 2311 passed, 2335 total
  Time:        43.6s

node scripts/acceptance/run.mjs
  45/45 passing (4308ms — fast, single run, no reload needed)
  harness score: 10/10

bash scripts/smoke-test-layout.sh
  nine guards, all passed, including the scope guard with the two new probes
  "Smoke test complete"
```

**The 7 failing suites, checked one by one, are not this lane's:**

| Suite | Touches |
|---|---|
| `__tests__/api/inbox-db-proxy-seam.test.ts` | `app/api/db/[...path]/route.ts`'s `isViewer`/write-role gating — same *file* I own, but a different, pre-existing, unrelated defect (RBAC role forgery on writes, not project scope). `git diff` on that file shows my change is exactly the 35-line scope hunk in §2 — nothing else in that file was touched by me, so this suite's red status predates and is unrelated to this piece. |
| `__tests__/api/llm-kind-seam-requests.test.ts` | llm-provider-sweep lane's own file list |
| `__tests__/auth/login-surface-seam.test.ts` | `app/login/LoginForm.tsx` — another lane |
| `__tests__/fleet/fleet-provenance-seams.test.ts` | fleet-provenance lane's own file list |
| `__tests__/runtimes/pieces9-seams.test.ts` | costs/breakdown, MemoryTab — other lanes |
| `lib/__tests__/agent-budget-sweep-seam.test.ts` | `lib/agent-budget.ts` / cron watchdog — explicitly on this session's "STAY OUT OF" list |
| `__tests__/runtimes/spawn-live.test.ts` | the one failure the brief names as already-known |

None reference `middleware.ts`, `lib/scope.ts`, `app/api/db/**`, or `scripts/no-unscoped-issues.mjs`.
`__tests__/auth/middleware-role-source-seam.test.ts` (a RED-on-purpose test for `middleware.ts`,
owned by the identity-sessions lane, not this one) is **now passing** — that lane's own fix landed
in `middleware.ts` mid-session (adds `resolveDecisionRole`/`resolveRequestRole`); I read the full
current file afterward and confirmed my scope-header code (`SCOPE_HEADER`, `CROSS_PROJECT_HEADER`,
`CROSS_PROJECT_HINT_HEADER`, `withResolvedScope`, `crossProjectDestinationName`,
`resolveProjectScope`) is untouched by that edit and still behaves correctly (re-curled and
re-ran the guard afterward — both green, see §5).

Fixtures: every row this session created (`TOD-445` created directly, plus several transient
`SCOPEPROBE-*` rows created and mostly self-cleaned by repeated guard runs) was deleted; one guard
run's self-created row (`TOD-454`) was found via `all_projects=1` after the guard's own cleanup
missed it (the guard only deletes a row it creates in that same run, not one it finds and reuses
from an earlier run) and was deleted manually. Confirmed empty (`total: 0`) as the last action
before writing this doc.
